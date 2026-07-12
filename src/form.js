// Forma & periodizace: z uložených aktivit spočítá tréninkovou zátěž,
// kondici (CTL), únavu (ATL) a formu (CTL−ATL) — zjednodušený model à la
// Banister/TrainingPeaks. Vše deterministicky, bez AI.

// Zátěž jedné aktivity (TRIMP-like): minuty v zóně × váha zóny.
function activityLoad(a) {
  const z = a.summary?.hrZones;
  if (z) {
    const w = { z1: 1, z2: 2, z3: 3, z4: 4, z5: 5 };
    let load = 0;
    for (const k in w) load += ((z[k] || 0) / 60) * w[k];
    if (load > 0) return Math.round(load);
  }
  // bez tepu: střední zátěž podle času
  const min = (a.summary?.durationSec || 0) / 60;
  return Math.round(min * 2);
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function mondayOf(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const dow = (x.getUTCDay() + 6) % 7; // 0 = pondělí
  return addDays(x, -dow);
}

export function computeForm(activities) {
  const byDay = {};
  for (const a of activities || []) {
    const raw = a.summary?.startTime || a.ts;
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    const key = dayKey(d);
    byDay[key] = (byDay[key] || 0) + activityLoad(a);
  }

  const days = Object.keys(byDay).sort();
  if (!days.length) return { empty: true };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(days[0] + 'T00:00:00Z');

  let ctl = 0, atl = 0;
  const daily = [];
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const load = byDay[dayKey(d)] || 0;
    ctl = ctl + (load - ctl) / 42; // kondice (dlouhá odezva)
    atl = atl + (load - atl) / 7; //  únava (krátká odezva)
    daily.push({ ctl, atl });
  }

  const fitness = Math.round(ctl);
  const fatigue = Math.round(atl);
  const form = Math.round(ctl - atl);

  const weekAgo = daily[daily.length - 8];
  const trend = weekAgo ? (ctl > weekAgo.ctl + 0.5 ? 'up' : ctl < weekAgo.ctl - 0.5 ? 'down' : 'flat') : 'flat';

  // týdenní zátěž (posledních 6 týdnů)
  const wkStart = mondayOf(today);
  const weeks = [];
  for (let i = 5; i >= 0; i--) {
    const ws = addDays(wkStart, -i * 7);
    const we = addDays(ws, 7);
    let load = 0;
    for (const [k, v] of Object.entries(byDay)) {
      const d = new Date(k + 'T00:00:00Z');
      if (d >= ws && d < we) load += v;
    }
    weeks.push({ label: i === 0 ? 'teď' : 'T-' + i, load: Math.round(load), current: i === 0 });
  }

  // kalendář konzistence: denní zátěž za posledních 16 týdnů (od pondělí)
  const calStart = addDays(mondayOf(today), -15 * 7);
  const calendar = [];
  for (let d = new Date(calStart); d <= today; d = addDays(d, 1)) {
    const k = dayKey(d);
    calendar.push({ date: k, load: byDay[k] || 0 });
  }

  return { empty: false, fitness, fatigue, form, trend, weeks, calendar, advice: advice(form, trend, weeks) };
}

function advice(form, trend, weeks) {
  const thisWk = weeks[weeks.length - 1]?.load || 0;
  const prevWk = weeks[weeks.length - 2]?.load || 0;

  if (form <= -15) {
    return 'Naskládal jsi toho hodně a únava je vysoká. Teď zařaď lehčí dny, spánek a jídlo — tělo zesílí při odpočinku. 😴';
  }
  if (form >= 8) {
    return 'Jsi vyladěný a čerstvý. Ideální čas na kvalitní trénink nebo závod — jdi do toho! 🔥';
  }
  if (trend === 'up' && thisWk >= prevWk) {
    return 'Forma pěkně roste a zátěž držíš. Přesně takhle se roste — pokračuj a nezapomeň na regeneraci. 💪';
  }
  if (trend === 'down') {
    return 'Zátěž poslední dobou klesá. Pokud nejsi ve vyladění na závod, přidej — cíl je špička. 🎯';
  }
  return 'Zátěž máš vyrovnanou. Drž pravidelnost a postupně přidávej kvalitu.';
}
