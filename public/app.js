const $ = (id) => document.getElementById(id);
const drop = $('drop');
const fileInput = $('file');
const msg = $('msg');
const result = $('result');
const uploader = $('uploader');

const ZONE_COLORS = ['#3DE0FF', '#5FBCF0', '#8E7BF0', '#C85CE0', '#FF4D8D'];
const SPORT_ICON = { bike: '🚴', run: '🏃', swim: '🏊', hike: '🥾', ski: '⛷️', unknown: '❤️' };
const HIST_KEY = 'tempo:history';

// ---------- historie (server + localStorage cache) ----------
function loadCache() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; }
}
function saveCache(list) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 200))); } catch {}
}
// Přidá záznam do lokální cache (server ho ukládá sám při uploadu).
function cacheActivity(record) {
  const list = loadCache();
  if (!list.some((a) => a.id === record.id)) list.unshift(record);
  saveCache(list);
}
// Načte historii ze serveru; když server nejede, použije lokální cache.
async function fetchActivities() {
  try {
    const res = await fetch('/api/activities');
    if (res.ok) {
      const list = await res.json();
      saveCache(list);
      return list;
    }
  } catch {}
  return loadCache();
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
  $('screen-chat').hidden = name !== 'chat';
  $('screen-plan').hidden = name !== 'plan';
  $('screen-routine').hidden = name !== 'routine';
  $('screen-form').hidden = name !== 'form';
  $('screen-history').hidden = name !== 'history';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.screen === name));
  if (name === 'history') renderHistory();
  if (name === 'plan') loadPlan();
  if (name === 'form') renderForm();
  if (name === 'chat') loadChat();
  if (name === 'routine') renderRoutine();
  if (name === 'upload') loadHome();
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
    cacheActivity(data);
    msg.className = 'msg';
    if (data.saved === false) {
      $('dbWarn').hidden = false;
      const det = $('dbWarnDetail');
      if (det) det.textContent = ' Poslední aktivita se neuložila do databáze (backend: ' + (data.db || '?') + ').';
    }
  } catch (err) {
    showMsg('⚠️ ' + err.message, 'err');
  }
}

