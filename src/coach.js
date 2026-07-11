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
  };
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
