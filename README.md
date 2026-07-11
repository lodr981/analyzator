# TEMPO 🚴

Tréninkový parťák pro mladého cyklistu (Olivera). Nahraješ aktivitu z Garminu
a appka ji rozklíčuje a vyhodnotí — ve stylu jednoduchém a vizuálně poutavém.

**Cíl:** evropská špička. Tomu odpovídá i tón — appka nehladí, ale povzbuzuje.
Hlavní slovo má vždy lidský trenér; appka mu jen dělá parťáka s daty.

## Co už umí

- Nahrání aktivity z Garminu: **.FIT**, **.TCX**, **.GPX** (ručně, přetažením)
- Parsování do jednotného tvaru: vzdálenost, čas, tempo/rychlost, tep, převýšení
- Rozpad času do **tepových zón**
- Hodnocení kvality tréninku (★1–5) + komentář trenéra
- **AI trenér přes Claude API** (`claude-opus-4-8`) — konverzační komentář; bez klíče se použije pravidlový text
- Podpora více sportů: kolo, běh, plavání, túra, běžky
- **PWA** — instalovatelné na plochu iPhonu (Přidat na plochu)

## AI komentář (Claude API)

Text trenéra generuje Claude, když je nastavená proměnná prostředí:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Bez ní appka funguje dál — použije pravidlové hodnocení. Struktura (rating, zóny,
chipy) je vždy pravidlová a deterministická; AI píše jen konverzační komentář.
Na Railway přidej `ANTHROPIC_API_KEY` v nastavení proměnných prostředí.

## Roadmapa (další kroky)

1. ~~AI komentář přes Claude API~~ ✅ hotovo
2. ~~Historie aktivit~~ ✅ hotovo
3. ~~Databáze na serveru~~ ✅ hotovo (Postgres na Railway, fallback na soubor)
4. ~~Plán z chatu~~ ✅ hotovo (AI rozloží týden Po–Ne, řeší i změny/nemoc)
5. ~~Forma & periodizace~~ ✅ hotovo (zátěž, kondice/únava/forma)
6. ~~Parťák chat s kontextem~~ ✅ hotovo (porovnání tréninků, zápis váhy a
   výživy z běžné řeči, doplnění „byl to závod")
7. **Přehledy váhy a výživy** — grafy růstu (zápis už je, chybí zobrazení)
8. **Denní rutina** — cviky a protažení s počty, auto-odškrtání z dat
9. **Připomínky** — PWA push + e-mail (nenahráno / nesplněno / streak)
10. **Přihlášení / okno pro trenéra & rodiče** (zatím bez ověření)

## Spuštění lokálně

```bash
npm install
npm start
# → http://localhost:3000
```

## Nasazení na Railway

Railway (Nixpacks) automaticky detekuje Node projekt a spustí `npm start`.
Poslouchá na `process.env.PORT`, takže není potřeba nic dalšího nastavovat.

1. Propoj repozitář v Railway
2. Deploy proběhne sám ze `start` skriptu

### Databáze (Postgres) — sdílení mezi zařízeními

Historie se ukládá na server. Bez databáze appka běží taky (souborové úložiště,
které se ale na Railway při každém deployi smaže). Pro trvalé sdílení mezi
zařízeními přidej Postgres:

1. V projektu na Railway: **New → Database → Add PostgreSQL**
2. Railway sám nastaví proměnnou `DATABASE_URL` (appka ji rovnou použije)
3. Pokud by připojení hlásilo SSL chybu, přidej proměnnou `DATABASE_SSL=true`

Stav úložiště zkontroluješ na `/healthz` (`"db":"postgres"` nebo `"file"`).

## Struktura

```
server.js          Express server: /api/upload, /api/activities
src/parse.js       parser FIT/TCX/GPX → jednotný souhrn + zóny tepu
src/coach.js       pravidlové hodnocení (rating, zóny, chipy) + fallback text
src/aiCoach.js     AI komentář trenéra přes Claude API (claude-opus-4-8)
src/aiPlan.js      plán z chatu — AI rozloží týden (structured outputs)
src/form.js        forma & periodizace — zátěž, kondice/únava/forma
src/assistant.js   parťák chat — kontext nad vším + nástroje (váha, výživa, tag)
src/db.js          úložiště: aktivity, plán, chat, váha, výživa (Postgres/soubor)
public/            frontend (nahrání, parťák, plán, forma, historie, PWA)
```
