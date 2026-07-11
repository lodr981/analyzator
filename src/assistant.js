// Parťák-chat: obecný AI asistent s kontextem nad vším (aktivity, plán, forma,
// váha, výživa). Umí porovnávat/analyzovat tréninky a přes nástroje zapisovat
// z běžné řeči — váhu, výživu, a doplnit "byl to závod". Ekonomicky: dostává
// jen kompaktní přehled, ne celá data.

import Anthropic from '@anthropic-ai/sdk';
import { addMeasurement, addNutrition, updateActivity } from './db.js';

export function assistantEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const client = assistantEnabled() ? new Anthropic() : null;

const SYSTEM = `Jsi AI parťák 14letého cyklisty Olivera (cíl: evropská špička).
Oslovuj ho jménem, mluv česky, krátce a energicky jako kámoš pro TikTok/IG generaci — ale neboj se přitvrdit.
Máš k dispozici KONTEXT (poslední aktivity s jejich id, plán týdne, formu, váhu, výživu).
Odpovídej na dotazy a hlavně na POROVNÁNÍ a ANALÝZU (dnešní vs včerejší trénink, tento vs minulý týden apod.) z toho kontextu.
Když něco v kontextu chybí, řekni to a případně se doptej — nevymýšlej si čísla.

Máš nástroje. Používej je, když Oliver píše běžnou řečí (žádné formuláře):
- log_weight: když napíše kolik váží ("dnes 52 kilo").
- log_nutrition: když popíše co jedl/pil ("k obědu těstoviny s kuřecím").
- tag_activity: když upřesní k aktivitě, že to byl závod (ne trénink), nebo přidá poznámku. activity_id vezmi z kontextu.
Po zápisu to krátce potvrď.

Oliver má i lidského trenéra (mluv o něm neutrálně jako "trenér", bez jména) — finální slovo má vždy on.
Odpovídej stručně, 1–4 věty, klidně 1 emoji. Bez nadpisů a odrážek.`;

const TOOLS = [
  {
    name: 'log_weight',
    description: 'Zapiš Oliverovu tělesnou váhu v kilogramech. Použij, když napíše, kolik váží.',
    input_schema: {
      type: 'object',
      properties: {
        weight_kg: { type: 'number', description: 'Váha v kg.' },
        date: { type: 'string', description: 'ISO datum (YYYY-MM-DD); vynech pro dnešek.' },
      },
      required: ['weight_kg'],
    },
  },
  {
    name: 'log_nutrition',
    description: 'Zapiš poznámku o jídle/pití (výživa). Použij, když Oliver popíše, co jedl nebo pil.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Co snědl/vypil, vlastními slovy.' },
        date: { type: 'string', description: 'ISO datum; vynech pro dnešek.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'tag_activity',
    description: 'Uprav uloženou aktivitu — označ, že to byl závod (místo tréninku), nebo přidej poznámku. activity_id vezmi z kontextu (u aktivit je v hranatých závorkách).',
    input_schema: {
      type: 'object',
      properties: {
        activity_id: { type: 'string', description: 'ID aktivity z kontextu.' },
        kind: { type: 'string', enum: ['závod', 'trénink'], description: 'Typ aktivity.' },
        note: { type: 'string', description: 'Volitelná poznámka.' },
      },
      required: ['activity_id'],
    },
  },
];

async function runTool(name, input) {
  try {
    if (name === 'log_weight') {
      const rec = await addMeasurement({ weight_kg: input.weight_kg, date: input.date });
      return `Zapsáno: ${rec.weight_kg} kg.`;
    }
    if (name === 'log_nutrition') {
      await addNutrition({ text: input.text, date: input.date });
      return 'Zapsáno do výživy.';
    }
    if (name === 'tag_activity') {
      const patch = {};
      if (input.kind) patch.userKind = input.kind;
      if (input.note) patch.note = input.note;
      const updated = await updateActivity(input.activity_id, patch);
      return updated ? 'Aktivita upravena.' : 'Tuhle aktivitu jsem v kontextu nenašel.';
    }
    return 'Neznámý nástroj.';
  } catch (err) {
    return 'Nástroj selhal: ' + err.message;
  }
}

// message = text od Olivera; history = předchozí zprávy [{role:'user'|'ai', text}]; digest = kompaktní kontext (string)
export async function generateReply({ message, history = [], digest = '' }) {
  if (!client) {
    return { text: 'Pro chat s parťákem je potřeba zapnout AI — nastav ANTHROPIC_API_KEY.' };
  }

  const messages = [];
  for (const m of history.slice(-10)) {
    messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
  }
  messages.push({ role: 'user', content: message });

  const system = `${SYSTEM}\n\n=== KONTEXT (dnešek a poslední data) ===\n${digest}`;

  try {
    for (let i = 0; i < 5; i++) {
      const resp = await client.messages.create(
        {
          model: 'claude-opus-4-8',
          max_tokens: 800,
          system,
          tools: TOOLS,
          output_config: { effort: 'medium' },
          messages,
        },
        { timeout: 40000, maxRetries: 0 }
      );

      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const results = [];
        for (const block of resp.content) {
          if (block.type === 'tool_use') {
            const out = await runTool(block.name, block.input);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          }
        }
        messages.push({ role: 'user', content: results });
        continue; // ať model zformuluje finální odpověď
      }

      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { text: text || 'Hotovo.' };
    }
    return { text: 'Nestihl jsem to dotáhnout, zkus to prosím znovu.' };
  } catch (err) {
    console.error('assistant error:', err.message);
    return { text: 'Něco se pokazilo, zkus to prosím znovu.' };
  }
}
