// Parsování aktivit z Garminu do jednotného tvaru.
// Podporuje .FIT, .TCX a .GPX. Vrací normalizovaný souhrn + časovou řadu tepu.

import { XMLParser } from 'fast-xml-parser';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
});

// ---- pomocné ----

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Odhad max. tepu (Tanaka) když ho neznáme; pro mladého závodníka lze přepsat.
export function estimateMaxHr(age) {
  if (!age) return 200;
  return Math.round(208 - 0.7 * age);
}

// Typický interval vzorkování (medián) — Garmin nahrává po 1 s i po delších úsecích.
function medianInterval(samples) {
  const diffs = [];
  for (let i = 1; i < samples.length; i++) {
    const d = (samples[i].t - samples[i - 1].t) / 1000;
    if (Number.isFinite(d) && d > 0) diffs.push(d);
  }
  if (!diffs.length) return 1;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

// Rozdělení času do tepových zón podle % max. tepu.
function computeZones(samples, maxHr) {
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  const med = medianInterval(samples);
  for (let i = 1; i < samples.length; i++) {
    const hr = samples[i].hr;
    if (hr == null) continue;
    let dt = (samples[i].t - samples[i - 1].t) / 1000; // sekundy
    // delší mezera = pauza; počítej ji jen jako jeden typický interval
    if (!Number.isFinite(dt) || dt <= 0 || dt > med * 4) dt = med;
    const pct = (hr / maxHr) * 100;
    if (pct < 60) zones.z1 += dt;
    else if (pct < 70) zones.z2 += dt;
    else if (pct < 80) zones.z3 += dt;
    else if (pct < 90) zones.z4 += dt;
    else zones.z5 += dt;
  }
  for (const k of Object.keys(zones)) zones[k] = Math.round(zones[k]);
  return zones;
}

// Z časové řady spočítá souhrn (fallback, když chybí session totals).
function summarizeSamples(samples) {
  let dist = 0, gain = 0, hrSum = 0, hrCount = 0, hrMax = 0, prevAlt = null;
  const first = samples[0], last = samples[samples.length - 1];
  for (const s of samples) {
    if (s.hr != null) { hrSum += s.hr; hrCount++; hrMax = Math.max(hrMax, s.hr); }
    if (s.alt != null) {
      if (prevAlt != null && s.alt - prevAlt > 0) gain += s.alt - prevAlt;
      prevAlt = s.alt;
    }
    if (s.dist != null) dist = Math.max(dist, s.dist);
  }
  const durationSec = first && last ? Math.round((last.t - first.t) / 1000) : 0;
  return {
    distanceM: dist || null,
    durationSec: durationSec || null,
    avgHr: hrCount ? Math.round(hrSum / hrCount) : null,
    maxHr: hrMax || null,
    elevationGainM: Math.round(gain) || null,
  };
}

// Poskládá výsledný objekt z (částečného) souhrnu + vzorků.
// geo = měl soubor GPS/výškovou stopu (venku). Bez ní + neznámý sport + vzdálenost
// + pomalé tempo = nejspíš plavání v bazénu (Garmin ho v TCX exportuje jako "Other").
function build({ sport, startTime, totals, samples, maxHr, geo = true }) {
  const derived = summarizeSamples(samples);
  const durationSec = totals.durationSec ?? derived.durationSec;
  const distanceM = totals.distanceM ?? derived.distanceM;
  const avgHr = totals.avgHr ?? derived.avgHr;
  const usedMaxHr = maxHr || derived.maxHr || estimateMaxHr(14) + 6; // hlavička pro 14 let

  const distanceKm = distanceM != null ? +(distanceM / 1000).toFixed(1) : null;
  const avgSpeedKmh =
    distanceM != null && durationSec
      ? +((distanceM / durationSec) * 3.6).toFixed(1)
      : null;

  const elevGain = totals.elevationGainM ?? derived.elevationGainM;
  const flatish = elevGain == null || elevGain < 20; // skoro žádné převýšení (na vodě)

  // Odhad plavání, když Garmin sport nezná ("Other"):
  //  - bazén: žádná GPS/výšková stopa + pomalé tempo
  //  - otevřená voda: má GPS, ale je to ploché a pomalé (plave se ~1,5–6 km/h)
  let sportFinal = sport || 'unknown';
  if (sportFinal === 'unknown' && distanceM > 0 && avgSpeedKmh != null) {
    if (!geo && avgSpeedKmh < 7) sportFinal = 'swim';
    else if (geo && flatish && avgSpeedKmh < 6) sportFinal = 'swim';
  }

  const pacePerKm =
    distanceM && durationSec
      ? formatPace(durationSec / (distanceM / 1000))
      : null;
  const pacePer100m =
    sportFinal === 'swim' && distanceM && durationSec
      ? formatPace(durationSec / (distanceM / 100))
      : null;

  return {
    sport: sportFinal,
    startTime: startTime || (samples[0] ? new Date(samples[0].t).toISOString() : null),
    durationSec,
    distanceKm,
    avgSpeedKmh,
    pacePerKm,
    pacePer100m,
    avgHr,
    maxHr: totals.maxHr ?? derived.maxHr,
    elevationGainM: totals.elevationGainM ?? derived.elevationGainM,
    hrZones: computeZones(samples, usedMaxHr),
    samplesCount: samples.length,
  };
}

function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm)) return null;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- FIT ----

