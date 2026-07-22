import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseActivity } from './src/parse.js';
import { evaluate, sportLabel, sportIcon, fmtDuration } from './src/coach.js';
import { aiEnabled, generateCoachComment } from './src/aiCoach.js';
import { generatePlan, planAiEnabled } from './src/aiPlan.js';
import { computeForm } from './src/form.js';
import { computeReadiness } from './src/readiness.js';
import { scoreNutrition, nutritionPeriod } from './src/nutrition.js';
import { parseMetrics } from './src/metrics.js';
import { streamDiaryPdf, DIARY_PERIODS } from './src/diary.js';
import { generateReply, assistantEnabled, summarizeChat, generateWeeklyRecap } from './src/assistant.js';
import { ROUTINE, routineDigest } from './src/routine.js';
import { computeAchievements } from './src/achievements.js';
import { initPush, pushReady, vapidPublicKey, sendToAll } from './src/push.js';
import { dailyReminderCheck } from './src/reminders.js';
import {
  initDb, dbBackend, dbInfo, addActivity, listActivities, deleteActivity, findByFingerprint,
  getPlan, savePlan, getChat, saveChat, listMeasurements, listNutrition, getRoutine, saveRoutine,
  addPushSub, listWellness, listGoals, getHealth, addMeasurement, addWellness, getSetting, setSetting,
} from './src/db.js';

// Deterministický záchyt výšky/váhy/spánku z Oliverovy zprávy — pojistka, aby
// se to zapsalo i když to AI mine (nebo když AI neběží). Zapíše jen to, co
// dnešek ještě nemá (nezdvojuje se s tím, co už zapsala AI).
async function fallbackLogMetrics(message) {
  const parsed = parseMetrics(message);
  if (!parsed.height_cm && !parsed.weight_kg && !parsed.sleep_hours) return [];
  const today = new Date().toISOString().slice(0, 10);
  const [meas, well] = await Promise.all([listMeasurements().catch(() => []), listWellness().catch(() => [])]);
  const hasToday = (list, field) => list.some((r) => String(r.date || '').slice(0, 10) === today && r[field] != null);
  const done = [];
  if (parsed.height_cm != null && !hasToday(meas, 'height_cm')) {
    await addMeasurement({ height_cm: parsed.height_cm });
    done.push(`výška ${parsed.height_cm} cm`);
  }
  if (parsed.weight_kg != null && !hasToday(meas, 'weight_kg')) {
    await addMeasurement({ weight_kg: parsed.weight_kg });
    done.push(`váha ${parsed.weight_kg} kg`);
  }
  if (parsed.sleep_hours != null && !hasToday(well, 'sleep_hours')) {
    await addWellness({ sleep_hours: parsed.sleep_hours });
    done.push(`spánek ${parsed.sleep_hours} h`);
  }
  return done;
}

// Nejbližší budoucí závod + počet dní do něj (z cílů zadaných v chatu).
function nextGoal(goals) {
  const now = Date.now();
  const upcoming = (goals || [])
    .filter((g) => g.date && new Date(g.date).getTime() >= now - 12 * 3600 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!upcoming.length) return null;
  const g = upcoming[0];
  const days = Math.ceil((new Date(g.date).getTime() - now) / (24 * 3600 * 1000));
  return { ...g, days: Math.max(0, days) };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const genId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 8);

// Otisk aktivity pro rozpoznání duplicity (stejný soubor nahraný znovu).
const fingerprint = (s) =>
  [s.sport || '', s.startTime || '', s.distanceKm ?? '', s.durationSec ?? ''].join('|');

// HTML nikdy necachovat (ať opravy vždy dorazí i do appky na ploše);
// verzované JS/CSS (?v=) se pak natáhnou čerstvé.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate');
  },
}));
app.use(express.json());

