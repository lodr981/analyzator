// Gamifikace: série (streak), osobní rekordy a odznaky — deterministicky
// z uložených aktivit a rutiny (funguje i bez AI).

const DAY = 86400000;
const dayKey = (d) => d.toISOString().slice(0, 10);

function paceToSec(p) {
  const m = /^(\d+):(\d{1,2})$/.exec(String(p || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function secToPace(s) {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
function isoWeekKey(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow); // pondělí
  return x.toISOString().slice(0, 10);
}
function badge(id, icon, name, earned, value, target) {
  return { id, icon, name, earned, value, target, pct: Math.min(100, Math.round((value / target) * 100)) };
}

export function computeAchievements(activities = [], routineState = {}) {
  // aktivní dny (aktivita nebo hotová rutina)
  const active = new Set();
  for (const a of activities) {
    const d = new Date(a.summary?.startTime || a.ts);
    if (!isNaN(d)) active.add(dayKey(d));
  }
  for (const day of Object.keys(routineState || {})) {
    if ((routineState[day] || []).length) active.add(day);
  }

  // série do dneška (nebo do včerejška, když dnes ještě nic)
  let streak = 0;
  let cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!active.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY);
  while (active.has(dayKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - DAY);
  }

  // rekordy
  let longestKm = 0, fastest = 0, elev = 0, longestSec = 0, bestRun = null;
  const weekTotals = {};
  for (const a of activities) {
    const s = a.summary || {};
    if (s.distanceKm > longestKm) longestKm = s.distanceKm;
    if (s.avgSpeedKmh > fastest) fastest = s.avgSpeedKmh;
    if (s.elevationGainM > elev) elev = s.elevationGainM;
    if (s.durationSec > longestSec) longestSec = s.durationSec;
    if (s.sport === 'run' && s.pacePerKm) {
      const sec = paceToSec(s.pacePerKm);
      if (sec && (bestRun === null || sec < bestRun)) bestRun = sec;
    }
    if (s.distanceKm != null) {
      const d = new Date(s.startTime || a.ts);
      if (!isNaN(d)) { const wk = isoWeekKey(d); weekTotals[wk] = (weekTotals[wk] || 0) + s.distanceKm; }
    }
  }
  const maxWeek = Math.max(0, ...Object.values(weekTotals));

  const badges = [
    badge('first', '🚴', 'První jízda', activities.length >= 1, activities.length, 1),
    badge('ten', '🔟', '10 tréninků', activities.length >= 10, activities.length, 10),
    badge('fifty', '⭐', '50 tréninků', activities.length >= 50, activities.length, 50),
    badge('streak7', '🔥', '7 dní v kuse', streak >= 7, streak, 7),
    badge('week100', '💯', '100 km za týden', maxWeek >= 100, Math.round(maxWeek), 100),
    badge('climb1000', '🏔️', '1000 m v jedné jízdě', elev >= 1000, Math.round(elev), 1000),
    badge('long3h', '⏱️', '3 h v sedle', longestSec >= 3 * 3600, Math.round(longestSec / 60), 180),
  ];

  return {
    streak,
    records: {
      longestKm: longestKm || null,
      fastestKmh: fastest || null,
      elevationM: elev || null,
      longestTimeSec: longestSec || null,
      bestRunPace: bestRun ? secToPace(bestRun) : null,
    },
    badges,
  };
}
