// Story generátor — z aktivity vykreslí sdílitelný obrázek (9:16) přes canvas.
// Pozadí: cool přednastavené designy nebo vlastní foto. Sdílení přes Web Share.

(function () {
  const W = 1080, H = 1920;
  let activity = null;
  let bg = 'sunset';       // preset id, nebo 'photo'
  let photoImg = null;     // Image, když má vlastní foto
  let canvas, ctx;

  const PRESETS = [
    { id: 'sunset', name: 'Sunset', kind: 'grad', stops: [['#FF4D8D', 0], ['#FF7A4D', 0.5], ['#3DE0FF', 1]], angle: 135 },
    { id: 'neon', name: 'Neon', kind: 'glow', base: '#0C0A16', glows: [['#FF4D8D', 0.22, 0.15], ['#3DE0FF', 0.85, 0.2]] },
    { id: 'volt', name: 'Volt', kind: 'glow', base: '#0E1210', glows: [['#C6FF4D', 0.2, 0.1], ['#3DE0FF', 0.9, 0.85]] },
    { id: 'plum', name: 'Temná', kind: 'grad', stops: [['#231D42', 0], ['#0C0A16', 1]], angle: 160 },
  ];

  function esc(s) { return String(s == null ? '' : s); }

  // ---------- kreslení ----------
  function drawBackground() {
    if (bg === 'photo' && photoImg) {
      // cover fit
      const r = Math.max(W / photoImg.width, H / photoImg.height);
      const w = photoImg.width * r, h = photoImg.height * r;
      ctx.drawImage(photoImg, (W - w) / 2, (H - h) / 2, w, h);
      return;
    }
    const p = PRESETS.find((x) => x.id === bg) || PRESETS[0];
    if (p.kind === 'grad') {
      const a = (p.angle * Math.PI) / 180;
      const x = Math.cos(a), y = Math.sin(a);
      const g = ctx.createLinearGradient(W / 2 - x * W, H / 2 - y * H, W / 2 + x * W, H / 2 + y * H);
      for (const [c, o] of p.stops) g.addColorStop(o, c);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = p.base; ctx.fillRect(0, 0, W, H);
      for (const [c, gx, gy] of p.glows) {
        const rg = ctx.createRadialGradient(W * gx, H * gy, 0, W * gx, H * gy, W * 0.9);
        rg.addColorStop(0, c + 'AA'); rg.addColorStop(1, c + '00');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
    }
  }

  function drawScrims() {
    let g = ctx.createLinearGradient(0, 0, 0, H * 0.35);
    g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.35);
    g = ctx.createLinearGradient(0, H * 0.5, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.8)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.5, W, H * 0.5);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawLogo(x, y, s) {
    // gradient rounded square
    const g = ctx.createLinearGradient(x, y, x + s, y + s);
    g.addColorStop(0, '#FF4D8D'); g.addColorStop(0.5, '#FF7A4D'); g.addColorStop(1, '#3DE0FF');
    ctx.fillStyle = g; roundRect(x, y, s, s, s * 0.3); ctx.fill();
    // pulse line (path z SVG 4,17 8,8 12,14 15,10 20,17 v 24-gridu)
    const sc = s / 24, ox = x, oy = y;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ox + 4 * sc, oy + 17 * sc);
    ctx.lineTo(ox + 8 * sc, oy + 8 * sc);
    ctx.lineTo(ox + 12 * sc, oy + 14 * sc);
    ctx.lineTo(ox + 15 * sc, oy + 10 * sc);
    ctx.lineTo(ox + 20 * sc, oy + 17 * sc);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(ox + 4 * sc, oy + 17 * sc, s * 0.1, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  }

  function text(str, x, y, font, color, align) {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left';
    ctx.fillText(str, x, y);
  }

  const FS = '-apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawScrims();

    const s = activity?.summary || {};
    const labels = activity?.labels || {};
    const coach = activity?.coach || {};

    // hlavička: logo + TEMPO
    drawLogo(70, 80, 110);
    text('TEMPO', 205, 170, `800 74px ${FS}`, '#fff', 'left');

    // hodnocení (hvězdy) vpravo
    if (coach.rating) {
      const stars = '★'.repeat(coach.rating) + '☆'.repeat(5 - coach.rating);
      text(stars, W - 70, 165, `600 60px ${FS}`, '#C6FF4D', 'right');
    }

    // sport + datum
    const sportLine = `${labels.sportIcon || '🚴'}  ${(labels.sport || 'Aktivita').toUpperCase()}`;
    text(sportLine, 70, 1240, `800 46px ${FS}`, 'rgba(255,255,255,.9)', 'left');
    if (s.startTime) text(fmtDate(s.startTime), 70, 1300, `600 40px ${FS}`, 'rgba(255,255,255,.6)', 'left');

    // hero metrika
    const heroVal = s.distanceKm != null ? String(s.distanceKm) : (labels.duration || '–');
    const heroUnit = s.distanceKm != null ? 'km' : '';
    ctx.textAlign = 'left';
    ctx.font = `800 300px ${FS}`; ctx.fillStyle = '#fff';
    ctx.fillText(heroVal, 64, 1560);
    if (heroUnit) {
      const wv = ctx.measureText(heroVal).width;
      text(heroUnit, 64 + wv + 24, 1560, `800 90px ${FS}`, 'rgba(255,255,255,.85)', 'left');
    }

    // řádek statistik
    const cells = [];
    cells.push(['ČAS', labels.duration || '–']);
    if (s.sport === 'run' && s.pacePerKm) cells.push(['TEMPO', s.pacePerKm + ' /km']);
    else if (s.avgSpeedKmh != null) cells.push(['TEMPO', s.avgSpeedKmh + ' km/h']);
    if (s.avgHr != null) cells.push(['TEP', s.avgHr + ' bpm']);
    if (s.elevationGainM) cells.push(['STOUPÁNÍ', s.elevationGainM + ' m']);

    const cols = cells.slice(0, 3);
    const gap = (W - 140) / cols.length;
    cols.forEach((c, i) => {
      const cx = 70 + gap * i;
      text(c[0], cx, 1680, `800 30px ${FS}`, 'rgba(255,255,255,.55)', 'left');
      text(c[1], cx, 1738, `800 48px ${FS}`, '#fff', 'left');
    });

    // patička
    text('TEMPO · tréninkový parťák', W / 2, 1850, `700 38px ${FS}`, 'rgba(255,255,255,.6)', 'center');
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' });
  }

  // ---------- export / sdílení ----------
  function toBlob() {
    return new Promise((res) => canvas.toBlob(res, 'image/png', 0.95));
  }
  async function share() {
    const blob = await toBlob();
    const file = new File([blob], 'tempo-story.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'TEMPO' }); return; } catch { /* zrušeno */ return; }
    }
    download(blob);
  }
  function download(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tempo-story.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- UI ----------
  function buildUI() {
    const m = document.createElement('div');
    m.id = 'storyModal';
    m.innerHTML = `
      <div class="story-inner">
        <canvas id="storyCanvas" width="${W}" height="${H}"></canvas>
        <div class="story-bar">
          <div class="story-bgs" id="storyBgs"></div>
          <div class="story-actions">
            <button class="planbtn" id="storyShare">📤 Sdílet</button>
            <button class="again" id="storyClose">Zavřít</button>
          </div>
        </div>
      </div>
      <input type="file" id="storyPhoto" accept="image/*" hidden />`;
    document.body.appendChild(m);
    canvas = m.querySelector('#storyCanvas');
    ctx = canvas.getContext('2d');

    const bgs = m.querySelector('#storyBgs');
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'story-bg'; b.dataset.bg = p.id; b.textContent = p.name;
      b.addEventListener('click', () => { bg = p.id; markBg(); render(); });
      bgs.appendChild(b);
    });
    const photoBtn = document.createElement('button');
    photoBtn.className = 'story-bg'; photoBtn.dataset.bg = 'photo'; photoBtn.textContent = '📷 Foto';
    photoBtn.addEventListener('click', () => m.querySelector('#storyPhoto').click());
    bgs.appendChild(photoBtn);

    m.querySelector('#storyPhoto').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => { photoImg = img; bg = 'photo'; markBg(); render(); };
      img.src = URL.createObjectURL(f);
    });

    m.querySelector('#storyShare').addEventListener('click', share);
    m.querySelector('#storyClose').addEventListener('click', () => { m.classList.remove('open'); });

    function markBg() {
      bgs.querySelectorAll('.story-bg').forEach((el) => el.classList.toggle('on', el.dataset.bg === bg));
    }
    window._storyMarkBg = markBg;
    return m;
  }

  window.openStory = function (act) {
    activity = act;
    const m = document.getElementById('storyModal') || buildUI();
    bg = bg === 'photo' && photoImg ? 'photo' : 'sunset';
    if (window._storyMarkBg) window._storyMarkBg();
    m.classList.add('open');
    render();
  };
})();
