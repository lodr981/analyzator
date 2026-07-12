// Tréninkový deník jako PDF (pdfkit). Sesbírá vše za zvolené období — souhrn,
// aktivity, formu, tělo, stravu, odznaky, cíle — a vyrenderuje čistý dokument.
// Font DejaVu Sans kvůli české diakritice.

import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeForm } from './form.js';
import { scoreNutrition } from './nutrition.js';
import { computeAchievements } from './achievements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(__dirname, '../assets/fonts/DejaVuSans.ttf');
const FONT_B = path.join(__dirname, '../assets/fonts/DejaVuSans-Bold.ttf');

export const DIARY_PERIODS = {
  month: { days: 31, label: 'poslední měsíc' },
  quarter: { days: 92, label: 'poslední 3 měsíce' },
  half: { days: 183, label: 'poslední půlrok' },
  year: { days: 366, label: 'poslední rok' },
  all: { days: 100000, label: 'celá historie' },
};

const PINK = '#FF4D8D', CYAN = '#0E9BB8', INK = '#1a1730', MUT = '#6b6790', LINE = '#e6e3f0';

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: '2-digit' });
}
function fmtDur(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}
const sportName = (a) => a.labels?.sport || a.summary?.sport || 'Aktivita';

export function streamDiaryPdf(res, data, periodKey) {
  const period = DIARY_PERIODS[periodKey] || DIARY_PERIODS.month;
  const cutoff = Date.now() - period.days * 86400000;

  const allActs = data.activities || [];
  const acts = allActs
    .filter((a) => {
      const d = new Date(a.summary?.startTime || a.ts);
      return !isNaN(d) && d.getTime() >= cutoff;
    })
    .sort((a, b) => new Date(b.summary?.startTime || b.ts) - new Date(a.summary?.startTime || a.ts));

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: 'TEMPO — tréninkový deník' } });
  doc.registerFont('r', FONT);
  doc.registerFont('b', FONT_B);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="tempo-denik-${periodKey}.pdf"`);
  doc.pipe(res);

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  // ---- hlavička ----
  doc.rect(0, 0, doc.page.width, 92).fill(PINK);
  doc.fill('#fff').font('b').fontSize(26).text('TEMPO', L, 26);
  doc.font('r').fontSize(12).fill('#ffe3ee').text('Tréninkový deník — Oliver', L, 58);
  doc.font('r').fontSize(10).fill('#ffe3ee')
    .text(`${period.label}  ·  vytvořeno ${new Date().toLocaleDateString('cs-CZ')}`, L, 74);
  doc.y = 112;
  doc.fill(INK);

  const heading = (t) => {
    ensure(28);
    doc.moveDown(0.4);
    doc.font('b').fontSize(13).fill(PINK).text(t, L);
    doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).lineWidth(1).stroke(LINE);
    doc.moveDown(0.5);
    doc.fill(INK);
  };
  function ensure(h) {
    if (doc.y + h > doc.page.height - 50) doc.addPage();
  }

  // ---- souhrn období ----
  const totKm = acts.reduce((s, a) => s + (a.summary?.distanceKm || 0), 0);
  const totSec = acts.reduce((s, a) => s + (a.summary?.durationSec || 0), 0);
  const totElev = acts.reduce((s, a) => s + (a.summary?.elevationGainM || 0), 0);
  const bySport = {};
  for (const a of acts) {
    const k = sportName(a);
    bySport[k] = bySport[k] || { n: 0, km: 0, sec: 0 };
    bySport[k].n++; bySport[k].km += a.summary?.distanceKm || 0; bySport[k].sec += a.summary?.durationSec || 0;
  }

  heading('Souhrn období');
  const cards = [
    ['Tréninků', String(acts.length)],
    ['Vzdálenost', Math.round(totKm) + ' km'],
    ['Čas', fmtDur(totSec)],
    ['Nastoupáno', Math.round(totElev) + ' m'],
  ];
  const cw = W / cards.length;
  const cy = doc.y;
  cards.forEach((c, i) => {
    const x = L + cw * i;
    doc.font('b').fontSize(19).fill(INK).text(c[1], x, cy, { width: cw - 6 });
    doc.font('r').fontSize(9).fill(MUT).text(c[0].toUpperCase(), x, cy + 24, { width: cw - 6 });
  });
  doc.y = cy + 44;
  doc.fill(INK);

  if (Object.keys(bySport).length) {
    doc.font('r').fontSize(10).fill(MUT);
    for (const [k, v] of Object.entries(bySport)) {
      doc.text(`${k}: ${v.n}×  ·  ${Math.round(v.km)} km  ·  ${fmtDur(v.sec)}`, L);
    }
    doc.fill(INK);
  }

  // ---- forma ----
  try {
    const f = computeForm(allActs);
    if (!f.empty) {
      heading('Forma & zátěž (aktuální)');
      row2(`Kondice ${f.fitness}   ·   Únava ${f.fatigue}   ·   Forma ${f.form > 0 ? '+' : ''}${f.form}  (${f.trend === 'up' ? 'roste' : f.trend === 'down' ? 'klesá' : 'drží'})`);
      if (f.advice) { doc.font('r').fontSize(10).fill(MUT).text(f.advice, L, doc.y, { width: W }); doc.fill(INK); }
    }
  } catch {}

  // ---- tělo: váha & výška ----
  const meas = data.measurements || [];
  const weights = meas.filter((m) => m.weight_kg != null);
  const heights = meas.filter((m) => m.height_cm != null);
  if (weights.length || heights.length) {
    heading('Tělo');
    if (weights.length) {
      const diff = weights.length > 1 ? +(weights[0].weight_kg - weights[weights.length - 1].weight_kg).toFixed(1) : 0;
      row2(`Váha: ${weights[0].weight_kg} kg${diff ? `  (${diff > 0 ? '+' : ''}${diff} kg za období)` : ''}`);
    }
    if (heights.length) {
      const diff = heights.length > 1 ? +(heights[0].height_cm - heights[heights.length - 1].height_cm).toFixed(1) : 0;
      row2(`Výška: ${heights[0].height_cm} cm${diff ? `  (${diff > 0 ? '+' : ''}${diff} cm za období)` : ''}`);
    }
  }

  // ---- strava ----
  const nutr = data.nutrition || [];
  if (nutr.length) {
    heading('Strava');
    try {
      const ns = scoreNutrition(nutr);
      row2(`Dnes: bílkoviny ${ns.protein}, sacharidy ${ns.carbs}`);
    } catch {}
    doc.font('r').fontSize(9.5).fill(MUT);
    for (const n of nutr.slice(0, 8)) { ensure(14); doc.text(`${fmtDate(n.date)} — ${n.text}`, L, doc.y, { width: W }); }
    doc.fill(INK);
  }

  // ---- cíle ----
  const goals = (data.goals || []).filter((g) => g.date && new Date(g.date) >= new Date(Date.now() - 86400000))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (goals.length) {
    heading('Cíle & závody');
    doc.font('r').fontSize(10).fill(INK);
    for (const g of goals.slice(0, 6)) {
      const days = Math.ceil((new Date(g.date) - Date.now()) / 86400000);
      ensure(14);
      doc.text(`${fmtDate(g.date)} — ${g.title}${g.sport ? ' (' + g.sport + ')' : ''}${days >= 0 ? `  · za ${days} dní` : ''}`, L, doc.y, { width: W });
    }
  }

  // ---- odznaky ----
  try {
    const ach = computeAchievements(allActs, data.routineState || {});
    const earned = (ach.badges || []).filter((b) => b.earned);
    if (earned.length) {
      heading('Odznaky');
      const medal = { gold: 'ZLATO', silver: 'STŘÍBRO', bronze: 'BRONZ' };
      doc.font('r').fontSize(10).fill(INK);
      for (const b of earned) {
        ensure(14);
        doc.text(`${b.name} — ${medal[b.tier] || ''}${b.value != null && b.unit ? `  (${b.value} ${b.unit})` : ''}`, L, doc.y, { width: W });
      }
    }
  } catch {}

  // ---- seznam aktivit (tabulka) ----
  heading('Aktivity');
  if (!acts.length) {
    doc.font('r').fontSize(10).fill(MUT).text('Za tohle období nemáš žádné aktivity.', L);
    doc.fill(INK);
  } else {
    const cols = [
      ['Datum', 62], ['Sport', 78], ['Km', 46], ['Čas', 52], ['ø tep', 44], ['Přev.', 46], ['Hodn.', 40],
    ];
    const drawHead = () => {
      const hy = doc.y;
      let x = L;
      doc.font('b').fontSize(9).fill(MUT);
      cols.forEach(([t, w]) => { doc.text(t, x, hy, { width: w, lineBreak: false }); x += w; });
      doc.y = hy + 14;
      doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(0.7).stroke(LINE);
      doc.y += 4;
      doc.fill(INK);
    };
    drawHead();
    for (const a of acts) {
      ensure(16);
      if (doc.y < 60) drawHead();
      const s = a.summary || {};
      const cells = [
        fmtDate(s.startTime || a.ts),
        sportName(a) + (a.userKind === 'závod' ? ' (závod)' : ''),
        s.distanceKm != null ? String(Math.round(s.distanceKm * 10) / 10) : '—',
        a.labels?.duration || fmtDur(s.durationSec),
        s.avgHr != null ? String(s.avgHr) : '—',
        s.elevationGainM ? String(Math.round(s.elevationGainM)) : '—',
        a.coach?.rating ? a.coach.rating + '★' : '—',
      ];
      let x = L; const y = doc.y;
      doc.font('r').fontSize(9).fill(INK);
      cols.forEach(([, w], i) => { doc.text(cells[i], x, y, { width: w, lineBreak: false }); x += w; });
      doc.y = y + 13;
    }
  }

  // ---- patička s čísly stránek ----
  // margins.bottom = 0 dočasně, jinak psaní do spodního okraje přidá prázdnou stránku
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('r').fontSize(8).fill(MUT)
      .text(`TEMPO · tréninkový deník · strana ${i + 1}/${range.count}`, L, doc.page.height - 34, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();

  function row2(t) { ensure(16); doc.font('r').fontSize(11).fill(INK).text(t, L, doc.y, { width: W }); }
}
