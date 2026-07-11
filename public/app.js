const $ = (id) => document.getElementById(id);
const drop = $('drop');
const fileInput = $('file');
const msg = $('msg');
const result = $('result');
const uploader = $('uploader');

const ZONE_COLORS = ['#3DE0FF', '#5FBCF0', '#8E7BF0', '#C85CE0', '#FF4D8D'];
const SPORT_ICON = { bike: '🚴', run: '🏃', swim: '🏊', hike: '🥾', ski: '⛷️', unknown: '❤️' };
const HIST_KEY = 'tempo:history';

// ---------- historie (localStorage) ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; }
}
function saveActivity(data) {
  const list = loadHistory();
  list.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), ts: Date.now(), ...data });
  localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 200)));
}

// ---------- drag & drop ----------
['dragenter', 'dragover'].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); })
);
drop.addEventListener('drop', (ev) => {
  const f = ev.dataTransfer.files[0];
  if (f) uploadFile(f);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
});

$('again').addEventListener('click', () => {
  result.classList.remove('show');
  uploader.style.display = '';
  fileInput.value = '';
  msg.className = 'msg';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- přepínání obrazovek ----------
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => showScreen(t.dataset.screen))
);
function showScreen(name) {
  $('screen-upload').hidden = name !== 'upload';
  $('screen-history').hidden = name !== 'history';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.screen === name));
  if (name === 'history') renderHistory();
  window.scrollTo({ top: 0 });
}

function showMsg(text, kind) {
  msg.textContent = text;
  msg.className = 'msg ' + kind;
}

async function uploadFile(file) {
  showMsg('Zpracovávám ' + file.name + ' …', 'load');
  const fd = new FormData();
  fd.append('activity', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Něco se pokazilo.');
    render(data);
    saveActivity(data);
    msg.className = 'msg';
  } catch (err) {
    showMsg('⚠️ ' + err.message, 'err');
  }
}

function render({ summary, coach, labels }) {
  $('title').firstChild.textContent = labels.sportIcon + ' ' + labels.sport;
  $('subtitle').textContent = fmtDate(summary.startTime);

  const r = $('rating');
  r.textContent = '★'.repeat(coach.rating) + '☆'.repeat(5 - coach.rating);
  r.className = 'rating ' + (coach.rating >= 4 ? 'good' : coach.rating <= 2 ? 'low' : 'mid');

  $('metrics').innerHTML = metricsFor(summary, labels);

  $('headline').textContent = coach.headline;
  const badge = $('aibadge');
  if (badge) badge.style.display = coach.aiGenerated ? '' : 'none';

  const z = coach.zonesPct;
  const hasZones = z && (z.z1 + z.z2 + z.z3 + z.z4 + z.z5) > 0;
  $('zonesCard').style.display = hasZones ? '' : 'none';
  if (hasZones) {
    $('zonebar').innerHTML = ['z1', 'z2', 'z3', 'z4', 'z5']
      .map((k, i) => `<span style="flex:${Math.max(z[k], 0.5)};background:${ZONE_COLORS[i]}"></span>`)
      .join('');
  }

  const lists = [];
  coach.good.forEach((t) => lists.push(`<div class="li g"><span class="b">✓</span><span>${esc(t)}</span></div>`));
  coach.improve.forEach((t) => lists.push(`<div class="li i"><span class="b">→</span><span>${esc(t)}</span></div>`));
  $('listsCard').style.display = lists.length ? '' : 'none';
  $('lists').innerHTML = lists.join('');

  $('chips').innerHTML = coach.chips.map((c) => `<span class="chip">${c.icon} ${esc(c.text)}</span>`).join('');

  uploader.style.display = 'none';
  result.classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function metricsFor(s, labels) {
  const cells = [];
  const isRunOrSwim = s.sport === 'run' || s.sport === 'swim';
  if (s.distanceKm != null) cells.push(cell(s.distanceKm, 'km', 'vzdálenost'));
  cells.push(cell(labels.duration, '', 'čas'));
  if (isRunOrSwim && s.pacePerKm) cells.push(cell(s.pacePerKm, '/km', 'tempo'));
  else if (s.avgSpeedKmh != null) cells.push(cell(s.avgSpeedKmh, 'km/h', 'tempo'));
  if (s.avgHr != null) cells.push(cell(s.avgHr, 'bpm', 'prům. tep'));
  return cells.slice(0, 3).join('');
}

function cell(big, unit, label) {
  return `<div><div class="big">${big}${unit ? `<span class="u"> ${unit}</span>` : ''}</div><div class="lbl" style="margin-top:3px">${label}</div></div>`;
}

// ---------- vykreslení historie ----------
function renderHistory() {
  const list = loadHistory();
  const now = new Date();

  // začátek tohoto týdne (pondělí 00:00)
  const weekStart = new Date(now);
  const dow = (now.getDay() + 6) % 7; // 0 = pondělí
  weekStart.setDate(now.getDate() - dow);
  weekStart.setHours(0, 0, 0, 0);

  let weekKm = 0, monthKm = 0;
  for (const e of list) {
    const d = new Date(e.summary?.startTime || e.ts);
    const km = e.summary?.distanceKm || 0;
    if (d >= weekStart) weekKm += km;
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthKm += km;
  }

  $('weekKm').textContent = Math.round(weekKm);
  $('monthKm').textContent = Math.round(monthKm);
  $('totalCount').textContent = list.length;

  $('historyEmpty').style.display = list.length ? 'none' : '';
  $('historyList').innerHTML = list.map(historyRow).join('');
  document.querySelectorAll('.hrow').forEach((row, i) =>
    row.addEventListener('click', () => {
      render(list[i]);
      showScreen('upload');
    })
  );
}

function historyRow(e) {
  const s = e.summary || {};
  const sport = s.sport || 'unknown';
  const icon = SPORT_ICON[sport] || SPORT_ICON.unknown;
  const iconClass = ['bike', 'run', 'swim', 'hike'].includes(sport) ? sport : 'unknown';
  const stars = '★'.repeat(e.coach?.rating || 0) + '☆'.repeat(5 - (e.coach?.rating || 0));
  const val = s.distanceKm != null ? `${s.distanceKm} km` : (e.labels?.duration || '—');
  let sub = '';
  if (sport === 'run' || sport === 'swim') sub = s.pacePerKm ? `${s.pacePerKm} /km` : '';
  else sub = s.avgSpeedKmh != null ? `${s.avgSpeedKmh} km/h` : '';
  return `<button class="hrow">
    <div class="hicon ${iconClass}">${icon}</div>
    <div class="meta"><b>${esc(e.labels?.sport || 'Aktivita')}</b><span>${fmtDate(s.startTime || e.ts)} · <span class="stars">${stars}</span></span></div>
    <div class="val"><b>${esc(val)}</b><span>${esc(sub)}</span></div>
  </button>`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' });
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- start: obnov poslední hodnocení ----------
(function init() {
  const list = loadHistory();
  if (list.length) render(list[0]);
})();
