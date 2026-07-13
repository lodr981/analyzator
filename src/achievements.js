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
// Začátek aktuálního týdne (pondělí 00:00 UTC) — odznaky se každé pondělí resetují.
function weekStart() {
  const x = new Date();
  x.setUTCHours(0, 0, 0, 0);
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
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

  // ---- ODZNAKY TÝDNE (jen z aktuálního týdne, reset každé pondělí) ----
  const wk = weekStart();
  const wkMonday = dayKey(wk);
  let wkKm = 0, wkSec = 0, wkLongRide = 0, wkLongSec = 0, wkClimb = 0, wkLongRun = 0, wkCount = 0;
  for (const a of activities) {
    const d = new Date(a.summary?.startTime || a.ts);
    if (isNaN(d) || d < wk) continue;
    const s = a.summary || {};
    wkCount++;
    wkKm += s.distanceKm || 0;
    wkSec += s.durationSec || 0;
    if ((s.distanceKm || 0) > wkLongRide) wkLongRide = s.distanceKm || 0;
    if ((s.durationSec || 0) > wkLongSec) wkLongSec = s.durationSec || 0;
    if ((s.elevationGainM || 0) > wkClimb) wkClimb = s.elevationGainM || 0;
    if (s.sport === 'run' && (s.distanceKm || 0) > wkLongRun) wkLongRun = s.distanceKm || 0;
  }
  let wkRoutineDays = 0;
  for (const day of Object.keys(routineState || {})) {
    if (day >= wkMonday && (routineState[day] || []).length) wkRoutineDays++;
  }

  const badges = [
    tierBadge('weekhours', '⏱️', 'Týdenní objem', 'h', wkSec / 3600, [10, 12, 14], 1),
    tierBadge('weekkm', '💯', 'Týdenní nálož', 'km', wkKm, [100, 150, 220]),
    tierBadge('sessions', '📅', 'Tréninků', '', wkCount, [4, 6, 8]),
    tierBadge('longride', '🚴', 'Nejdelší jízda', 'km', wkLongRide, [60, 100, 140]),
    tierBadge('climb', '🏔️', 'Král stoupání', 'm', wkClimb, [800, 1500, 2500]),
    tierBadge('saddle', '⏳', 'Nejdéle v sedle', 'min', wkLongSec / 60, [90, 150, 210]),
    tierBadge('run', '🏃', 'Běžec', 'km', wkLongRun, [5, 8, 12]),
    tierBadge('core', '💪', 'Core mašina', 'dní', wkRoutineDays, [3, 5, 7]),
  ];

  return {
    weekStart: wkMonday,
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
