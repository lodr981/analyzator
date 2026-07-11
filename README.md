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
2. **Plán z chatu** — trenér napíše týden, AI ho rozloží
3. **Historie & databáze** — ukládání aktivit, týdenní/měsíční přehledy, forma a periodizace
4. **Denní rutina** — cviky a protažení s počty, auto-odškrtání z dat
5. **Připomínky** — PWA push + e-mail (nenahráno / nesplněno / streak)

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

## Struktura

```
server.js          Express server + /api/upload
src/parse.js       parser FIT/TCX/GPX → jednotný souhrn + zóny tepu
src/coach.js       pravidlové hodnocení (rating, zóny, chipy) + fallback text
src/aiCoach.js     AI komentář trenéra přes Claude API (claude-opus-4-8)
public/            frontend (upload + analýza, PWA)
```
