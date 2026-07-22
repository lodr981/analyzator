// Podrobná analýza tréninku z časové řady vzorků (tep, výška, vzdálenost,
// kadence, výkon). Deterministicky spočítá věci, co trenér řeší:
// kadenci do kopců (mletí těžkého převodu), tepovou odezvu/drift, rozložení
// sil (fade / negativní split), stoupání a výkon. Vrací null, když je dat málo.

export function analyze(samples, { sport = 'bike' } = {}) {
  const S = (samples || []).filter((s) => s.t != null).sort((a, b) => a.t - b.t);
  if (S.length < 8) return null;

  const t0 = S[0].t;
  const durSec = (S[S.length - 1].t - t0) / 1000;
  if (!(durSec > 60)) return null;

  const hasAlt = S.some((s) => s.alt != null);
  const hasDist = S.some((s) => s.dist != null);
  const hasHr = S.some((s) => s.hr != null);
  const hasCad = S.some((s) => s.cad != null && s.cad > 0);
  const hasPwr = S.some((s) => s.pwr != null && s.pwr > 0);

  // vyhlazená výška (potlačí GPS šum)
  const alt = S.map((s) => s.alt);
  const altS = alt.map((a, i) => {
    if (a == null) return null;
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(alt.length - 1, i + 2); j++) {
      if (alt[j] != null) { sum += alt[j]; c++; }
    }
    return c ? sum / c : a;
  });
  const dist = S.map((s) => s.dist);

  let climbSec = 0, climbGain = 0;
  let climbCadSum = 0, climbCadCnt = 0, grindCnt = 0;
  let flatCadSum = 0, flatCadCnt = 0;
  let cadSum = 0, cadCnt = 0;
  let pwrSum = 0, pwrCnt = 0, climbPwrSum = 0, climbPwrCnt = 0;

  for (let i = 1; i < S.length; i++) {
    let dt = (S[i].t - S[i - 1].t) / 1000;
    if (!(dt > 0) || dt > 30) continue; // pauza

    // sklon: lookback ~30 m po vzdálenosti
    let grade = null;
    if (hasAlt && hasDist && dist[i] != null && altS[i] != null) {
      let k = i;
      while (k > 0 && dist[k] != null && (dist[i] - dist[k]) < 30) k--;
      if (k < i && dist[k] != null && altS[k] != null && dist[i] - dist[k] > 0) {
        grade = ((altS[i] - altS[k]) / (dist[i] - dist[k])) * 100;
      }
    }
    const climbing = grade != null && grade > 3;

    const cad = S[i].cad;
    if (cad != null && cad > 0) { cadSum += cad; cadCnt++; }
    const pwr = S[i].pwr;
    if (pwr != null && pwr > 0) { pwrSum += pwr; pwrCnt++; }

    if (climbing) {
      climbSec += dt;
      if (altS[i] != null && altS[i - 1] != null && altS[i] > altS[i - 1]) climbGain += altS[i] - altS[i - 1];
      if (cad != null && cad > 0) { climbCadSum += cad; climbCadCnt++; if (cad < 70) grindCnt++; }
      if (pwr != null && pwr > 0) { climbPwrSum += pwr; climbPwrCnt++; }
    } else if (cad != null && cad > 0) {
      flatCadSum += cad; flatCadCnt++;
    }
  }

  // Tepová odezva / drift: první vs druhá časová půlka
  let hrDriftPct = null, avgHr1 = null, avgHr2 = null;
  if (hasHr) {
    const mid = t0 + (durSec * 1000) / 2;
    let s1 = 0, c1 = 0, s2 = 0, c2 = 0;
    for (const s of S) {
      if (s.hr == null) continue;
      if (s.t < mid) { s1 += s.hr; c1++; } else { s2 += s.hr; c2++; }
    }
    if (c1 && c2) { avgHr1 = s1 / c1; avgHr2 = s2 / c2; hrDriftPct = ((avgHr2 - avgHr1) / avgHr1) * 100; }
  }

  // Rozložení sil: rychlost první vs druhá půlka (z ujeté vzdálenosti)
  let fadePct = null;
  if (hasDist) {
    const mid = t0 + (durSec * 1000) / 2;
    const firstDist = dist.filter((d, i) => d != null && S[i].t != null);
    if (firstDist.length >= 2) {
      let dStart = null, dMid = null, dEnd = null;
      for (let i = 0; i < S.length; i++) {
        if (dist[i] == null) continue;
        if (dStart == null) dStart = dist[i];
        if (dMid == null && S[i].t >= mid) dMid = dist[i];
        dEnd = dist[i];
      }
      if (dStart != null && dMid != null && dEnd != null) {
        const half = durSec / 2;
        const v1 = (dMid - dStart) / half;
        const v2 = (dEnd - dMid) / half;
        if (v1 > 0.3) fadePct = ((v2 - v1) / v1) * 100;
      }
    }
  }

  const avgCad = cadCnt ? Math.round(cadSum / cadCnt) : null;
  // Kadence běhu = kroky/min. Garmin ukládá kroky na JEDNU nohu (~85), tak zdvojnásob.
  const runCadence = sport === 'run' && avgCad != null ? (avgCad < 120 ? avgCad * 2 : avgCad) : null;

  // Běžecká dynamika (jen běh) — průměry přes vzorky s hodnotou.
  const avgOf = (key, norm) => {
    const v = S.map((s) => s[key]).filter((x) => x != null && x > 0).map(norm || ((x) => x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  let stepLenCm = null, vertOscCm = null, vertRatio = null, groundMs = null;
  if (sport === 'run') {
    // fit-file-parser někdy vrací délky v metrech → normalizuj na mm
    const toMm = (x) => (x < 3 ? x * 1000 : x);
    const sl = avgOf('sl', toMm), vo = avgOf('vo', toMm);
    stepLenCm = sl != null ? Math.round(sl / 10) : null;   // cm
    vertOscCm = vo != null ? +(vo / 10).toFixed(1) : null; // cm
    const vr = avgOf('vr'); vertRatio = vr != null ? +vr.toFixed(1) : null;
    const gct = avgOf('gct'); groundMs = gct != null ? Math.round(gct < 10 ? gct * 1000 : gct) : null;
  }

  return {
    sport,
    durSec: Math.round(durSec),
    hasCad, hasPwr,
    runCadence,
    stepLenCm, vertOscCm, vertRatio, groundMs,
    avgCadence: avgCad,
    cadenceClimb: climbCadCnt ? Math.round(climbCadSum / climbCadCnt) : null,
    cadenceFlat: flatCadCnt ? Math.round(flatCadSum / flatCadCnt) : null,
    grindClimbPct: climbCadCnt ? Math.round((grindCnt / climbCadCnt) * 100) : null,
    climbSec: Math.round(climbSec) || null,
    climbGain: Math.round(climbGain) || null,
    avgHr1: avgHr1 != null ? Math.round(avgHr1) : null,
    avgHr2: avgHr2 != null ? Math.round(avgHr2) : null,
    hrDriftPct: hrDriftPct != null ? +hrDriftPct.toFixed(1) : null,
    fadePct: fadePct != null ? +fadePct.toFixed(1) : null,
    avgPower: pwrCnt ? Math.round(pwrSum / pwrCnt) : null,
    climbPower: climbPwrCnt ? Math.round(climbPwrSum / climbPwrCnt) : null,
  };
}
