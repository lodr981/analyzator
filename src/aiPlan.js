// Plán z chatu: z volného textu trenéra (nebo změny od Olivera) poskládá
// strukturovaný týden Po–Ne. Používá Claude API se structured outputs.

import Anthropic from '@anthropic-ai/sdk';

export function planAiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const client = planAiEnabled() ? new Anthropic() : null;

const SYSTEM = `Jsi AI parťák, který 14letému cyklistovi Oliverovi (cíl: evropská špička) rozloží tréninkový týden.
Trenér napíše, co má týden obsahovat (i závody). Oliver ti to vloží — někdy taky napíše změnu (nemoc, škola, počasí).

Tvůj úkol: udělej konkrétní rozpis na všech 7 dní (Po až Ne).
- Kvalitní/intervalové tréninky rozepiš konkrétně, s počty a intenzitou (např. "5×5 min práh / 90 s klus", "90 min Z2").
- Rozlož zátěž rozumně: tvrdé dny prokládej lehčími, zařaď regeneraci i volno.
- Rozpoznej závod a dej ho do správného dne; před závodem vylaď (kvalita zůstává, objem dolů).
- Když Oliver napíše změnu (třeba nemoc), přeskládej ZBYTEK týdne podle toho.
- Zmiň i krátkou denní rutinu/core tam, kde dává smysl.

Finální slovo má vždy lidský trenér — ty jen rozvrhneš a poradíš, nikdy nepřepisuješ jeho záměr.
V poli "reply" napiš Oliverovi krátkou zprávu (2–3 věty, kámoš pro TikTok generaci, klidně 1 emoji),
řekni jak jsi to rozložil a zeptej se, jestli mu to sedí. Mluv o trenérovi neutrálně (bez jména), oslovuj Olivera jménem.`;

const SCHEMA = {
  type: 'object',
  properties: {
    weekLabel: { type: 'string', description: 'Krátký popis týdne, např. "Objemový blok" nebo "Týden se závodem".' },
    reply: { type: 'string', description: 'Krátká zpráva Oliverovi.' },
    days: {
      type: 'array',
      description: 'Přesně 7 položek, pondělí až neděle.',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'] },
          kind: { type: 'string', enum: ['trénink', 'kvalita', 'regenerace', 'volno', 'závod'] },
          title: { type: 'string', description: 'Krátký název, např. "Intervaly na prahu".' },
          detail: { type: 'string', description: 'Konkrétně co a jak, s počty a intenzitou.' },
        },
        required: ['day', 'kind', 'title', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['weekLabel', 'reply', 'days'],
  additionalProperties: false,
};

// message = nový vstup od Olivera; currentPlan = předchozí rozpis (nebo null).
export async function generatePlan({ message, currentPlan }) {
  if (!client) {
    return { error: 'Pro rozložení plánu je potřeba zapnout AI — nastav ANTHROPIC_API_KEY.' };
  }
  try {
    const context = currentPlan
      ? `Aktuální rozpis týdne (uprav ho podle nové zprávy):\n${JSON.stringify(currentPlan)}\n\n`
      : '';
    const response = await client.messages.create(
      {
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        system: SYSTEM,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          { role: 'user', content: `${context}Zpráva od Olivera:\n${message}` },
        ],
      },
      { timeout: 30000, maxRetries: 0 }
    );
    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return { error: 'AI nevrátila plán, zkus to znovu.' };
    return JSON.parse(text);
  } catch (err) {
    console.error('AI plan error:', err.message);
    return { error: 'Plán se nepodařilo vytvořit, zkus to prosím znovu.' };
  }
}
