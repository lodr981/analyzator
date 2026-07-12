// „Připravenost dne" — jedno číslo 0–100 z formy + spánku + ranního pocitu +
// klidového tepu + zdravotního stavu. Deterministicky, bez AI. Vstupy chodí
// z parťák-chatu (spánek/pocit/tep/nemoc), forma z aktivit.

const HOURS = 36; // spánek/pocit se počítá jen když je čerstvý (dnes/ráno)

function recent(rec, maxHours = HOURS) {
  if (!rec?.date) return false;
  const t = new Date(rec.date).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t <= maxHours * 3600 * 1000;
}

// Vezmi nejnovější záznam, který má dané pole vyplněné.
function latestWith(list, field) {
  for (const r of list || []) if (r[field] != null) return r;
  return null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function computeReadiness({ form = null, wellness = [], health = null } = {}) {
  const reasons = [];
  let score = 70; // neutrální základ
  let have = false;

  // Forma (CTL−ATL): svěžest vs nálož
  if (form && !form.empty) {
    have = true;
    const f = form.form;
    if (f >= 5) { score += 12; reasons.push({ good: true, text: 'svěží forma' }); }
    else if (f <= -18) { score -= 22; reasons.push({ good: false, text: 'vysoká únava z tréninku' }); }
    else if (f <= -8) { score -= 12; reasons.push({ good: false, text: 'nasbíraná únava' }); }
    if (form.fatigue >= 45 && f > -8) reasons.push({ good: false, text: 'velká nálož poslední dny' });
  }

  // Spánek (teenager potřebuje ~9 h)
  const sleepRec = latestWith(wellness, 'sleep_hours');
  if (sleepRec && recent(sleepRec)) {
    have = true;
    const h = sleepRec.sleep_hours;
    if (h >= 8.5) { score += 12; reasons.push({ good: true, text: `super spánek (${h} h)` }); }
    else if (h >= 7.5) { score += 6; }
    else if (h >= 6.5) { score += 0; }
    else if (h >= 5.5) { score -= 12; reasons.push({ good: false, text: `málo spánku (${h} h)` }); }
    else { score -= 20; reasons.push({ good: false, text: `hodně málo spánku (${h} h)` }); }
  }

  // Ranní pocit 1–5
  const feelRec = latestWith(wellness, 'feel');
  if (feelRec && recent(feelRec)) {
    have = true;
    const fl = clamp(feelRec.feel, 1, 5);
    score += (fl - 3) * 8;
    if (fl >= 5) reasons.push({ good: true, text: 'cítíš se skvěle' });
    else if (fl <= 2) reasons.push({ good: false, text: 'cítíš se unaveně' });
  }

  // Svalovka (regenerace svalů)
  const soreRec = latestWith(wellness, 'soreness');
  if (soreRec && recent(soreRec)) {
    have = true;
    const s = clamp(soreRec.soreness, 1, 5);
    if (s >= 5) { score -= 16; reasons.push({ good: false, text: 'velká svalovka' }); }
    else if (s === 4) { score -= 9; reasons.push({ good: false, text: 'svalovka' }); }
    else if (s <= 1) { reasons.push({ good: true, text: 'svaly odpočaté' }); }
  }

  // Klidový tep vs baseline (zvýšený = únava/nemoc)
  const rhrRec = latestWith(wellness, 'resting_hr');
  if (rhrRec && recent(rhrRec, 48)) {
    const others = (wellness || []).filter((w) => w.resting_hr != null && w.id !== rhrRec.id).map((w) => w.resting_hr);
    if (others.length >= 3) {
      const base = others.reduce((a, b) => a + b, 0) / others.length;
      const diff = rhrRec.resting_hr - base;
      if (diff >= 7) { score -= 12; reasons.push({ good: false, text: `zvýšený klidový tep (+${Math.round(diff)})` }); }
      else if (diff >= 4) { score -= 6; }
      else if (diff <= -2) { reasons.push({ good: true, text: 'nízký klidový tep' }); }
    }
  }

  // Zdravotní stav: nemoc / bolístka má přednost a strop score
  let cap = 100;
  if (health?.status === 'nemoc' && recent(health, 24 * 6)) {
    cap = 30; have = true;
    reasons.unshift({ good: false, text: 'hlásíš nemoc — nech to být' });
  } else if (health?.status === 'zranění' && recent(health, 24 * 10)) {
    cap = 45; have = true;
    reasons.unshift({ good: false, text: 'hlásíš bolístku — opatrně' });
  }

  if (!have) return { empty: true };

  score = clamp(Math.round(score), 5, 99);
  score = Math.min(score, cap);

  return {
    empty: false,
    score,
    band: band(score),
    reasons: reasons.slice(0, 3),
  };
}

function band(s) {
  if (s >= 80) return { key: 'high', label: 'Na plný plyn', emoji: '🔥', color: '#C6FF4D', advice: 'Máš to nabité — dneska si klidně šlápni na kvalitu nebo intervaly.' };
  if (s >= 65) return { key: 'good', label: 'Dobrý den na trénink', emoji: '💪', color: '#3DE0FF', advice: 'Solidní připravenost. Zvládneš pořádný trénink, jen se hlídej.' };
  if (s >= 50) return { key: 'ok', label: 'V pohodě, s rozumem', emoji: '🙂', color: '#7C5CFF', advice: 'Jeď, ale nehrň to do maxima. Vnímej, jak se cítíš.' };
  if (s >= 35) return { key: 'low', label: 'Spíš lehce', emoji: '😌', color: '#FFB24D', advice: 'Tělo chce oddech. Volný trénink, technika, protažení.' };
  return { key: 'rest', label: 'Regeneruj', emoji: '😴', color: '#FF4D8D', advice: 'Dneska odpočívej — spánek a jídlo tě posunou víc než dřina.' };
}
