// "Trenér" — z parsovaného souhrnu udělá hodnocení a komentář.
// Zatím pravidlový (tvrdší, povzbuzující tón pro mladého závodníka s cílem EU špička).
// Strukturováno tak, aby šlo textovou část později nahradit Claude API.

const SPORT_LABEL = {
  bike: 'Jízda na kole',
  run: 'Běh',
  swim: 'Plavání',
  hike: 'Túra',
  ski: 'Běžky',
  unknown: 'Aktivita',
};

const SPORT_ICON = {
  bike: '🚴', run: '🏃', swim: '🏊', hike: '🥾', ski: '⛷️', unknown: '❤️',
};

export function sportLabel(s) { return SPORT_LABEL[s] || SPORT_LABEL.unknown; }
export function sportIcon(s) { return SPORT_ICON[s] || SPORT_ICON.unknown; }

export function fmtDuration(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function zoneTotals(z) {
  const total = z.z1 + z.z2 + z.z3 + z.z4 + z.z5 || 1;
  const pct = (v) => Math.round((v / total) * 100);
  return {
    total,
    pct: { z1: pct(z.z1), z2: pct(z.z2), z3: pct(z.z3), z4: pct(z.z4), z5: pct(z.z5) },
    hardMin: Math.round((z.z3 + z.z4 + z.z5) / 60),
  };
}

// Hlavní hodnocení. Vrací strukturu, kterou frontend vykreslí.
export function evaluate(summary) {
  const z = zoneTotals(summary.hrZones);
  const good = [];
  const improve = [];
  const chips = [];
  let score = 3;

  const durMin = summary.durationSec ? Math.round(summary.durationSec / 60) : 0;
  const hasHr = summary.avgHr != null;

  // --- objem / trvání ---
  if (durMin >= 90) { good.push('Solidní objem'); score += 0.5; chips.push({ icon: '✅', text: 'dobrý objem' }); }
  else if (durMin > 0 && durMin < 30) { improve.push('Krátké — na tvůj cíl to chce delší jednotky'); score -= 0.3; }

  // --- rozložení intenzity ---
  if (hasHr) {
    if (z.pct.z1 + z.pct.z2 >= 75 && durMin >= 75) {
      good.push('Poctivá vytrvalost v základu');
      chips.push({ icon: '✅', text: 'klidný základ' });
    }
    if (z.hardMin >= 20) {
      good.push(`${z.hardMin} min ve vyšších zónách — kvalita byla`);
      chips.push({ icon: '🔥', text: 'kvalitní zátěž' });
      score += 0.7;
    } else if (durMin >= 60 && z.pct.z1 >= 85) {
      improve.push('Skoro celé v Z1/Z2 — pokud to mělo být tempo, přidej intenzitu');
      chips.push({ icon: '⚠️', text: 'málo v prahu' });
      score -= 0.4;
    }
    if (z.pct.z5 >= 15) {
      improve.push('Hodně času na max — pozor, ať to není každý trénink');
      chips.push({ icon: '⚠️', text: 'moc na krev' });
    }
  } else {
    improve.push('Chybí tep — nahraj měření, ať to umím vyhodnotit pořádně');
    chips.push({ icon: '❤️', text: 'bez tepu' });
  }

  // --- rychlost / převýšení jako bonus barvy ---
  if (summary.elevationGainM >= 500) { good.push(`Nakopáno ${summary.elevationGainM} m — nohy to ví`); chips.push({ icon: '⛰️', text: 'kopce' }); }

  score = Math.max(1, Math.min(5, Math.round(score)));

  return {
    sport: summary.sport,
    rating: score,
    headline: headline(summary, z, score),
    good: good.slice(0, 3),
    improve: improve.slice(0, 3),
    chips: chips.slice(0, 4),
    zonesPct: z.pct,
    details: buildDetails(summary),
  };
}

// Podrobná analýza — konkrétní, ostré nálezy s tipem, co zlepšit.
function buildDetails(summary) {
  const a = summary.analysis;
  if (!a) return [];
  const isBike = summary.sport === 'bike';
  const out = [];
  const push = (verdict, icon, text, tip) => out.push({ verdict, icon, text, tip: tip || null });

  // Kadence do kopců (jen kolo — u běhu je jednotka nejistá)
  if (isBike && a.cadenceClimb != null) {
    const g = a.grindClimbPct;
    if (a.cadenceClimb >= 78) push('good', '⛰️', `Kadence do kopců ${a.cadenceClimb} ot/min — pěkně točíš.`);
    else if (a.cadenceClimb >= 68) push('info', '⛰️', `Kadence do kopců ${a.cadenceClimb} ot/min — mohla by být svižnější.`, 'Cíl je 80+ i ve stoupání: zlehči převod a raději toč.');
    else push('warn', '⛰️', `Do kopců mleš těžký převod — ${a.cadenceClimb} ot/min${g ? ` (${g} % stoupání pod 70)` : ''}.`, 'Zlehči a drž 80+ ot/min — ušetříš nohy a v kopci líp zrychlíš.');
  } else if (isBike && a.avgCadence != null && a.avgCadence < 80) {
    push('info', '🔄', `Průměrná kadence ${a.avgCadence} ot/min — spíš pomalé šlapání.`, 'Zkus svižnější nohy (85–95 na rovině) — šetří to svaly.');
  } else if (isBike && a.avgCadence != null) {
    push('good', '🔄', `Průměrná kadence ${a.avgCadence} ot/min — svižné nohy.`);
  } else if (summary.sport === 'run' && a.runCadence != null) {
    const rc = a.runCadence;
    if (rc >= 176) push('good', '🦵', `Kadence běhu ${rc} kroků/min — svižný, lehký krok.`);
    else if (rc >= 165) push('info', '🦵', `Kadence běhu ${rc} kroků/min — mohla by být svižnější.`, 'Přidej frekvenci ke ~180: kratší a rychlejší krok, míň to bere klouby.');
    else push('warn', '🦵', `Kadence běhu ${rc} kroků/min — dlouhý, pomalý krok (brzdíš se, víc to pálí klouby).`, 'Zkrať krok a zrychli nohy ke 175–180 kroků/min — poskoč víc dopředu, ne nahoru.');
  }

  // Běžecká dynamika (jen běh, když je z Garminu)
  if (summary.sport === 'run') {
    if (a.vertOscCm != null) {
      if (a.vertOscCm <= 8) push('good', '↕️', `Vertikální oscilace ${a.vertOscCm} cm — běžíš nízko a úsporně.`);
      else if (a.vertOscCm <= 10) push('info', '↕️', `Vertikální oscilace ${a.vertOscCm} cm — trochu skáčeš nahoru.`, 'Miř dopředu, ne nahoru: rychlejší kadence a měkký, rychlý došlap to sníží.');
      else push('warn', '↕️', `Vertikální oscilace ${a.vertOscCm} cm — hodně skáčeš nahoru, plýtváš energií.`, 'Zrychli kadenci ke 180, zkrať krok a běž „pod nízkým stropem" — energie dopředu, ne vzhůru.');
    }
    if (a.vertRatio != null) {
      if (a.vertRatio <= 7) push('good', '📐', `Vertikální poměr ${a.vertRatio} % — efektivní styl.`);
      else if (a.vertRatio <= 9.5) push('info', '📐', `Vertikální poměr ${a.vertRatio} % — je co ladit.`, 'Cíl pod 8 %: víc kadence a odraz dopředu z boků, ne nahoru.');
      else push('warn', '📐', `Vertikální poměr ${a.vertRatio} % — málo efektivní (moc nahoru na délku kroku).`, 'Posiluj lýtka a boky + drilly (skipping, „rychlé nohy") a přidej kadenci.');
    }
    if (a.stepLenCm != null) {
      push('info', '👣', `Délka kroku ${a.stepLenCm} cm.`, 'Delší krok ať roste z odrazu a natažení boku dozadu (síla hýždí), ne z natahování nohy dopředu — to brzdí.');
    }
    if (a.groundMs != null && a.groundMs > 290) {
      push('warn', '⏱️', `Dlouhý kontakt se zemí ${a.groundMs} ms — odraz je pomalý.`, 'Odrážej se svižně, „horká plotna" pod nohama — pomůžou drilly a plyometrie (poskoky).');
    }
  }

  // Tepová odezva / drift
  if (a.hrDriftPct != null && a.avgHr1 != null) {
    if (a.hrDriftPct > 8) push('warn', '❤️', `Tep během tréninku vylétl o ${a.hrDriftPct} % (${a.avgHr1}→${a.avgHr2}).`, 'Rozjížděj se pomaleji a pij průběžně — vydržíš rovnoměrnější tep.');
    else if (a.hrDriftPct >= -3 && a.hrDriftPct <= 4) push('good', '❤️', `Tep držel stabilně (drift ${a.hrDriftPct} %) — dobře rozjeté tempo.`);
  }

  // Rozložení sil
  if (a.fadePct != null) {
    if (a.fadePct < -8) push('warn', '📉', `Druhá půlka o ${Math.abs(Math.round(a.fadePct))} % pomalejší — došly síly.`, 'Rozlož tempo od začátku a dojez líp (jídlo a pití během).');
    else if (a.fadePct > 6) push('good', '📈', `Negativní split — ve druhé půlce jsi přidal. Silná hlava. 💪`);
  }

  // Výkon (když je měřák)
  if (a.avgPower != null) {
    push('info', '⚡', `Průměrný výkon ${a.avgPower} W${a.climbPower ? `, do kopců ${a.climbPower} W` : ''}.`);
  }

  // Stoupání
  if (a.climbGain != null && a.climbSec != null) {
    push('info', '🏔️', `V kopcích nastoupáno ${a.climbGain} m (${fmtDuration(a.climbSec)}).`);
  }

  return out.slice(0, 8);
}

// Textový komentář trenéra — tvrdší, ale povzbuzující.
function headline(summary, z, score) {
  const durMin = summary.durationSec ? Math.round(summary.durationSec / 60) : 0;

  if (!summary.avgHr) {
    return 'Odjeto. Ale bez tepu ti to nezhodnotím pořádně — příště zapni měřák, ať vidíme, jak jsi na tom fakt makal.';
  }
  if (score >= 4) {
    return `Tohle mělo šťávu! ${z.hardMin} min v kvalitě a základ sedí. Přesně takhle se roste. Drž to a nezapomeň na regeneraci. 🔥`;
  }
  if (z.pct.z1 >= 85 && durMin >= 60) {
    return `Narovinu: skoro celé v Z1. Na objem fajn, ale na tvůj cíl potřebuješ víc času v prahu. Příště podle plánu přidej intenzitu — bez vymlouvání. 🎯`;
  }
  if (durMin > 0 && durMin < 30) {
    return 'Krátké to bylo. Rozjezd beru, ale tréninky, co tě posunou, začínají dál. Zítra zaber.';
  }
  return 'Slušná práce. Základ máš, teď to chce pravidelně přidávat kvalitu. Poctivě dodělej i rutinu a core. 💪';
}
