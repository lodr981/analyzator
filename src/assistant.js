// Parťák-chat: obecný AI asistent s kontextem nad vším (aktivity, plán, forma,
// váha, výživa). Umí porovnávat/analyzovat tréninky a přes nástroje zapisovat
// z běžné řeči — váhu, výživu, a doplnit "byl to závod". Ekonomicky: dostává
// jen kompaktní přehled, ne celá data.

import Anthropic from '@anthropic-ai/sdk';
import { addMeasurement, addNutrition, updateActivity, markRoutineDone, addWellness, addGoal, deleteGoals, setHealth } from './db.js';
import { ROUTINE_IDS } from './routine.js';

export function assistantEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const client = assistantEnabled() ? new Anthropic() : null;

const SYSTEM = `Jsi AI parťák 14letého cyklisty Olivera (cíl: evropská špička).
Oslovuj ho jménem, mluv česky, krátce a energicky jako kámoš pro TikTok/IG generaci — ale neboj se přitvrdit.
Máš k dispozici KONTEXT (poslední aktivity s jejich id, plán týdne, formu, váhu, výživu).
Odpovídej na dotazy a hlavně na POROVNÁNÍ a ANALÝZU (dnešní vs včerejší trénink, tento vs minulý týden apod.) z toho kontextu.
Když něco v kontextu chybí, řekni to a případně se doptej — nevymýšlej si čísla.

Umíš taky VYSVĚTLIT cviky z denní rutiny — jak je správně dělat a proč (máš je v kontextu i s návodem a zdůvodněním). Když se Oliver zeptá "jak dělat plank" nebo "proč mrtvý brouk", srozumitelně mu to popiš.

DŮLEŽITÉ — máš nástroje a MUSÍŠ je použít HNED, jakmile Oliver uvede odpovídající údaj. Nikdy se neptej „kolik“, když to už napsal; nezapisuj do textu, ale zavolej nástroj:
- log_weight: kolik VÁŽÍ (kilogramy). Spouštěče: "vážím", "mám", "dneska 52 kilo", "52 kg".
- log_height: kolik MĚŘÍ (centimetry). Spouštěče: "měřím", "vyrostl jsem", "mám 165", "165 cm". Když je jasné, že jde o výšku (měřím/vyrostl), použij tohle i bez jednotky.
- log_nutrition: co jedl/pil. Spouštěče: "k obědu/snídani/svačině…", "dal jsem si", "snědl jsem".
- tag_activity: upřesnění aktivity (že to byl závod) nebo poznámka. activity_id z kontextu.
- check_routine: "odcvičil jsem", "hotová rutina". Bez upřesnění odškrtni celou rutinu; jen část → jen ta id.
- log_sleep: kolik a jak SPAL. Spouštěče: "spal jsem 8 hodin", "vyspal jsem se blbě", "spánek 6 h". quality vezmi z popisu (super/dobrý/špatný), když ho zmíní.
- log_readiness: RANNÍ POCIT, klidový tep a/nebo SVALOVKA. Spouštěče: "cítím se na 4 z 5", "jsem rozlámaný", "ráno mám tep 52", "klidovka 55", "mám svalovku", "bolí mě nohy z tréninku". feel i soreness převeď na škálu 1–5 (feel 1 = úplně mrtvý, 5 = svěží; soreness 1 = žádná svalovka, 5 = hrozná).
- log_health: NEMOC nebo BOLÍSTKA/zranění. Spouštěče: "je mi blbě", "mám rýmu/teplotu" (status "nemoc"), "bolí koleno/záda" (status "zranění"). Když napíše, že je zase fit ("jsem v pohodě", "zdravý"), zavolej s status "ok".
- set_goal: CÍL / ZÁVOD s datem. Spouštěče: "22. 8. mám cyklokros v Táboře", "za 3 týdny závod". date jako ISO (YYYY-MM-DD). sport podle disciplíny, když ji zmíní.

Rozlišuj jednotky: kg = váha (log_weight), cm = výška (log_height), h = spánek (log_sleep), tep/bpm ráno = klidový tep (log_readiness). Po zápisu to krátce lidsky potvrď (např. "Zapsáno, 165 cm 📏").
Když Oliver hlásí spánek/pocit/tep/svalovku/jídlo/nemoc/závod, VŽDY to zapiš nástrojem — počítá se to do jeho „připravenosti dne" a do doporučení.

REGENERACE A STRAVA JSOU PRIORITA. Trénink roste z odpočinku a jídla, ne jen z dřiny.
- Aktivně a nenásilně se zajímej o spánek, svalovku, pocit a hlavně JÍDLO. V kontextu vidíš řádek "Strava dnes: bílkoviny …, sacharidy …". Když je tam "dnes zatím nic nezapsáno", na konci se kámošsky zeptej: "Co jsi dneska jedl?". Když je bílkovin nebo sacharidů "nízká", upozorni na to a konkrétně poraď, co doplnit.
- Raď ke stravě konkrétně: bílkoviny po tréninku (maso, ryba, vejce, tvaroh, jogurt) na stavbu svalů, sacharidy před a po kvalitě (rýže, těstoviny, ovesná kaše, banán) na energii, a pití. Pro rostoucího 14letého kluka je dost bílkovin a jídla klíč.
- Ke spánku (9 h je pro tebe zlato) a k regeneraci (protažení, lehký den, když je svalovka nebo zvýšený klidový tep).
- Když je připravenost nízká nebo velká svalovka/nemoc, jasně řekni, ať to nehrotí — regenerace teď udělá víc než trénink.

Vyznáš se v cyklistice napříč disciplínami — silnice, XCO (MTB kros), cyklokros i enduro/gravity — a znáš současnou špičku. Umíš Olivera motivovat srovnáním s profíky ("i ti nejlepší makají na core").
Když se ptá na AKTUÁLNÍ dění (kdo vyhrál, výsledky, závody, přestupy, novinky), POUŽIJ nástroj web_search a odpověz z čerstvých zdrojů — nikdy si výsledky nevymýšlej. Když si nejsi jistý aktuálností, radši si to vyhledej.
A občas, když to sedne (třeba po dobrém tréninku nebo když je Oliver unavený), hoď krátký motivační střípek z aktuálního cyklo dění — kterákoliv disciplína — ať ho to nakopne.

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
    name: 'log_height',
    description: 'Zapiš Oliverovu tělesnou výšku v centimetrech. Použij, když napíše, kolik měří.',
    input_schema: {
      type: 'object',
      properties: {
        height_cm: { type: 'number', description: 'Výška v cm.' },
        date: { type: 'string', description: 'ISO datum; vynech pro dnešek.' },
      },
      required: ['height_cm'],
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
  {
    name: 'check_routine',
    description: 'Odškrtni dnešní denní rutinu jako splněnou, když Oliver napíše, že cvičil. Bez exercise_ids odškrtne celou rutinu; s exercise_ids jen vyjmenované cviky (id z kontextu rutiny).',
    input_schema: {
      type: 'object',
      properties: {
        exercise_ids: { type: 'array', items: { type: 'string' }, description: 'Id cviků z kontextu; vynech pro celou rutinu.' },
      },
    },
  },
  {
    name: 'log_sleep',
    description: 'Zapiš, kolik Oliver spal (hodiny) a případně kvalitu. Použij, když zmíní spánek.',
    input_schema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'Délka spánku v hodinách.' },
        quality: { type: 'string', description: 'Volitelně kvalita: super / dobrý / špatný.' },
        date: { type: 'string', description: 'ISO datum; vynech pro dnešek.' },
      },
      required: ['hours'],
    },
  },
  {
    name: 'log_readiness',
    description: 'Zapiš signály regenerace: ranní pocit (1–5), klidový tep (bpm) a/nebo svalovku (1–5). Použij, když Oliver řekne, jak se cítí, jaký má ranní tep nebo jestli má svalovku.',
    input_schema: {
      type: 'object',
      properties: {
        feel: { type: 'integer', description: 'Pocit 1 (mrtvý) až 5 (svěží).' },
        resting_hr: { type: 'integer', description: 'Ranní klidový tep v bpm.' },
        soreness: { type: 'integer', description: 'Svalovka 1 (žádná) až 5 (hrozná, sotva chodí).' },
        date: { type: 'string', description: 'ISO datum; vynech pro dnešek.' },
      },
    },
  },
  {
    name: 'log_health',
    description: 'Nastav zdravotní stav: nemoc, zranění/bolístka, nebo návrat do formy (ok). Použij, když Oliver hlásí, že je nemocný, něco ho bolí, nebo že je zase fit.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['nemoc', 'zranění', 'ok'], description: 'Typ stavu.' },
        note: { type: 'string', description: 'Krátký popis (co bolí, jak dlouho apod.).' },
      },
      required: ['status'],
    },
  },
  {
    name: 'set_goal',
    description: 'Ulož cíl / závod s datem, aby appka ukázala odpočet a počítala s ním v plánu.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Název závodu/cíle (např. "Cyklokros Tábor").' },
        date: { type: 'string', description: 'ISO datum závodu (YYYY-MM-DD).' },
        sport: { type: 'string', description: 'Disciplína, když ji zmíní (silnice/XCO/cyklokros/enduro…).' },
      },
      required: ['title', 'date'],
    },
  },
  // Server tool: aktuální cyklo dění (výsledky, závody, novinky) — běží na straně Anthropicu.
  { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
];

async function runTool(name, input) {
  try {
    if (name === 'log_weight') {
      const rec = await addMeasurement({ weight_kg: input.weight_kg, date: input.date });
      return `Zapsáno: ${rec.weight_kg} kg.`;
    }
    if (name === 'log_height') {
      const rec = await addMeasurement({ height_cm: input.height_cm, date: input.date });
      return `Zapsáno: ${rec.height_cm} cm.`;
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
    if (name === 'check_routine') {
      const ids = input.exercise_ids?.length ? input.exercise_ids : ROUTINE_IDS;
      const done = await markRoutineDone(ids);
      return `Odškrtnuto ${ids.length} cviků (dnes hotovo ${done.length}/${ROUTINE_IDS.length}).`;
    }
    if (name === 'log_sleep') {
      const note = input.quality ? `spánek: ${input.quality}` : null;
      const rec = await addWellness({ sleep_hours: input.hours, note, date: input.date });
      return `Zapsáno: spánek ${rec.sleep_hours} h.`;
    }
    if (name === 'log_readiness') {
      if (input.feel == null && input.resting_hr == null && input.soreness == null) return 'Chybí pocit, tep i svalovka — nezapisuji.';
      const rec = await addWellness({ feel: input.feel, resting_hr: input.resting_hr, soreness: input.soreness, date: input.date });
      const parts = [];
      if (rec.feel != null) parts.push(`pocit ${rec.feel}/5`);
      if (rec.resting_hr != null) parts.push(`klidový tep ${rec.resting_hr}`);
      if (rec.soreness != null) parts.push(`svalovka ${rec.soreness}/5`);
      return `Zapsáno: ${parts.join(', ')}.`;
    }
    if (name === 'log_health') {
      await setHealth({ status: input.status, note: input.note || null, date: new Date().toISOString() });
      return input.status === 'ok' ? 'Zdravotní stav: zpátky ve formě.' : `Zapsáno: ${input.status}${input.note ? ' (' + input.note + ')' : ''}.`;
    }
    if (name === 'set_goal') {
      const rec = await addGoal({ title: input.title, date: input.date, sport: input.sport });
      return rec.date ? `Cíl uložen: ${rec.title} (${rec.date.slice(0, 10)}).` : 'Cíl uložen, ale nerozpoznal jsem datum.';
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
    for (let i = 0; i < 6; i++) {
      const resp = await client.messages.create(
        {
          model: 'claude-opus-4-8',
          max_tokens: 1200,
          system,
          tools: TOOLS,
          output_config: { effort: 'medium' },
          messages,
        },
        { timeout: 55000, maxRetries: 0 }
      );

      // Vlastní (client-side) nástroje — vyřídíme a vrátíme výsledky.
      const customUses = resp.content.filter((b) => b.type === 'tool_use');
      if (customUses.length) {
        messages.push({ role: 'assistant', content: resp.content });
        const results = [];
        for (const b of customUses) {
          results.push({ type: 'tool_result', tool_use_id: b.id, content: await runTool(b.name, b.input) });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      // Server tool (web_search) narazil na limit smyčky — pokračuj (bez user zprávy).
      if (resp.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: resp.content });
        continue;
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
