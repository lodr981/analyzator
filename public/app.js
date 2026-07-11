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

function render(data) {
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

// ---------- parťák chat ----------
const chatText = $('chatText');
const chatSend = $('chatSend');
const chatMsg = $('chatMsg');
let chatLoaded = false;

chatSend.addEventListener('click', sendChatMessage);
document.querySelectorAll('#chatChips .chip').forEach((c) =>
  c.addEventListener('click', () => { chatText.value = c.dataset.q; sendChatMessage(); })
);
$('askCoach').addEventListener('click', () => {
  showScreen('chat');
  chatText.value = 'Rozeber mi můj poslední trénink a porovnej ho s předchozím.';
  chatText.focus();
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
      $('chatChips').style.display = off ? 'none' : '';
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
}

// váha & výživa (zápis přes parťáka; tady jen přehled)
async function renderBody() {
  let body;
  try { body = await (await fetch('/api/body')).json(); } catch { body = { weights: [], nutrition: [] }; }

  const w = (body.weights || []); // nejnovější první
  const h = (body.heights || []);
  const wc = $('weightCard');
  wc.style.display = (w.length || h.length) ? '' : 'none';

  // výška
  const hl = $('heightLine');
  if (h.length) {
    hl.style.display = '';
    $('heightLatest').textContent = h[0].height_cm + ' cm';
    const hOldest = h[h.length - 1].height_cm;
    const hDiff = +(h[0].height_cm - hOldest).toFixed(1);
    const hc = $('heightChange');
    if (h.length > 1 && hDiff !== 0) { hc.textContent = (hDiff > 0 ? '▲ +' : '▼ ') + hDiff + ' cm'; hc.style.color = 'var(--volt)'; }
    else hc.textContent = '';
  } else hl.style.display = 'none';

  // váha (blok se skryje, když není váha; karta zůstane kvůli výšce)
  $('weightBlock').style.display = w.length ? '' : 'none';
  $('heightLine').style.borderTop = w.length && h.length ? '1px solid var(--line)' : 'none';
  $('heightLine').style.paddingTop = w.length && h.length ? '12px' : '0';
  if (w.length) {
    $('weightLatest').textContent = w[0].weight_kg;
    $('weightDate').textContent = fmtDate(w[0].date);
    const oldest = w[w.length - 1].weight_kg;
    const diff = +(w[0].weight_kg - oldest).toFixed(1);
    const ch = $('weightChange');
    if (w.length > 1 && diff !== 0) {
      ch.textContent = (diff > 0 ? '▲ +' : '▼ ') + diff + ' kg';
      ch.style.color = diff > 0 ? 'var(--volt)' : 'var(--cyan)';
    } else ch.textContent = '';

    const chrono = w.slice(0, 8).reverse();
    const vals = chrono.map((x) => x.weight_kg);
    const min = Math.min(...vals), max = Math.max(...vals);
    $('weightBars').innerHTML = chrono.map((x, i) => {
      const bh = max === min ? 60 : Math.round(20 + ((x.weight_kg - min) / (max - min)) * 80);
      const cur = i === chrono.length - 1 ? 'cur' : '';
      return `<div class="lb ${cur}"><div class="v">${x.weight_kg}</div><div class="col" style="height:${bh}%"></div><div class="d">${fmtDay(x.date)}</div></div>`;
    }).join('');
  }

  const n = (body.nutrition || []);
  const nc = $('nutritionCard');
  if (n.length) {
    nc.style.display = '';
    $('nutritionBody').innerHTML = n.map((e) =>
      `<div style="display:flex;gap:9px;font-size:13px;padding:5px 0;border-bottom:1px solid var(--line)"><span style="color:var(--ink-3);font-weight:700;flex:0 0 auto;min-width:42px">${fmtDay(e.date)}</span><span>${esc(e.text)}</span></div>`
    ).join('');
  } else nc.style.display = 'none';
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

  const list = await fetchActivities();
  if (list.length) render(list[0]);
})();