let lastActivity = null;
function render(data) {
  lastActivity = data;
  const { summary, coach, labels } = data;
  $('title').firstChild.textContent = labels.sportIcon + ' ' + labels.sport;
  $('subtitle').textContent = fmtDate(summary.startTime);
  $('dupNote').style.display = data.duplicate ? '' : 'none';

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
  (coach.good || []).forEach((t) => lists.push(`<div class="li g"><span class="b">✓</span><span>${esc(t)}</span></div>`));
  (coach.improve || []).forEach((t) => lists.push(`<div class="li i"><span class="b">→</span><span>${esc(t)}</span></div>`));
  $('listsCard').style.display = lists.length ? '' : 'none';
  $('lists').innerHTML = lists.join('');

  $('chips').innerHTML = (coach.chips || []).map((c) => `<span class="chip">${c.icon} ${esc(c.text)}</span>`).join('');

  uploader.style.display = 'none';
  result.classList.add('show');
  loadHome(); // připravenost se mění s novou aktivitou
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
async function renderHistory() {
  const list = await fetchActivities();
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
  $('historyHdr').style.display = list.length ? '' : 'none';
  $('historyList').innerHTML = list.map(historyRow).join('');
  renderAchievements();
  document.querySelectorAll('.hrow').forEach((row, i) =>
    row.addEventListener('click', () => {
      render(list[i]);
      showScreen('upload');
    })
  );
}

async function renderAchievements() {
  let a;
  try { a = await (await fetch('/api/achievements')).json(); } catch { return; }
  if (!a || a.error) return;

  // série
  const sc = $('streakCard');
  if (a.streak > 0) {
    sc.style.display = '';
    $('streakNum').textContent = a.streak;
    $('streakSub').textContent = a.streak === 1 ? 'den' : a.streak < 5 ? 'dny v kuse' : 'dní v kuse';
  } else sc.style.display = 'none';

  // rekordy
  const r = a.records || {};
  const rows = [];
  if (r.longestKm) rows.push(['Nejdelší jízda', r.longestKm + ' km']);
  if (r.fastestKmh) rows.push(['Nejrychleji', r.fastestKmh + ' km/h']);
  if (r.elevationM) rows.push(['Nejvíc nastoupáno', r.elevationM + ' m']);
  if (r.longestTimeSec) rows.push(['Nejdéle v sedle', fmtDur(r.longestTimeSec)]);
  if (r.bestRunPace) rows.push(['Nejlepší tempo (běh)', r.bestRunPace + ' /km']);
  const rc = $('recordsCard');
  rc.style.display = rows.length ? '' : 'none';
  $('recordsBody').innerHTML = rows.map(([l, v]) => `<div class="rec"><span class="rl">${l}</span><span class="rv">${esc(v)}</span></div>`).join('');

  // odznaky (3 úrovně: bronz / stříbro / zlato)
  const bw = $('badgesWrap');
  bw.style.display = (a.badges && a.badges.length) ? '' : 'none';
  $('badges').innerHTML = (a.badges || []).map(badgeHtml).join('');
}

const TIER_LABEL = { gold: '🥇 EU špička', silver: '🥈 ČR špička', bronze: '🥉 Bronz' };
const TIER_COLOR = { gold: '#FFD24D', silver: '#C7D0DE', bronze: '#E08A4D' };
function badgeHtml(b) {
  const tierClass = b.tier ? 'tier-' + b.tier : 'off';
  const unit = b.unit ? ' ' + b.unit : '';
  // spodní řádek: medaile (pokud je) + postup k další úrovni
  let sub;
  if (b.next == null) sub = b.tier ? TIER_LABEL[b.tier] + ' · MAX' : 'MAX';
  else if (b.tier) sub = `${TIER_LABEL[b.tier]} · ${b.value}/${b.next}${unit}`;
  else sub = `${b.value}/${b.next}${unit}`;
  const barColor = b.next == null ? (TIER_COLOR[b.tier] || 'var(--volt)')
    : (b.tier === 'silver' ? TIER_COLOR.gold : b.tier === 'bronze' ? TIER_COLOR.silver : TIER_COLOR.bronze);
  return `
    <div class="badge ${tierClass}">
      <div class="bic">${b.icon}</div>
      <div class="bnm">${esc(b.name)}</div>
      <div class="bpg">${esc(sub)}</div>
      <div class="bbar"><i style="width:${b.pct}%;background:${barColor}"></i></div>
    </div>`;
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
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

// ---------- parťák chat ----------
const chatText = $('chatText');
const chatSend = $('chatSend');
const chatMsg = $('chatMsg');
let chatLoaded = false;

chatSend.addEventListener('click', sendChatMessage);
document.querySelectorAll('#chatChips .chip, #chatChips2 .chip').forEach((c) =>
  c.addEventListener('click', () => {
    if (c.dataset.fill != null) {
      // šablona k doplnění — vlož a nech Olivera dopsat (neodesílej)
      chatText.value = c.dataset.fill;
      chatText.focus();
      chatText.setSelectionRange(chatText.value.length, chatText.value.length);
    } else {
      chatText.value = c.dataset.q;
      sendChatMessage();
    }
  })
);
$('askCoach').addEventListener('click', () => {
  showScreen('chat');
  chatText.value = 'Rozeber mi můj poslední trénink a porovnej ho s předchozím.';
  chatText.focus();
});
$('makeStory').addEventListener('click', () => {
  if (lastActivity && window.openStory) window.openStory(lastActivity);
});

async function loadChat() {
  if (chatLoaded) return;
  chatLoaded = true;
  try {
    const res = await fetch('/api/chat');
    if (res.ok) {
      const state = await res.json();
      const off = state.aiEnabled === false;
      $('chatAiOff').hidden = !off;
      $('chatChipsWrap').style.display = off ? 'none' : '';
      renderChat(state);
    }
  } catch {}
}

async function sendChatMessage() {
  const message = chatText.value.trim();
  if (!message) return;
  chatSend.disabled = true;
  chatMsg.textContent = '🧠 Přemýšlím…';
  chatMsg.className = 'msg load';
  try {
    const res = await fetch('/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const state = await res.json();
    if (!res.ok) throw new Error(state.error || 'Něco se pokazilo.');
    chatText.value = '';
    chatMsg.className = 'msg';
    renderChat(state);
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  } catch (err) {
    chatMsg.textContent = '⚠️ ' + err.message;
    chatMsg.className = 'msg err';
  } finally {
    chatSend.disabled = false;
  }
}

function renderChat(state) {
  $('chatMsgs').innerHTML = (state.messages || [])
    .map((m) => `<div class="pmsg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`)
    .join('');
}

// ---------- denní rutina ----------
let routineDef = [];
let routineTotal = 1;
let routineDone = [];

async function renderRoutine() {
  try {
    const res = await fetch('/api/routine');
    if (res.ok) {
      const d = await res.json();
      routineDone = d.done || [];
      if (d.routine) routineDef = d.routine;
    }
  } catch {}
  routineTotal = routineDef.reduce((n, g) => n + g.items.length, 0) || 1;
  paintRoutine();
}

function paintRoutine() {
  const done = new Set(routineDone);
  const body = $('routineBody');
  body.innerHTML = routineDef.map((g) => `
    <div class="exgroup">
      <div class="h">${esc(g.group)}</div>
      ${g.items.map((it) => `
        <div class="exwrap">
          <div class="exrow ${done.has(it.id) ? 'done' : ''}" data-ex="${it.id}">
            <span class="box">✓</span>
            <span class="nm">${esc(it.name)}</span>
            <span class="rp">${esc(it.reps)}</span>
            <span class="exinfo" data-info="${it.id}">?</span>
          </div>
          <div class="exdetail" data-detail="${it.id}" hidden>
            <div><b>Jak:</b> ${esc(it.how || '')}</div>
            <div style="margin-top:5px"><b>Proč:</b> ${esc(it.why || '')}</div>
          </div>
        </div>`).join('')}
    </div>`).join('');

  body.querySelectorAll('.exrow').forEach((row) =>
    row.addEventListener('click', (e) => {
      if (e.target.closest('.exinfo')) return; // klik na „?" neodškrtává
      toggleEx(row.dataset.ex);
    })
  );
  body.querySelectorAll('.exinfo').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = body.querySelector(`.exdetail[data-detail="${btn.dataset.info}"]`);
      if (d) d.hidden = !d.hidden;
    })
  );

  const n = routineDone.length;
  $('routineCount').textContent = `${n}/${routineTotal} hotovo`;
  $('routineBar').style.width = Math.round((n / routineTotal) * 100) + '%';
  $('routineMsg').textContent = n >= routineTotal
    ? 'Hotovo, celá rutina! Přesně tak se dělá rozdíl. 🔥'
    : n === 0
      ? 'Rutina není bonus, je součást tréninku. Silný core = víc wattů a míň zranění. Klepni na „?" u cviku, když nevíš jak na to. 💪'
      : `Ještě ${routineTotal - n} a máš to. Nepolevuj. 💪`;
}

