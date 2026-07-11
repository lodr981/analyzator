// Denní rutina — jeden zdroj pravdy (server i klient). Každý cvik má počet,
// návod JAK ho dělat a ZDŮVODNĚNÍ proč (pro appku i pro parťák-chat).

export const ROUTINE = [
  {
    group: 'Protahování & mobilita',
    items: [
      {
        id: 'm1', name: 'Kyčle — výpady s rotací', reps: '2×10',
        how: 'Dlouhý výpad vpřed, zadní koleno těsně nad zem. Dole rotuj trupem nad přední nohu, ruce vzhůru. Vystřídej nohy.',
        why: 'Rozhýbe kyčle ztuhlé ze sedla — plynulejší šlapání a míň bolavých zad.',
      },
      {
        id: 'm2', name: 'Hrudní páteř — rotace vsedě', reps: '2×8',
        how: 'Sedni si na paty, ruku dej za hlavu. Loktem opiš velký oblouk a rotuj hrudníkem do strany. Pomalu, s dechem.',
        why: 'Uvolní hrudní páteř → líp se dýchá v předklonu a udržíš nižší aero pozici.',
      },
      {
        id: 'm3', name: 'Lýtka & achilovky', reps: '3×20 s',
        how: 'Špičkou o schod nebo stěnu, patu tlač dolů. Střídej nataženou a mírně pokrčenou nohu. Drž tah, nehoupej.',
        why: 'Pružná lýtka a achilovky = víc síly z každého šlápnutí a míň zranění.',
      },
      {
        id: 'm4', name: 'Hamstringy vleže', reps: '2×30 s / noha',
        how: 'Lehni na záda, nohu zvedni nataženou, chytni za stehno a pomalu přitahuj k sobě. Druhá noha leží na zemi.',
        why: 'Uvolněné zadní stehno chrání záda a zlepšuje záběr dolů i nahoru.',
      },
    ],
  },
  {
    group: 'Síla & core',
    items: [
      {
        id: 's1', name: 'Plank', reps: '3×45 s',
        how: 'Předloktí pod rameny, tělo v přímce od hlavy po paty. Zpevni břicho i hýždě, nepovoluj bedra ani nezvedej zadek.',
        why: 'Pevný střed těla přenáší sílu z nohou do pedálů — víc wattů bez plýtvání.',
      },
      {
        id: 's2', name: 'Boční plank', reps: '2×30 s / strana',
        how: 'Na boku, opora o jedno předloktí, tělo v přímce, boky zvedni nahoru. Nespadni dopředu ani dozadu.',
        why: 'Zpevní boční břicho → stabilní pánev a rovný záběr, hlavně do kopce.',
      },
      {
        id: 's3', name: 'Mrtvý brouk (core)', reps: '3×12',
        how: 'Lehni na záda, ruce a nohy nahoru (kolena 90°). Střídavě natahuj protilehlou ruku a nohu, bedra pořád na zemi.',
        why: 'Naučí core držet záda při pohybu končetin — ochrana zad ve sprintu.',
      },
      {
        id: 's4', name: 'Dřepy na jedné noze', reps: '3×8 / noha',
        how: 'Stoj na jedné noze, druhou nataž vpřed. Pomalu klesej na patě a zase vstaň. Přidrž se, když je potřeba.',
        why: 'Vyrovná sílu levé a pravé nohy a posílí koleno — čistší, silnější šlapání.',
      },
      {
        id: 's5', name: 'Glute bridge (mostík)', reps: '3×15',
        how: 'Lehni na záda, kolena pokrčená, chodidla u zadku. Zvedni pánev stlačením hýždí do přímky, nahoře zpevni, pomalu dolů.',
        why: 'Silné hýždě jsou hlavní motor na kole a chrání i záda a kolena.',
      },
    ],
  },
];

export const ROUTINE_IDS = ROUTINE.flatMap((g) => g.items.map((i) => i.id));

// Kompaktní přehled pro AI kontext (co je v rutině + krátké proč).
export function routineDigest(doneIds = []) {
  const done = new Set(doneIds);
  const lines = ['Denní rutina (cviky, ✓ = dnes hotovo):'];
  for (const g of ROUTINE) {
    lines.push(`  ${g.group}:`);
    for (const it of g.items) {
      lines.push(`    ${done.has(it.id) ? '✓' : '·'} [${it.id}] ${it.name} ${it.reps} — ${it.why}`);
    }
  }
  return lines.join('\n');
}