// Nahrání a vyhodnocení aktivity.
// Dočasně bereme jen FIT (Oliver ať nenahrává TCX/GPX). Vypnutí: ALLOW_ALL_FORMATS=true.
const FIT_ONLY = process.env.ALLOW_ALL_FORMATS !== 'true';

app.post('/api/upload', upload.single('activity'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žádný soubor. Nahraj .FIT nebo .ZIP z Garminu.' });
  try {
    const summary = await parseActivity(req.file.buffer, req.file.originalname, { fitOnly: FIT_ONLY });

    // Duplicita? Vrať už uloženou aktivitu (ušetří i AI volání).
    const fp = fingerprint(summary);
    try {
      const existing = await findByFingerprint(fp);
      if (existing) return res.json({ ...existing, duplicate: true });
    } catch (dbErr) {
      console.error('DB dup-check error:', dbErr.message);
    }

    const coach = evaluate(summary);

    // Pokud je nastavený API klíč, nech text trenéra napsat Claude.
    const aiText = await generateCoachComment(summary, coach);
    if (aiText) {
      coach.headline = aiText;
      coach.aiGenerated = true;
    }

    const record = {
      id: genId(),
      ts: Date.now(),
      fp,
      summary,
      coach,
      labels: {
        sport: sportLabel(summary.sport),
        sportIcon: sportIcon(summary.sport),
        duration: fmtDuration(summary.durationSec),
      },
    };

    // Ulož na server (chyba DB nesmí shodit vyhodnocení, ale nahlásíme ji).
    let saved = false;
    try {
      await addActivity(record);
      saved = true;
    } catch (dbErr) {
      console.error('DB save error:', dbErr.message);
    }

    res.json({ ...record, saved, db: dbBackend() });
  } catch (err) {
    console.error('parse error:', err.message);
    res.status(422).json({ error: err.message || 'Soubor se nepodařilo zpracovat.' });
  }
});

// Seznam uložených aktivit (nejnovější první).
app.get('/api/activities', async (_req, res) => {
  try {
    res.json(await listActivities());
  } catch (err) {
    console.error('DB list error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se načíst historii.' });
  }
});

// Smazání aktivity.
app.delete('/api/activities/:id', async (req, res) => {
  try {
    await deleteActivity(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB delete error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se smazat.' });
  }
});

// ---- Plán z chatu ----

// Aktuální plán + historie chatu.
app.get('/api/plan', async (_req, res) => {
  try {
    const state = (await getPlan()) || { plan: null, messages: [] };
    res.json({ ...state, aiEnabled: planAiEnabled() });
  } catch (err) {
    console.error('plan get error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se načíst plán.' });
  }
});

// Nová zpráva (vložený text od trenéra nebo změna) → AI přeskládá týden.
app.post('/api/plan/message', async (req, res) => {
  const message = (req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Prázdná zpráva.' });
  try {
    const state = (await getPlan()) || { plan: null, messages: [] };
    state.messages.push({ role: 'user', text: message, ts: Date.now() });

    const result = await generatePlan({ message, currentPlan: state.plan });

    if (result.error) {
      state.messages.push({ role: 'ai', text: result.error, ts: Date.now() });
    } else {
      state.plan = { weekLabel: result.weekLabel, days: result.days };
      state.messages.push({ role: 'ai', text: result.reply, ts: Date.now() });
    }
    state.messages = state.messages.slice(-40); // strop na velikost chatu
    await savePlan(state);
    res.json({ ...state, aiEnabled: planAiEnabled() });
  } catch (err) {
    console.error('plan message error:', err.message);
    res.status(500).json({ error: 'Něco se pokazilo, zkus to znovu.' });
  }
});

// ---- Forma & periodizace ----
app.get('/api/form', async (_req, res) => {
  try {
    res.json(computeForm(await listActivities()));
  } catch (err) {
    console.error('form error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se spočítat formu.' });
  }
});