async function toggleEx(exId) {
  // optimisticky přepni hned
  const i = routineDone.indexOf(exId);
  if (i >= 0) routineDone.splice(i, 1); else routineDone.push(exId);
  paintRoutine();
  try {
    const res = await fetch('/api/routine/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exId }),
    });
    if (res.ok) { routineDone = (await res.json()).done || routineDone; paintRoutine(); }
  } catch {}
}

// ---------- forma & periodizace ----------
async function renderForm() {
  let data;
  try {
    const res = await fetch('/api/form');
    data = await res.json();
  } catch { data = { empty: true }; }

  renderBody(); // váha/výživa nezávisle na tréninkové formě

  const empty = data.empty;
  $('formEmpty').style.display = empty ? '' : 'none';
  ['formLoadCard', 'formAdviceCard'].forEach((id) => { $(id).style.display = empty ? 'none' : ''; });
  document.querySelectorAll('#screen-form .statrow').forEach((el) => { el.style.display = empty ? 'none' : ''; });
  if (empty) return;

  const max = Math.max(1, ...data.weeks.map((w) => w.load));
  $('loadbars').innerHTML = data.weeks.map((w) => `
    <div class="lb ${w.current ? 'cur' : ''}">
      <div class="v">${w.load}</div>
      <div class="col" style="height:${Math.round((w.load / max) * 100)}%"></div>
      <div class="d">${esc(w.label)}</div>
    </div>`).join('');

  $('fitness').textContent = data.fitness;
  $('fatigue').textContent = data.fatigue;
  const fv = $('formVal');
  fv.textContent = (data.form > 0 ? '+' : '') + data.form;
  fv.style.color = data.form >= 0 ? 'var(--volt)' : 'var(--pink)';
  $('fitTrend').textContent = data.trend === 'up' ? 'roste ↗' : data.trend === 'down' ? 'klesá ↘' : 'drží →';
  $('formAdvice').textContent = data.advice;

  renderCalendar(data.calendar || []);
}

