// Gamifikace: série (streak), osobní rekordy a odznaky — deterministicky
// z uložených aktivit a rutiny (funguje i bez AI).
//
// Odznaky mají 3 úrovně, kalibrované na 14letého kadeta s cílem špička:
//   🥉 bronz  = slušná/šikovná úroveň
//   🥈 stříbro = česká špička kadetů
//   🥇 zlato  = evropská špička kadetů

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

// Tříúrovňový odznak. tiers = [bronz, stříbro, zlato]. round = zaokrouhlení hodnoty.
function tierBadge(id, icon, name, unit, value, tiers, round = 0) {
  const [b, s, g] = tiers;
  const v = Number(value) || 0;
  let tier = null;
  if (v >= g) tier = 'gold';
  else if (v >= s) tier = 'silver';
  else if (v >= b) tier = 'bronze';
  const next = v >= g ? null : v >= s ? g : v >= b ? s : b;
  const f = round ? Math.round(v * 10 ** round) / 10 ** round : Math.round(v);
  return {
    id, icon, name, unit,
    tier,
    earned: tier !== null,
    value: f,
    tiers,
    next,
    pct: next == null ? 100 : Math.min(100, Math.round((v / next) * 100)),
  };
}

export function computeAchievements(activities = [], routineState = {}) {
  // aktivní dny (aktivita nebo hotová rutina)
  const active = new Set();
  for (const a of activities) {
    const d = new Date(a.summary?.startTime || a.ts);
    if (!isNaN(d)) active.add(dayKey(d));
  }
  let routineDays = 0;
  for (const day of Object.keys(routineState || {})) {
    if ((routineState[day] || []).length) { active.add(day); routineDays++; }
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

  // rekordy + týdenní součty (km i hodiny)
  let longestKm = 0, fastest = 0, elev = 0, longestSec = 0, bestRun = null, longestRunKm = 0;
  const weekKm = {}, weekSec = {};
  for (const a of activities) {
    const s = a.summary || {};
    if (s.distanceKm > longestKm) longestKm = s.distanceKm;
    if (s.avgSpeedKmh > fastest) fastest = s.avgSpeedKmh;
    if (s.elevationGainM > elev) elev = s.elevationGainM;
    if (s.durationSec > longestSec) longestSec = s.durationSec;
    if (s.sport === 'run') {
      if (s.distanceKm > longestRunKm) longestRunKm = s.distanceKm;
      if (s.pacePerKm) {
        const sec = paceToSec(s.pacePerKm);
        if (sec && (bestRun === null || sec < bestRun)) bestRun = sec;
      }
    }
    const d = new Date(s.startTime || a.ts);
    if (!isNaN(d)) {
      const wk = isoWeekKey(d);
      if (s.distanceKm != null) weekKm[wk] = (weekKm[wk] || 0) + s.distanceKm;
      if (s.durationSec != null) weekSec[wk] = (weekSec[wk] || 0) + s.durationSec;
    }
  }
  const maxWeekKm = Math.max(0, ...Object.values(weekKm));
  const maxWeekH = Math.max(0, ...Object.values(weekSec)) / 3600;

  // jednoduchý startovní odznak (bez úrovní)
  const first = {
    id: 'first', icon: '🚴', name: 'První jízda', unit: '',
    tier: activities.length >= 1 ? 'bronze' : null, earned: activities.length >= 1,
    value: activities.length >= 1 ? 1 : 0, tiers: null, next: activities.length >= 1 ? null : 1, pct: activities.length >= 1 ? 100 : 0,
  };

  const badges = [
    first,
    tierBadge('weekhours', '⏱️', 'Týdenní objem', 'h', maxWeekH, [10, 12, 14], 1),
    tierBadge('weekkm', '💯', 'Týdenní nálož', 'km', maxWeekKm, [100, 150, 220]),
    tierBadge('longride', '🚴', 'Nejdelší jízda', 'km', longestKm, [60, 100, 140]),
    tierBadge('climb', '🏔️', 'Král stoupání', 'm', elev, [800, 1500, 2500]),
    tierBadge('saddle', '⏳', 'Nejdéle v sedle', 'min', longestSec / 60, [120, 180, 240]),
    tierBadge('run', '🏃', 'Běžec', 'km', longestRunKm, [5, 8, 12]),
    tierBadge('core', '💪', 'Core mašina', 'dní', routineDays, [5, 12, 25]),
    tierBadge('grind', '⭐', 'Dříč', '', activities.length, [25, 75, 200]),
    tierBadge('streak', '🔥', 'Série', 'dní', streak, [7, 14, 30]),
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
