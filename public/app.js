const $ = (id) => document.getElementById(id);
const drop = $('drop');
const fileInput = $('file');
const msg = $('msg');
const result = $('result');
const uploader = $('uploader');

const ZONE_COLORS = ['#3DE0FF', '#5FBCF0', '#8E7BF0', '#C85CE0', '#FF4D8D'];

// --- drag & drop ---
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
    msg.className = 'msg';
  } catch (err) {
    showMsg('⚠️ ' + err.message, 'err');
  }
}

function render({ summary, coach, labels }) {
  // hlavička
  $('title').firstChild.textContent = labels.sportIcon + ' ' + labels.sport;
  $('subtitle').textContent = fmtDate(summary.startTime);

  // rating
  const r = $('rating');
  const stars = '★'.repeat(coach.rating) + '☆'.repeat(5 - coach.rating);
  r.textContent = stars;
  r.className = 'rating ' + (coach.rating >= 4 ? 'good' : coach.rating <= 2 ? 'low' : 'mid');

  // metriky (dle sportu)
  $('metrics').innerHTML = metricsFor(summary, labels);

  // komentář
  $('headline').textContent = coach.headline;
  const badge = $('aibadge');
  if (badge) badge.style.display = coach.aiGenerated ? '' : 'none';

  // zóny
  const z = coach.zonesPct;
  const hasZones = z && (z.z1 + z.z2 + z.z3 + z.z4 + z.z5) > 0;
  $('zonesCard').style.display = hasZones ? '' : 'none';
  if (hasZones) {
    $('zonebar').innerHTML = ['z1', 'z2', 'z3', 'z4', 'z5']
      .map((k, i) => `<span style="flex:${Math.max(z[k], 0.5)};background:${ZONE_COLORS[i]}"></span>`)
      .join('');
  }

  // seznamy dobré/na příště
  const lists = [];
  coach.good.forEach((t) => lists.push(`<div class="li g"><span class="b">✓</span><span>${esc(t)}</span></div>`));
  coach.improve.forEach((t) => lists.push(`<div class="li i"><span class="b">→</span><span>${esc(t)}</span></div>`));
  $('listsCard').style.display = lists.length ? '' : 'none';
  $('lists').innerHTML = lists.join('');

  // chipy
  $('chips').innerHTML = coach.chips
    .map((c) => `<span class="chip">${c.icon} ${esc(c.text)}</span>`)
    .join('');

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

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' });
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