// Kalendář konzistence — mřížka à la GitHub (sloupce = týdny, řádky Po–Ne).
function loadBucket(load) {
  if (load <= 0) return 0;
  if (load <= 20) return 1;
  if (load <= 40) return 2;
  if (load <= 70) return 3;
  return 4;
}
function renderCalendar(cal) {
  const card = $('calCard');
  if (!cal.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  $('calGrid').innerHTML = cal.map((d) => {
    const lv = loadBucket(d.load);
    const t = d.load > 0 ? `${fmtDate(d.date)} · zátěž ${d.load}` : `${fmtDate(d.date)} · volno`;
    return `<i class="cell lv${lv}" title="${t}"></i>`;
  }).join('');
}

// ---------- domácí přehled: připravenost dne + odpočet na závod ----------
async function loadHome() {
  try {
    const [r, g] = await Promise.all([
      fetch('/api/readiness').then((x) => x.json()).catch(() => ({ empty: true })),
      fetch('/api/goals').then((x) => x.json()).catch(() => ({ next: null })),
    ]);
    renderReadiness(r);
    renderRace(g.next);
  } catch {}
}

function renderReadiness(r) {
  const card = $('readyCard');
  card.style.display = '';
  const row = $('readyRow'), hint = $('readyHint');
  if (!r || r.empty) {
    row.style.display = 'none';
    hint.style.display = '';
    return;
  }
  row.style.display = '';
  hint.style.display = 'none';
  const b = r.band;
  $('readyScore').textContent = r.score;
  $('readyScore').style.color = b.color;
  $('readyRing').style.background =
    `conic-gradient(${b.color} ${r.score * 3.6}deg, var(--surf-2) 0)`;
  $('readyLabel').innerHTML = `${b.emoji} ${esc(b.label)}`;
  $('readyLabel').style.color = b.color;
  $('readyAdvice').textContent = b.advice;
  $('readyReasons').innerHTML = (r.reasons || [])
    .map((x) => `<span class="rz ${x.good ? 'g' : 'b'}">${x.good ? '✓' : '!'} ${esc(x.text)}</span>`)
    .join('');
}

function renderRace(next) {
  const card = $('raceCard');
  if (!next) { card.style.display = 'none'; return; }
  card.style.display = '';
  $('raceDays').textContent = next.days === 0 ? 'DNES' : next.days === 1 ? 'zítra' : `za ${next.days} dní`;
  $('raceName').textContent = next.title + (next.sport ? ' · ' + next.sport : '');
  $('raceDate').textContent = fmtDate(next.date);
}

// Jednoduchý spojnicový graf (SVG) — jedna série, sdílená časová osa přes `domain`.
function lineChartSVG(pts, domain, color) {
  const W = 620, H = 200, padX = 40, padTop = 42, padBot = 30;
  if (!pts.length) return '';
  const xmin = domain ? domain[0] : Math.min(...pts.map((p) => p.t));
  const xmax = domain ? domain[1] : Math.max(...pts.map((p) => p.t));
  const vals = pts.map((p) => p.v);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }
  const pad = (vmax - vmin) * 0.22; vmin -= pad; vmax += pad;
  const X = (t) => padX + (xmax === xmin ? (W - 2 * padX) / 2 : ((t - xmin) / (xmax - xmin)) * (W - 2 * padX));
  const Y = (v) => padTop + (1 - (v - vmin) / (vmax - vmin)) * (H - padTop - padBot);
  const P = pts.map((p) => [X(p.t), Y(p.v)]);
  const id = 'g' + Math.random().toString(36).slice(2, 8);

  const line = P.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = `M${P[0][0].toFixed(1)} ${H - padBot} ` +
    P.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') +
    ` L${P[P.length - 1][0].toFixed(1)} ${H - padBot} Z`;

  const dots = P.map(([x, y], i) => {
    const last = i === P.length - 1;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${last ? 8 : 5}" fill="${last ? color : '#0C0A16'}" stroke="${color}" stroke-width="${last ? 3 : 3}"/>`;
  }).join('');

  // popisky hodnot: první (tlumeně) a poslední (barevně)
  const labelPt = (idx, col, weight) => {
    const [x, y] = P[idx];
    const anchor = x < padX + 30 ? 'start' : x > W - padX - 30 ? 'end' : 'middle';
    return `<text x="${x.toFixed(1)}" y="${(y - 18).toFixed(1)}" fill="${col}" font-size="26" font-weight="${weight}" text-anchor="${anchor}" font-family="system-ui,-apple-system,sans-serif">${pts[idx].v}</text>`;
  };
  const labels = P.length > 1
    ? labelPt(0, 'rgba(255,255,255,.45)', 700) + labelPt(P.length - 1, color, 800)
    : labelPt(0, color, 800);

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}
  </svg>`;
}

function renderGrowthSeries(secId, chartId, latestId, changeId, chrono, domain, opt) {
  const sec = $(secId);
  if (!chrono.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const latest = chrono[chrono.length - 1].v;
  const oldest = chrono[0].v;
  $(latestId).textContent = latest;
  const diff = +(latest - oldest).toFixed(1);
  const ch = $(changeId);
  if (chrono.length > 1 && diff !== 0) {
    ch.textContent = (diff > 0 ? '▲ +' : '▼ ') + Math.abs(diff) + ' ' + opt.unit;
    ch.style.color = diff > 0 ? opt.deltaUp : opt.deltaDown;
  } else ch.textContent = '';
  $(chartId).innerHTML = lineChartSVG(chrono, domain, opt.color);
}

// váha & výživa (zápis přes parťáka; tady jen přehled)
async function renderBody() {
  let body;
  try { body = await (await fetch('/api/body')).json(); } catch { body = { weights: [], nutrition: [] }; }

  const w = (body.weights || []); // nejnovější první
  const h = (body.heights || []);
  const wc = $('growthCard');
  wc.style.display = (w.length || h.length) ? '' : 'none';

  // společná časová osa, ať jsou oba grafy zarovnané pod sebou
  const allDates = [...w, ...h].map((x) => +new Date(x.date)).filter((t) => !isNaN(t));
  const domain = allDates.length ? [Math.min(...allDates), Math.max(...allDates)] : null;

  // výška (chronologicky, nejstarší → nejnovější)
  const hChrono = h.slice().reverse().map((x) => ({ t: +new Date(x.date), v: x.height_cm }));
  renderGrowthSeries('heightSec', 'heightChart', 'heightLatest', 'heightChange',
    hChrono, domain, { color: '#3DE0FF', unit: 'cm', deltaUp: 'var(--volt)', deltaDown: 'var(--ink-2)' });

  // váha
  const wChrono = w.slice().reverse().map((x) => ({ t: +new Date(x.date), v: x.weight_kg }));
  renderGrowthSeries('weightSec', 'weightChart', 'weightLatest', 'weightChange',
    wChrono, domain, { color: '#FF4D8D', unit: 'kg', deltaUp: 'var(--ink-2)', deltaDown: 'var(--cyan)' });

  const n = (body.nutrition || []);
  const nc = $('nutritionCard');
  if (n.length) {
    nc.style.display = '';
    renderNutrition(body.nutritionSummary);
    $('nutritionBody').innerHTML = n.map((e) =>
      `<div style="display:flex;gap:9px;font-size:13px;padding:5px 0;border-bottom:1px solid var(--line)"><span style="color:var(--ink-3);font-weight:700;flex:0 0 auto;min-width:42px">${fmtDay(e.date)}</span><span>${esc(e.text)}</span></div>`
    ).join('');
  } else nc.style.display = 'none';
}

// úroveň stravy → šířka a barva ukazatele
function nutLevel(lvl) {
  if (lvl === 'vysoká') return { w: 100, c: 'var(--volt)' };
  if (lvl === 'střední') return { w: 66, c: 'var(--cyan)' };
  return { w: 33, c: 'var(--amber)' };
}
function renderNutrition(sum) {
  if (!sum) return;
  const p = nutLevel(sum.protein), c = nutLevel(sum.carbs);
  $('nutProteinFill').style.width = p.w + '%';
  $('nutProteinFill').style.background = p.c;
  $('nutProteinLvl').textContent = sum.protein;
  $('nutProteinLvl').style.color = p.c;
  $('nutCarbFill').style.width = c.w + '%';
  $('nutCarbFill').style.background = c.c;
  $('nutCarbLvl').textContent = sum.carbs;
  $('nutCarbLvl').style.color = c.c;
  $('nutTip').innerHTML = (sum.tips || []).map((t) => `<div class="nutTipLine">${esc(t)}</div>`).join('');
}

function fmtDay(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.`;
}