// ---- Připravenost dne (forma + spánek + pocit + tep + zdraví) ----
app.get('/api/readiness', async (_req, res) => {
  try {
    const [acts, wellness, health] = await Promise.all([
      listActivities().catch(() => []),
      listWellness().catch(() => []),
      getHealth().catch(() => null),
    ]);
    let form = null;
    try { form = computeForm(acts); } catch {}
    res.json(computeReadiness({ form, wellness, health }));
  } catch (err) {
    console.error('readiness error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se spočítat připravenost.' });
  }
});

// ---- Cíle / závody (zápis přes parťák-chat, tady jen čtení) ----
app.get('/api/goals', async (_req, res) => {
  try {
    const goals = await listGoals();
    res.json({ goals, next: nextGoal(goals) });
  } catch (err) {
    console.error('goals error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se načíst cíle.' });
  }
});

// ---- Tréninkový deník (PDF) za období ----
app.get('/api/diary', async (req, res) => {
  const period = DIARY_PERIODS[req.query.period] ? req.query.period : 'month';
  try {
    const [activities, measurements, nutrition, goals, routineState, wellness] = await Promise.all([
      listActivities().catch(() => []),
      listMeasurements().catch(() => []),
      listNutrition().catch(() => []),
      listGoals().catch(() => []),
      getRoutine().catch(() => ({})),
      listWellness().catch(() => []),
    ]);
    streamDiaryPdf(res, { activities, measurements, nutrition, goals, routineState, wellness }, period);
  } catch (err) {
    console.error('diary error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se vytvořit deník.' });
  }
});

// ---- Tělo: váha & výživa (zápis přes parťák-chat, tady jen čtení) ----
app.get('/api/body', async (_req, res) => {
  try {
    const [meas, nutr] = await Promise.all([listMeasurements(), listNutrition()]);
    const weights = meas.filter((m) => m.weight_kg != null).map((m) => ({ date: m.date, weight_kg: m.weight_kg }));
    const heights = meas.filter((m) => m.height_cm != null).map((m) => ({ date: m.date, height_cm: m.height_cm }));
    res.json({ weights, heights, nutrition: nutr.slice(0, 12), nutritionSummary: scoreNutrition(nutr) });
  } catch (err) {
    console.error('body error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se načíst data těla.' });
  }
});

// ---- Parťák chat (kontext nad vším) ----

const shortDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.`;
};

// Sestaví kompaktní kontext pro AI (ekonomicky — jen to podstatné).
async function buildDigest() {
  const [acts, planState, meas, nutr, routineState, wellness, goals, health] = await Promise.all([
    listActivities().catch(() => []),
    getPlan().catch(() => null),
    listMeasurements().catch(() => []),
    listNutrition().catch(() => []),
    getRoutine().catch(() => ({})),
    listWellness().catch(() => []),
    listGoals().catch(() => []),
    getHealth().catch(() => null),
  ]);

  const lines = [`Dnes: ${new Date().toISOString().slice(0, 10)}`];

  lines.push('\nPoslední aktivity (nejnovější první):');
  if (acts.length) {
    for (const a of acts.slice(0, 8)) {
      const s = a.summary || {};
      const parts = [
        shortDate(s.startTime || a.ts),
        a.labels?.sport || 'Aktivita',
        s.distanceKm != null ? `${s.distanceKm} km` : null,
        a.labels?.duration,
        s.avgHr != null ? `ø${s.avgHr} tep` : null,
        a.coach?.rating ? `${a.coach.rating}★` : null,
        a.userKind ? `(${a.userKind})` : null,
        a.note ? `pozn.: ${a.note}` : null,
      ].filter(Boolean);
      lines.push(`- [${a.id}] ${parts.join(', ')}`);
    }
  } else lines.push('- (zatím žádné)');

  if (planState?.plan?.days?.length) {
    lines.push(`\nPlán týdne (${planState.plan.weekLabel || ''}):`);
    for (const d of planState.plan.days) lines.push(`  ${d.day}: ${d.title} — ${d.detail}`);
  }

  let form = null;
  try {
    form = computeForm(acts);
    if (!form.empty) lines.push(`\nForma: kondice ${form.fitness}, únava ${form.fatigue}, forma ${form.form} (${form.trend})`);
  } catch {}

  // wellness: spánek, ranní pocit, klidový tep
  if (wellness.length) {
    const sleep = wellness.find((w) => w.sleep_hours != null);
    const feel = wellness.find((w) => w.feel != null);
    const rhr = wellness.find((w) => w.resting_hr != null);
    const sore = wellness.find((w) => w.soreness != null);
    const parts = [];
    if (sleep) parts.push(`spánek ${sleep.sleep_hours} h (${shortDate(sleep.date)})`);
    if (feel) parts.push(`pocit ${feel.feel}/5`);
    if (sore) parts.push(`svalovka ${sore.soreness}/5`);
    if (rhr) parts.push(`klidový tep ${rhr.resting_hr}`);
    if (parts.length) lines.push('\nWellness: ' + parts.join(', '));
  }
  if (health?.status && health.status !== 'ok') {
    lines.push(`Zdraví: ${health.status}${health.note ? ' — ' + health.note : ''} (${shortDate(health.date)})`);
  }

  // připravenost dne
  try {
    const r = computeReadiness({ form, wellness, health });
    if (!r.empty) lines.push(`Připravenost dne: ${r.score}/100 — ${r.band.label}`);
  } catch {}

  // cíle / závody s odpočtem
  const ng = nextGoal(goals);
  if (ng) lines.push(`\nDalší závod: ${ng.title}${ng.sport ? ' (' + ng.sport + ')' : ''} — za ${ng.days} dní (${String(ng.date).slice(0, 10)})`);

  if (meas.length) {
    const w = meas.filter((m) => m.weight_kg != null).slice(0, 4);
    if (w.length) lines.push('\nVáha: ' + w.map((m) => `${m.weight_kg} kg (${shortDate(m.date)})`).join(', '));
    const h = meas.filter((m) => m.height_cm != null).slice(0, 2);
    if (h.length) lines.push('Výška: ' + h.map((m) => `${m.height_cm} cm (${shortDate(m.date)})`).join(', '));
  }
  if (nutr.length) {
    lines.push('\nVýživa (poslední):');
    for (const n of nutr.slice(0, 5)) lines.push(`  ${shortDate(n.date)}: ${n.text}`);
  }
  try {
    const ns = scoreNutrition(nutr);
    lines.push(`Strava dnes: bílkoviny ${ns.protein}, sacharidy ${ns.carbs}${ns.hasToday ? '' : ' (dnes zatím nic nezapsáno)'}`);
  } catch {}

  lines.push('\n' + routineDigest(routineState[todayKey()] || []));

  return lines.join('\n');
}

// Frontendu posíláme jen posledních pár dní zpráv — zbytek žije v „paměti".
const CHAT_WEEK = 7 * 24 * 3600 * 1000;
const CHAT_VISIBLE = 16; // max viditelných zpráv v UI
function chatView(state) {
  return {
    messages: (state.messages || []).slice(-CHAT_VISIBLE),
    hasMemory: Boolean(state.summary),
    aiEnabled: assistantEnabled(),
  };
}

// Týdenní kompaktace: zprávy starší než týden shrne do state.summary a zahodí je.
// Poběží max jednou týdně (lastCompact). Bez AI jen ořízne (bez shrnutí).
async function maybeCompact(state) {
  const now = Date.now();
  if (state.lastCompact && now - state.lastCompact < CHAT_WEEK) return false;
  const cutoff = now - CHAT_WEEK;
  const old = (state.messages || []).filter((m) => (m.ts || 0) < cutoff);
  const recent = (state.messages || []).filter((m) => (m.ts || 0) >= cutoff);
  if (old.length < 4) { // ještě není co kompaktovat — jen nastav základ
    if (!state.lastCompact) state.lastCompact = now;
    return false;
  }
  try {
    const summary = await summarizeChat({ messages: old, priorSummary: state.summary || '' });
    if (summary) state.summary = summary;
  } catch (e) { console.error('compact error:', e.message); }
  state.messages = recent;
  state.lastCompact = now;
  return true;
}

app.get('/api/chat', async (_req, res) => {
  try {
    const state = (await getChat()) || { messages: [] };
    res.json(chatView(state));
  } catch (err) {
    console.error('chat get error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se načíst chat.' });
  }
});

app.post('/api/chat/message', async (req, res) => {
  const message = (req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Prázdná zpráva.' });
  try {
    const state = (await getChat()) || { messages: [] };
    // jednou týdně zkompaktuj starší zprávy do paměti
    await maybeCompact(state);

    const digest = await buildDigest();
    const { text, diary } = await generateReply({ message, history: state.messages, digest, memory: state.summary || '' });

    // pojistka: zapiš výšku/váhu/spánek, i kdyby to AI minula
    let reply = text;
    try {
      const logged = await fallbackLogMetrics(message);
      if (logged.length) reply += `\n\n✅ Zapsal jsem: ${logged.join(', ')}.`;
    } catch (e) { console.error('fallback metrics error:', e.message); }

    const aiMsg = { role: 'ai', text: reply, ts: Date.now() };
    if (diary) aiMsg.diary = diary;
    state.messages.push({ role: 'user', text: message, ts: Date.now() });
    state.messages.push(aiMsg);
    state.messages = state.messages.slice(-60);
    await saveChat(state);
    res.json(chatView(state));
  } catch (err) {
    console.error('chat message error:', err.message);
    res.status(500).json({ error: 'Něco se pokazilo, zkus to znovu.' });
  }
});

// ---- Nedělní zhodnocení týdne (motivační proslov od parťáka) ----

// Pondělí 00:00 UTC aktuálního týdne + klíč týdne.
function weekMonday() {
  const x = new Date(); x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
const weekKeyStr = () => weekMonday().toISOString().slice(0, 10);

// Souhrn KONČÍCÍHO týdne pro proslov (jiný než denní digest — cílí na týden).
async function buildWeeklyDigest() {
  const [acts, routineState, wellness, goals, nutr] = await Promise.all([
    listActivities().catch(() => []),
    getRoutine().catch(() => ({})),
    listWellness().catch(() => []),
    listGoals().catch(() => []),
    listNutrition().catch(() => []),
  ]);
  const wk = weekMonday();
  const wkActs = acts.filter((a) => { const d = new Date(a.summary?.startTime || a.ts); return !isNaN(d) && d >= wk; });

  const lines = [`Neděle ${new Date().toISOString().slice(0, 10)} — shrnutí týdne od ${wk.toISOString().slice(0, 10)}.`];

  let km = 0, sec = 0, elev = 0; const bySport = {};
  for (const a of wkActs) {
    const s = a.summary || {};
    km += s.distanceKm || 0; sec += s.durationSec || 0; elev += s.elevationGainM || 0;
    const k = a.labels?.sport || s.sport || 'Aktivita';
    bySport[k] = (bySport[k] || 0) + 1;
  }
  lines.push(`Tréninků: ${wkActs.length}${wkActs.length ? ` (${Object.entries(bySport).map(([k, v]) => `${k} ${v}×`).join(', ')})` : ''}`);
  lines.push(`Objem: ${Math.round(km)} km, ${(sec / 3600).toFixed(1)} h, převýšení ${Math.round(elev)} m`);

  try {
    const ach = computeAchievements(acts, routineState);
    const earned = (ach.badges || []).filter((b) => b.earned);
    if (earned.length) lines.push('Odznaky týdne: ' + earned.map((b) => `${b.name} (${b.tier})`).join(', '));
    else lines.push('Odznaky týdne: zatím žádný — příště na ně vlétni.');
  } catch {}

  try { const f = computeForm(acts); if (!f.empty) lines.push(`Forma: kondice ${f.fitness}, únava ${f.fatigue}, forma ${f.form} (${f.trend})`); } catch {}

  // technika z tréninků týdne (kadence do kopců, drift, dojezdy v křeči)
  const wkAnlz = wkActs.map((a) => a.summary?.analysis).filter(Boolean);
  if (wkAnlz.length) {
    const grind = wkAnlz.filter((x) => x.cadenceClimb != null && x.cadenceClimb < 70).length;
    const drift = wkAnlz.filter((x) => x.hrDriftPct != null && x.hrDriftPct > 8).length;
    const faded = wkAnlz.filter((x) => x.fadePct != null && x.fadePct < -8).length;
    const t = [];
    if (grind) t.push(`${grind}× mletí těžkého převodu do kopce`);
    if (drift) t.push(`${drift}× vysoký tepový drift`);
    if (faded) t.push(`${faded}× dojezd v křeči`);
    if (t.length) lines.push('Technika k hlídání: ' + t.join(', '));
  }

  const wkWell = wellness.filter((w) => new Date(w.date) >= wk);
  if (wkWell.length) {
    const avg = (key) => { const v = wkWell.map((w) => w[key]).filter((x) => x != null); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; };
    const p = [];
    if (avg('sleep_hours') != null) p.push(`spánek ø ${avg('sleep_hours')} h`);
    if (avg('feel') != null) p.push(`pocit ø ${avg('feel')}/5`);
    if (avg('soreness') != null) p.push(`svalovka ø ${avg('soreness')}/5`);
    if (p.length) lines.push('Wellness: ' + p.join(', '));
  }

  try {
    const np = nutritionPeriod(nutr, wk.getTime());
    if (np.loggedDays) lines.push(`Strava: zapsáno ${np.loggedDays} dní, dost bílkovin ${np.proteinOk}/${np.loggedDays} dní, dost sacharidů ${np.carbOk}/${np.loggedDays} dní`);
    else lines.push('Strava: tenhle týden skoro nic nezapsáno.');
  } catch {}

  let rDays = 0; const wkMon = wk.toISOString().slice(0, 10);
  for (const day of Object.keys(routineState || {})) if (day >= wkMon && (routineState[day] || []).length) rDays++;
  lines.push(`Rutina: odcvičeno ${rDays} dní.`);

  const ng = nextGoal(goals);
  if (ng) lines.push(`Další cíl: ${ng.title} — za ${ng.days} dní.`);

  return lines.join('\n');
}

// Vygeneruje proslov, uloží ho jako zprávu parťáka a pošle push. Vrací text/null.
async function runWeeklyRecap() {
  if (!assistantEnabled()) return null;
  const digest = await buildWeeklyDigest();
  const text = await generateWeeklyRecap({ digest });
  if (!text) return null;
  const state = (await getChat()) || { messages: [] };
  state.messages.push({ role: 'ai', kind: 'recap', text, ts: Date.now() });
  state.messages = state.messages.slice(-60);
  await saveChat(state);
  try { await sendToAll({ title: 'TEMPO — zhodnocení týdne 🎉', body: 'Parťák ti shrnul týden a kam dál. Mrkni! 🚴🔥' }); } catch {}
  return text;
}

// Ruční spuštění (tlačítko v chatu / test).
app.post('/api/chat/recap', async (_req, res) => {
  try {
    const text = await runWeeklyRecap();
    if (!text) return res.status(400).json({ error: 'Zhodnocení potřebuje zapnuté AI (ANTHROPIC_API_KEY).' });
    const state = (await getChat()) || { messages: [] };
    res.json(chatView(state));
  } catch (err) {
    console.error('recap error:', err.message);
    res.status(500).json({ error: 'Zhodnocení se nepodařilo.' });
  }
});

// ---- Úspěchy: série, rekordy, odznaky ----
app.get('/api/achievements', async (_req, res) => {
  try {
    const [acts, routine] = await Promise.all([listActivities(), getRoutine()]);
    res.json(computeAchievements(acts, routine));
  } catch (err) {
    console.error('achievements error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se spočítat úspěchy.' });
  }
});

// ---- Denní rutina (odškrtávání cviků po dnech) ----
const todayKey = () => new Date().toISOString().slice(0, 10);

app.get('/api/routine', async (_req, res) => {
  try {
    const state = await getRoutine();
    res.json({ date: todayKey(), done: state[todayKey()] || [], routine: ROUTINE });
  } catch (err) {
    console.error('routine get error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se načíst rutinu.' });
  }
});

app.post('/api/routine/toggle', async (req, res) => {
  const exId = String(req.body?.exId || '');
  if (!exId) return res.status(400).json({ error: 'Chybí cvik.' });
  try {
    const state = await getRoutine();
    const key = todayKey();
    const set = new Set(state[key] || []);
    if (set.has(exId)) set.delete(exId); else set.add(exId);
    state[key] = [...set];
    // úklid: nech jen posledních ~30 dní
    const keys = Object.keys(state).sort();
    while (keys.length > 30) delete state[keys.shift()];
    await saveRoutine(state);
    res.json({ date: key, done: state[key] });
  } catch (err) {
    console.error('routine toggle error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se uložit.' });
  }
});

// ---- Připomínky (Web Push) ----
app.get('/api/push/key', (_req, res) => res.json({ key: vapidPublicKey(), enabled: pushReady() }));

app.post('/api/push/subscribe', async (req, res) => {
  try {
    await addPushSub(req.body?.subscription);
    res.json({ ok: true });
  } catch (err) {
    console.error('push subscribe error:', err.message);
    res.status(500).json({ error: 'Nepodařilo se zapnout připomínky.' });
  }
});

app.post('/api/push/test', async (_req, res) => {
  try {
    const r = await sendToAll({ title: 'TEMPO', body: 'Test připomínky — funguje! 🚴💪' });
    res.json(r);
  } catch (err) {
    console.error('push test error:', err.message);
    res.status(500).json({ error: 'Test se nepodařil.' });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ai: aiEnabled(), push: pushReady(), ...dbInfo() }));

// Plánovač (kontrola po 15 min):
//  - denní připomínka v REMIND_HOUR (push)
//  - nedělní zhodnocení týdne v RECAP_HOUR (proslov do chatu + push), max 1× za týden
const REMIND_HOUR = Number(process.env.PUSH_HOUR ?? 18); // ~19–20 h v ČR
const RECAP_HOUR = Number(process.env.RECAP_HOUR ?? 17); // neděle ~18–19 h v ČR
let lastRemind = null;
setInterval(async () => {
  const now = new Date();
  const t = now.toISOString().slice(0, 10);

  if (pushReady() && now.getUTCHours() === REMIND_HOUR && lastRemind !== t) {
    lastRemind = t;
    try { console.log('Denní připomínka:', JSON.stringify(await dailyReminderCheck())); }
    catch (e) { console.error('reminder error:', e.message); }
  }

  // neděle (getUTCDay()===0) v RECAP_HOUR — jednou za týden (klíč uložen v settings)
  if (now.getUTCDay() === 0 && now.getUTCHours() === RECAP_HOUR && assistantEnabled()) {
    try {
      const wk = weekKeyStr();
      const last = await getSetting('lastRecapWeek').catch(() => null);
      if (last !== wk) {
        await setSetting('lastRecapWeek', wk);
        const text = await runWeeklyRecap();
        console.log('Nedělní zhodnocení odesláno:', Boolean(text));
      }
    } catch (e) { console.error('recap schedule error:', e.message); }
  }
}, 15 * 60 * 1000);

initDb().finally(async () => {
  await initPush();
  app.listen(PORT, () => {
    console.log(`TEMPO běží na portu ${PORT}`);
  });
});