async function parseFit(buffer) {
  const mod = await import('fit-file-parser');
  const FitParser = mod.default?.default || mod.default || mod;
  const fitParser = new FitParser({
    force: true,
    speedUnit: 'km/h',
    lengthUnit: 'm',
    mode: 'list',
    elapsedRecordField: true,
  });

  const data = await new Promise((resolve, reject) => {
    fitParser.parse(buffer, (err, d) => (err ? reject(err) : resolve(d)));
  });

  const records = toArray(data.records);
  const samples = records
    .map((r) => ({
      t: r.timestamp ? new Date(r.timestamp).getTime() : null,
      hr: num(r.heart_rate),
      dist: num(r.distance),
      alt: num(r.enhanced_altitude ?? r.altitude),
    }))
    .filter((s) => s.t != null);

  const session = toArray(data.sessions)[0] || {};
  const totals = {
    distanceM: num(session.total_distance),
    durationSec: num(session.total_timer_time ?? session.total_elapsed_time),
    avgHr: num(session.avg_heart_rate),
    maxHr: num(session.max_heart_rate),
    elevationGainM: num(session.total_ascent),
  };

  const geo = samples.some((s) => s.alt != null);
  return build({
    sport: normalizeSport(session.sport || session.sub_sport),
    startTime: session.start_time ? new Date(session.start_time).toISOString() : null,
    totals,
    samples,
    maxHr: null,
    geo,
  });
}

// ---- TCX ----

function parseTcx(text) {
  const doc = xml.parse(text);
  const activity = toArray(doc?.TrainingCenterDatabase?.Activities?.Activity)[0] || {};
  const laps = toArray(activity.Lap);

  let durationSec = 0, distanceM = 0, geo = false;
  const samples = [];
  for (const lap of laps) {
    durationSec += num(lap.TotalTimeSeconds) || 0;
    distanceM += num(lap.DistanceMeters) || 0;
    for (const tp of toArray(lap?.Track?.Trackpoint)) {
      const alt = num(tp.AltitudeMeters);
      if (alt != null || tp.Position != null) geo = true; // venku (GPS/výška)
      samples.push({
        t: tp.Time ? new Date(tp.Time).getTime() : null,
        hr: num(tp?.HeartRateBpm?.Value),
        dist: num(tp.DistanceMeters),
        alt,
      });
    }
  }

  return build({
    sport: normalizeSport(activity['@_Sport']),
    startTime: activity.Id || null,
    totals: {
      distanceM: distanceM || null,
      durationSec: durationSec || null,
      avgHr: null,
      maxHr: null,
      elevationGainM: null,
    },
    samples: samples.filter((s) => s.t != null),
    maxHr: null,
    geo,
  });
}

// ---- GPX ----

function parseGpx(text) {
  const doc = xml.parse(text);
  const trk = toArray(doc?.gpx?.trk)[0] || {};
  const samples = [];
  for (const seg of toArray(trk.trkseg)) {
    for (const pt of toArray(seg.trkpt)) {
      const ext = pt?.extensions;
      const hr =
        ext?.['gpxtpx:TrackPointExtension']?.['gpxtpx:hr'] ??
        ext?.['ns3:TrackPointExtension']?.['ns3:hr'] ??
        ext?.hr;
      samples.push({
        t: pt.time ? new Date(pt.time).getTime() : null,
        hr: num(hr),
        dist: null,
        alt: num(pt.ele),
      });
    }
  }
  return build({
    sport: 'unknown',
    startTime: samples[0]?.t ? new Date(samples[0].t).toISOString() : null,
    totals: { distanceM: null, durationSec: null, avgHr: null, maxHr: null, elevationGainM: null },
    samples: samples.filter((s) => s.t != null),
    maxHr: null,
  });
}

function normalizeSport(s) {
  if (!s) return 'unknown';
  const v = String(s).toLowerCase();
  if (v.includes('bik') || v.includes('cycl') || v.includes('kolo')) return 'bike';
  if (v.includes('run') || v.includes('běh') || v.includes('beh')) return 'run';
  if (v.includes('swim') || v.includes('plav')) return 'swim';
  if (v.includes('hik') || v.includes('walk') || v.includes('túr') || v.includes('chůz') || v.includes('chuz')) return 'hike';
  if (v.includes('ski') || v.includes('běžk') || v.includes('bezk')) return 'ski';
  // Garmin nespecifikované/„jiné" (typicky bazén, kardio) → neznámý (dořeší heuristika)
  if (v === 'other' || v === 'multisport' || v === 'training' || v === 'fitness_equipment' || v === 'generic') return 'unknown';
  return v;
}

// ---- veřejné API ----

export async function parseActivity(buffer, filename = '') {
  const ext = filename.toLowerCase().split('.').pop();

  // Garmin „Export originálu" stáhne FIT zabalený v ZIPu — rozbal a vezmi aktivitu uvnitř.
  if ((buffer[0] === 0x50 && buffer[1] === 0x4b) || ext === 'zip') {
    const { default: AdmZip } = await import('adm-zip');
    const entries = new AdmZip(buffer).getEntries();
    const entry = entries.find((e) => /\.(fit|tcx|gpx)$/i.test(e.entryName));
    if (!entry) throw new Error('V ZIPu není .FIT/.TCX/.GPX aktivita.');
    return parseActivity(entry.getData(), entry.entryName);
  }

  const head = buffer.slice(0, 12).toString('utf8');
  if (ext === 'fit' || head.includes('.FIT')) return parseFit(buffer);

  const text = buffer.toString('utf8');
  if (ext === 'tcx' || text.includes('TrainingCenterDatabase')) return parseTcx(text);
  if (ext === 'gpx' || text.includes('<gpx')) return parseGpx(text);

  throw new Error('Nepodporovaný formát. Nahraj .FIT, .TCX, .GPX nebo .ZIP z Garminu.');
}