// ---------- plán z chatu ----------
const planText = $('planText');
const planSend = $('planSend');
const planMsg = $('planMsg');
let planLoaded = false;

planSend.addEventListener('click', sendPlanMessage);

async function loadPlan() {
  if (planLoaded) return;
  planLoaded = true;
  try {
    const res = await fetch('/api/plan');
    if (res.ok) renderPlan(await res.json());
  } catch {}
}

async function sendPlanMessage() {
  const message = planText.value.trim();
  if (!message) return;
  planSend.disabled = true;
  planMsg.textContent = '🧠 Rozkládám týden…';
  planMsg.className = 'msg load';
  try {
    const res = await fetch('/api/plan/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const state = await res.json();
    if (!res.ok) throw new Error(state.error || 'Něco se pokazilo.');
    planText.value = '';
    planMsg.className = 'msg';
    renderPlan(state);
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  } catch (err) {
    planMsg.textContent = '⚠️ ' + err.message;
    planMsg.className = 'msg err';
  } finally {
    planSend.disabled = false;
  }
}

function renderPlan(state) {
  const week = $('planWeek');
  if (state.plan && state.plan.days?.length) {
    const label = state.plan.weekLabel ? `<div class="weeklabel">${esc(state.plan.weekLabel)}</div>` : '';
    week.innerHTML = label + state.plan.days.map((d) => `
      <div class="pday k-${esc(d.kind)}">
        <div class="dow">${esc(d.day)}</div>
        <div class="body"><div class="ttl">${esc(d.title)}</div><div class="det">${esc(d.detail)}</div></div>
      </div>`).join('');
  } else {
    week.innerHTML = '';
  }

  const chat = $('planChat');
  chat.innerHTML = (state.messages || [])
    .map((m) => `<div class="pmsg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.text)}</div>`)
    .join('');

  // po prvním plánu už jde jen doplňovat / měnit
  const hasPlan = !!(state.plan && state.plan.days?.length);
  planSend.textContent = hasPlan ? 'Poslat úpravu' : 'Rozložit týden';
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

// ---------- připomínky (web push) ----------
const pushEnable = $('pushEnable');
const pushTest = $('pushTest');
const pushStatus = $('pushStatus');

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    pushStatus.textContent = 'Push notifikace tenhle prohlížeč nepodporuje. Na iPhonu přidej appku na plochu.';
    pushEnable.disabled = true;
    return;
  }
  try {
    await navigator.serviceWorker.register('/sw.js');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) showPushOn();
  } catch (e) { /* ignore */ }
}

