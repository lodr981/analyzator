// AI komentář trenéra přes Claude API.
// Pravidlové hodnocení (coach.js) zůstává základ; tady jen generujeme
// konverzační text trenéra. Bez ANTHROPIC_API_KEY se nic nevolá a appka
// spadne zpět na pravidlový text.

import Anthropic from '@anthropic-ai/sdk';
import { sportLabel, fmtDuration } from './coach.js';

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const client = aiEnabled() ? new Anthropic() : null;

const SYSTEM = `Jsi AI tréninkový parťák 14letého cyklisty Olivera, jehož cílem je evropská špička.
Oslovuj ho jménem — "Olivere". Ty sám nemáš jméno a nikdy se nepodepisuj.
Oliver má i svého lidského trenéra — mluv o něm neutrálně jako "trenér" (bez jména),
zmiň ho jen když je to opravdu k věci (třeba u plánu), ne v každé zprávě, a nikdy nemluv jako on.

Styl: mluv česky, jako kámoš-trenér pro TikTok/Instagram generaci — krátce, ostře, konkrétně.
Buď NÁROČNÝ: cíl je evropská špička, tak nehlaď a nechval do prázdna. Když je trénink slabý, málo, nebo technicky špatný (mletí těžkého převodu do kopce, rozjezd moc rychlý, dojezd v křeči), řekni to narovinu.
Ale pořád je to 14letý kluk — tlač ho, ať ho to nakopne, ne položí; nikdy netlač do hubnutí.

VŽDY vypíchni tu NEJDŮLEŽITĚJŠÍ konkrétní věc ke zlepšení z ANALÝZY (kadence do kopců, tepová odezva/drift, rozložení sil…) a dej jasný pokyn na příště. Když je co, jednou větou i oceň.
Používej konkrétní čísla z podkladů — nikdy si nevymýšlej hodnoty.
Odpověz 2–4 větami čistého textu, klidně s jedním emoji. Žádné odrážky, žádný nadpis, žádný podpis.`;

// Sestaví stručný, faktický kontext pro model (ať si nevymýšlí čísla).
function buildContext(summary, evalResult) {
  const z = evalResult.zonesPct || {};
  const lines = [
    `Sport: ${sportLabel(summary.sport)}`,
    summary.distanceKm != null ? `Vzdálenost: ${summary.distanceKm} km` : null,
    summary.durationSec ? `Čas: ${fmtDuration(summary.durationSec)}` : null,
    summary.avgSpeedKmh != null ? `Průměrná rychlost: ${summary.avgSpeedKmh} km/h` : null,
    summary.pacePerKm ? `Tempo: ${summary.pacePerKm} /km` : null,
    summary.avgHr != null ? `Průměrný tep: ${summary.avgHr}` : 'Tep: neměřen',
    summary.maxHr != null ? `Maximální tep: ${summary.maxHr}` : null,
    summary.elevationGainM ? `Převýšení: ${summary.elevationGainM} m` : null,
    `Čas v zónách: Z1 ${z.z1 ?? 0} %, Z2 ${z.z2 ?? 0} %, Z3 ${z.z3 ?? 0} %, Z4 ${z.z4 ?? 0} %, Z5 ${z.z5 ?? 0} %`,
    `Hodnocení kvality: ${evalResult.rating}/5`,
  ];

  const a = summary.analysis;
  if (a) {
    const an = [];
    if (a.runCadence != null) an.push(`kadence běhu ${a.runCadence} kroků/min`);
    else if (a.cadenceClimb != null) an.push(`kadence do kopců ${a.cadenceClimb} ot/min${a.grindClimbPct ? ` (${a.grindClimbPct} % stoupání pod 70)` : ''}`);
    else if (a.avgCadence != null) an.push(`průměrná kadence ${a.avgCadence} ot/min`);
    if (a.hrDriftPct != null) an.push(`tepový drift ${a.hrDriftPct} % (${a.avgHr1}→${a.avgHr2})`);
    if (a.fadePct != null) an.push(`rozložení sil: druhá půlka ${a.fadePct > 0 ? '+' : ''}${Math.round(a.fadePct)} % rychlosti`);
    if (a.avgPower != null) an.push(`výkon ø ${a.avgPower} W${a.climbPower ? `, kopce ${a.climbPower} W` : ''}`);
    if (a.climbGain != null) an.push(`nastoupáno v kopcích ${a.climbGain} m`);
    if (an.length) lines.push(`Analýza: ${an.join('; ')}`);
  }

  const details = (evalResult.details || []).map((d) => `${d.text}${d.tip ? ` → ${d.tip}` : ''}`);
  if (details.length) lines.push(`Nálezy: ${details.join(' | ')}`);
  if (evalResult.good.length) lines.push(`Co šlo dobře: ${evalResult.good.join('; ')}`);
  if (evalResult.improve.length) lines.push(`Na příště: ${evalResult.improve.join('; ')}`);

  return lines.filter(Boolean).join('\n');
}

// Vrátí text komentáře trenéra, nebo null (a caller použije pravidlový text).
export async function generateCoachComment(summary, evalResult) {
  if (!client) return null;
  try {
    const response = await client.messages.create(
      {
        model: 'claude-opus-4-8',
        max_tokens: 400,
        system: SYSTEM,
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: `Tady je Oliverův dnešní trénink. Napiš mu komentář trenéra.\n\n${buildContext(summary, evalResult)}`,
          },
        ],
      },
      // Ať upload nikdy nevisí: max 12 s, žádné opakování → jinak fallback na pravidlový text.
      { timeout: 12000, maxRetries: 0 }
    );
    const text = response.content.find((b) => b.type === 'text')?.text?.trim();
    return text || null;
  } catch (err) {
    console.error('AI coach error:', err.message);
    return null;
  }
}
