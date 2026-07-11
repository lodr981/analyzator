# TEMPO 🚴

Tréninkový parťák pro mladého cyklistu (Olivera). Nahraješ aktivitu z Garminu
a appka ji rozklíčuje a vyhodnotí — ve stylu jednoduchém a vizuálně poutavém.

**Cíl:** evropská špička. Tomu odpovídá i tón — appka nehladí, ale povzbuzuje.
Hlavní slovo má vždy lidský trenér; appka mu jen dělá parťáka s daty.

## Co už umí (v0.1)

- Nahrání aktivity z Garminu: **.FIT**, **.TCX**, **.GPX** (ručně, přetažením)
- Parsování do jednotného tvaru: vzdálenost, čas, tempo/rychlost, tep, převýšení
- Rozpad času do **tepových zón**
- Hodnocení kvality tréninku (★1–5) + komentář trenéra (zatím pravidlový)
- Podpora více sportů: kolo, běh, plavání, túra, běžky

## Roadmapa (další kroky)

1. **AI komentář přes Claude API** místo pravidlového (struktura už připravená v `src/coach.js`)
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
src/coach.js       hodnocení a komentář trenéra (připraveno na výměnu za Claude API)
public/            frontend (upload + analýza)
```
