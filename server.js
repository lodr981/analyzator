import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseActivity } from './src/parse.js';
import { evaluate, sportLabel, sportIcon, fmtDuration } from './src/coach.js';
import { aiEnabled, generateCoachComment } from './src/aiCoach.js';
import { generatePlan, planAiEnabled } from './src/aiPlan.js';
import { computeForm } from './src/form.js';
import { generateReply, assistantEnabled } from './src/assistant.js';
import {
  initDb, dbBackend, addActivity, listActivities, deleteActivity, findByFingerprint,
  getPlan, savePlan, getChat, saveChat, listMeasurements, listNutrition,
} from './src/db.js';

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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Nahrání a vyhodnocení aktivity.
app.post('/api/upload', upload.single('activity'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žádný soubor. Nahraj .FIT, .TCX nebo .GPX.' });
  try {
    const summary = await parseActivity(req.file.buffer, req.file.originalname);

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

    // Ulož na server (best-effort — chyba DB nesmí shodit vyhodnocení).
    try {
      await addActivity(record);
    } catch (dbErr) {
      console.error('DB save error:', dbErr.message);
    }

    res.json(record);
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

// ---- Parťák chat (kontext nad vším) ----

const shortDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.`;
};

// Sestaví kompaktní kontext pro AI (ekonomicky — jen to podstatné).
async function buildDigest() {
  const [acts, planState, meas, nutr] = await Promise.all([
    listActivities().catch(() => []),
    getPlan().catch(() => null),
    listMeasurements().catch(() => []),
    listNutrition().catch(() => []),
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

  try {
    const f = computeForm(acts);
    if (!f.empty) lines.push(`\nForma: kondice ${f.fitness}, únava ${f.fatigue}, forma ${f.form} (${f.trend})`);
  } catch {}

  if (meas.length) {
    const w = meas.filter((m) => m.weight_kg != null).slice(0, 4);
    if (w.length) lines.push('\nVáha: ' + w.map((m) => `${m.weight_kg} kg (${shortDate(m.date)})`).join(', '));
  }
  if (nutr.length) {
    lines.push('\nVýživa (poslední):');
    for (const n of nutr.slice(0, 5)) lines.push(`  ${shortDate(n.date)}: ${n.text}`);
  }

  return lines.join('\n');
}

app.get('/api/chat', async (_req, res) => {
  try {
    const state = (await getChat()) || { messages: [] };
    res.json({ ...state, aiEnabled: assistantEnabled() });
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
    const digest = await buildDigest();
    const { text } = await generateReply({ message, history: state.messages, digest });

    state.messages.push({ role: 'user', text: message, ts: Date.now() });
    state.messages.push({ role: 'ai', text, ts: Date.now() });
    state.messages = state.messages.slice(-40);
    await saveChat(state);
    res.json({ ...state, aiEnabled: assistantEnabled() });
  } catch (err) {
    console.error('chat message error:', err.message);
    res.status(500).json({ error: 'Něco se pokazilo, zkus to znovu.' });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ai: aiEnabled(), db: dbBackend() }));

initDb().finally(() => {
  app.listen(PORT, () => {
    console.log(`TEMPO běží na portu ${PORT}`);
  });
});
