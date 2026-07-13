// Odhad kvality stravy z volných záznamů (co Oliver napsal parťákovi).
// Deterministicky podle klíčových slov — nepotřebuje AI. Vyjádří, jestli má
// dost bílkovin a sacharidů, a poradí, co doplnit.

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// kmeny slov (bez diakritiky) — stačí, že se v textu vyskytnou
const PROTEIN = ['kusk', 'kure', 'kurec', 'maso', 'hovez', 'veprov', 'krut', 'ryba', 'rybu', 'losos', 'tunak',
  'vejc', 'vajic', 'vejce', 'omeleta', 'tvaroh', 'jogurt', 'skyr', 'syr', 'cottage', 'protein', 'sunk',
  'cocka', 'fazol', 'cizrn', 'hrach', 'luste', 'tofu', 'steak', 'rizek', 'burger'];
const CARBS = ['testovin', 'ryze', 'rizot', 'chleb', 'chleba', 'rohlik', 'houska', 'peciv', 'toust', 'tortilla',
  'wrap', 'brambor', 'hranolk', 'ovesn', 'kase', 'musli', 'granol', 'banan', 'ovoce', 'jablk', 'ryzov',
  'knedl', 'palacink', 'lievance', 'cukr', 'med', 'datl', 'gel', 'tycink'];

function countHits(text, list) {
  const n = norm(text);
  let c = 0;
  for (const k of list) if (n.includes(k)) c++;
  return c;
}

function level(hits) {
  if (hits <= 0) return 'nízká';
  if (hits <= 1) return 'střední';
  return 'vysoká';
}

const todayKey = () => new Date().toISOString().slice(0, 10);
const dayKey = (iso) => (iso ? String(iso).slice(0, 10) : '');

// Ohodnotí libovolný text jídla (pro deník za období, ne jen dnešek).
export function scoreText(text) {
  return { protein: level(countHits(text, PROTEIN)), carbs: level(countHits(text, CARBS)) };
}

// Souhrn stravy za období: kolik dní bylo zapsáno a v kolika bylo dost bílkovin/sacharidů.
export function nutritionPeriod(entries, cutoffMs) {
  const byDay = {};
  for (const e of entries || []) {
    const t = new Date(e.date).getTime();
    if (isNaN(t) || t < cutoffMs) continue;
    const d = dayKey(e.date);
    (byDay[d] = byDay[d] || []).push(e.text || '');
  }
  const days = Object.keys(byDay);
  let proteinOk = 0, carbOk = 0;
  for (const d of days) {
    const s = scoreText(byDay[d].join(' ; '));
    if (s.protein !== 'nízká') proteinOk++;
    if (s.carbs !== 'nízká') carbOk++;
  }
  return { loggedDays: days.length, proteinOk, carbOk };
}

export function scoreNutrition(entries) {
  const list = entries || [];
  const tKey = todayKey();
  const todays = list.filter((e) => dayKey(e.date) === tKey);
  const text = todays.map((e) => e.text).join(' ; ');

  const pHits = countHits(text, PROTEIN);
  const cHits = countHits(text, CARBS);
  const protein = level(pHits);
  const carbs = level(cHits);

  const tips = [];
  if (!todays.length) {
    tips.push('Dnes zatím nic — napiš parťákovi, co jsi jedl.');
  } else {
    if (protein === 'nízká') tips.push('Málo bílkovin — přidej maso, rybu, vejce, tvaroh nebo luštěniny (svaly se staví z bílkovin).');
    if (carbs === 'nízká') tips.push('Málo sacharidů — rýže, těstoviny, ovesná kaše nebo banán dodají energii na trénink.');
    if (protein !== 'nízká' && carbs !== 'nízká') tips.push('Slušně vyvážené 👍 Jen drž pití a bílkoviny po tréninku.');
  }

  return {
    hasToday: todays.length > 0,
    protein,
    carbs,
    proteinHits: pHits,
    carbHits: cHits,
    mealsToday: todays.length,
    tips,
  };
}
