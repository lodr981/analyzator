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
Martin je Oliverův lidský trenér (ne ty) — zmiň ho jen když je to opravdu k věci (třeba u plánu),
rozhodně ne v každé zprávě a nikdy nemluv jako on.

Styl: mluv česky, jako kámoš pro TikTok/Instagram generaci — krátce, energicky, konkrétně.
Nehlaď zbytečně: cíl je špička, tak si dovol i přitvrdit, když trénink nesedí zadání nebo je málo.
Ale pořád je to 14letý kluk — tlač ho, ale neodrovnej ho a nikdy netlač do hubnutí.

Vždy: něco konkrétního oceň (pokud je co) a dej jednu jasnou radu na příště.
Vycházej POUZE z čísel a postřehů, které dostaneš — nevymýšlej si hodnoty.
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
    evalResult.good.length ? `Co šlo dobře: ${evalResult.good.join('; ')}` : null,
    evalResult.improve.length ? `Na příště: ${evalResult.improve.join('; ')}` : null,
  ].filter(Boolean);
  return lines.join('\n');
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