function showPushOn() {
  pushEnable.textContent = '✅ Připomínky zapnuté';
  pushEnable.disabled = true;
  pushTest.style.display = '';
  pushStatus.textContent = 'Budeme ti připomínat, když si zapomeneš nahrát trénink nebo udělat rutinu.';
}

pushEnable.addEventListener('click', async () => {
  pushEnable.disabled = true;
  pushStatus.textContent = 'Zapínám…';
  try {
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      pushStatus.textContent = 'Bez povolení notifikací to nepůjde. Povol je v nastavení.';
      pushEnable.disabled = false;
      return;
    }
    const { key } = await (await fetch('/api/push/key')).json();
    if (!key) throw new Error('Server nemá klíč.');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub }),
    });
    showPushOn();
  } catch (err) {
    pushStatus.textContent = '⚠️ Nepodařilo se zapnout: ' + err.message + ' (na iPhonu musí být appka na ploše).';
    pushEnable.disabled = false;
  }
});

pushTest.addEventListener('click', async () => {
  pushStatus.textContent = 'Posílám test…';
  try {
    const r = await (await fetch('/api/push/test', { method: 'POST' })).json();
    pushStatus.textContent = r.sent ? 'Test odeslán 🚀 (za chvíli přijde notifikace)' : 'Žádný aktivní odběr.';
  } catch { pushStatus.textContent = 'Test se nepodařil.'; }
});

// ---------- start ----------
(async function init() {
  initPush();
  // varuj, když se data neukládají trvale (na Railway = chybí Postgres)
  try {
    const h = await (await fetch('/healthz')).json();
    if (h.db !== 'postgres') {
      $('dbWarn').hidden = false;
      const det = $('dbWarnDetail');
      if (det) {
        det.textContent = h.hasDbUrl === false
          ? ' Appka nevidí DATABASE_URL — na Railway ji přidej k app službě přes Add Reference → Postgres → DATABASE_URL.'
          : ' Chyba připojení: ' + (h.dbError || 'neznámá');
      }
    }
  } catch {}

  loadHome();
  $('readyHint').addEventListener('click', () => {
    showScreen('chat');
    chatText.value = 'Dneska jsem spal 8 hodin a cítím se na 4 z 5.';
    chatText.focus();
  });

  const list = await fetchActivities();
  if (list.length) render(list[0]);
})();
