'use strict';
// Input (keyboard, mouse, touch) and the DOM HUD: stats, hotbar, crafting, maps, screens.

const $ = (id) => document.getElementById(id);

const Input = {
  keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: false, active: false }, touch: false,
  stick: { id: null, ox: 0, oy: 0, x: 0, y: 0 }, look: { id: null, x: 0, y: 0, moved: 0 }, btnA: false,

  init() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat && e.code !== 'Space') return;
      this.keys[e.code] = true;
      Sound.init();
      if (Game.state === 'title') return;
      const code = e.code;
      if (code === 'Escape') { e.preventDefault(); UI.escape(); return; }
      if (code === 'KeyC' || code === 'Tab') { e.preventDefault(); UI.toggleCraft(); return; }
      if (code === 'KeyM') { UI.toggleMap(); return; }
      if (code === 'KeyE' || code === 'KeyF') this.pressed.interact = true;
      if (code === 'KeyQ') this.pressed.drop = true;
      if (code === 'Space') e.preventDefault();
      if (/^Digit[1-8]$/.test(code)) { Game.sel = Number(code.slice(5)) - 1; UI.dirty = true; UI.showSelName(); }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    // iOS Safari only unlocks audio inside touchend or click, and pinch would zoom the page
    const unlock = () => Sound.init();
    window.addEventListener('touchend', unlock, { passive: true });
    window.addEventListener('click', unlock);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = false; this.btnA = false; this.look.id = null; });

    const cv = View.canvas;
    cv.addEventListener('pointerdown', (e) => {
      Sound.init();
      if (e.pointerType === 'touch') {
        this.setTouch(true);
        if (View.is3D && e.clientX > window.innerWidth * 0.45 && this.look.id === null) {
          this.look.id = e.pointerId; this.look.x = e.clientX; this.look.y = e.clientY;
        } else if (this.stick.id === null) {
          this.stick.id = e.pointerId; this.stick.ox = e.clientX; this.stick.oy = e.clientY; this.stick.x = 0; this.stick.y = 0;
          UI.showStick(e.clientX, e.clientY);
        }
      } else {
        this.setTouch(false);
        if (e.button === 0) this.mouse.down = true;
        if (e.button === 2) {
          if (View.is3D) { this.look.id = e.pointerId; this.look.x = e.clientX; this.look.y = e.clientY; this.look.moved = 0; }
          else this.pressed.interact = true;
        }
      }
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.active = true;
        if (this.touch) this.setTouch(false);
      }
      if (e.pointerId === this.look.id) {
        const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
        this.look.x = e.clientX; this.look.y = e.clientY; this.look.moved += Math.abs(dx) + Math.abs(dy);
        orbitCamera(dx * (e.pointerType === 'touch' ? 1.1 : 0.8), dy * (e.pointerType === 'touch' ? 1.1 : 0.8));
      }
      if (e.pointerId === this.stick.id) {
        let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
        const d = Math.hypot(dx, dy), max = 56;
        if (d > max) { this.stick.ox += dx - dx / d * max; this.stick.oy += dy - dy / d * max; dx = dx / d * max; dy = dy / d * max; }
        this.stick.x = dx / max; this.stick.y = dy / max;
        UI.moveStick(this.stick.ox, this.stick.oy, dx, dy);
      }
    });
    const end = (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouse.down = false;
      if (e.pointerId === this.look.id) {
        if (e.pointerType === 'mouse' && this.look.moved < 6) this.pressed.interact = true;
        this.look.id = null;
      }
      if (e.pointerId === this.stick.id) { this.stick.id = null; this.stick.x = 0; this.stick.y = 0; UI.hideStick(); }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    cv.addEventListener('mouseleave', () => { this.mouse.active = false; });
    cv.addEventListener('wheel', (e) => {
      if (Game.state !== 'play') return;
      Game.sel = (Game.sel + (e.deltaY > 0 ? 1 : HOTBAR - 1)) % HOTBAR; UI.dirty = true; UI.showSelName();
    }, { passive: true });

    const hold = (el, on) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); Sound.init(); this.setTouch(e.pointerType !== 'mouse' || this.touch); on(true); el.classList.add('down');
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ }
      });
      const up = () => { on(false); el.classList.remove('down'); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    };
    hold($('btnA'), (v) => { this.btnA = v; });
    hold($('btnE'), (v) => { if (v) this.pressed.interact = true; });
  },

  setTouch(v) {
    if (this.touch === v) return;
    this.touch = v;
    document.body.classList.toggle('touch', v);
  },

  move() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.KeyA || k.ArrowLeft) x -= 1;
    if (k.KeyD || k.ArrowRight) x += 1;
    if (k.KeyW || k.ArrowUp) y -= 1;
    if (k.KeyS || k.ArrowDown) y += 1;
    let v = { x: 0, y: 0 };
    if (x || y) { const d = Math.hypot(x, y); v = { x: x / d, y: y / d }; }
    else if (this.stick.id !== null && Math.hypot(this.stick.x, this.stick.y) >= 0.15) v = { x: this.stick.x, y: this.stick.y };
    if (!View.is3D || (!v.x && !v.y)) return v;
    // screen-up walks away from the camera
    const fx = Math.cos(View.yaw), fy = Math.sin(View.yaw);
    return { x: fx * -v.y + -fy * v.x, y: fy * -v.y + fx * v.x };
  },
  sprint() { return this.keys.ShiftLeft || this.keys.ShiftRight || (this.stick.id !== null && Math.hypot(this.stick.x, this.stick.y) > 0.93); },
  attackHeld() { return (this.mouse.down && !UI.overlayOpen()) || this.btnA || this.keys.Space; },
  consume(name) { const v = this.pressed[name]; this.pressed[name] = false; return v; },
  mouseWorld() {
    if (this.touch || !this.mouse.active) return null;
    return screenToWorld(this.mouse.x, this.mouse.y);
  },
};

// ------------------------------------------------------------------- HUD
const UI = {
  dirty: true, boss: null, craftOpen: false, mapOpen: false, mmTimer: 0, craftTimer: 0, selTimer: 0,
  pickupQueue: {},

  init() {
    this.bars = { hp: $('bar-hp'), food: $('bar-food'), water: $('bar-water'), warm: $('bar-warm'), stam: $('bar-stam') };
    for (const id of ['hp', 'food', 'water', 'warm', 'stamina']) {
      const el = document.querySelector('[data-glyph="' + id + '"]');
      if (el) el.src = iconURL(id);
    }
    const hb = $('hotbar');
    for (let i = 0; i < HOTBAR; i++) {
      const b = document.createElement('button');
      b.className = 'slot'; b.type = 'button'; b.id = 'slot' + i;
      b.innerHTML = '<kbd>' + (i + 1) + '</kbd><img alt=""><span class="n"></span><span class="sips"></span>';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Sound.init(); Game.sel = i; this.dirty = true; this.showSelName(); });
      hb.appendChild(b);
    }
    $('btnCraft').addEventListener('click', () => this.toggleCraft());
    $('btnMap').addEventListener('click', () => this.toggleMap());
    $('btnPause').addEventListener('click', () => this.escape());
    $('btnSound').addEventListener('click', () => { Sound.init(); const m = Sound.toggle(); $('btnSound').classList.toggle('off', m); $('btnSound').setAttribute('aria-pressed', String(m)); });
    $('btnDrop').addEventListener('click', () => { Input.pressed.drop = true; });
    $('craftClose').addEventListener('click', () => this.toggleCraft(false));
    $('bigmap').addEventListener('click', () => this.toggleMap(false));
    $('btnNew').addEventListener('click', () => { Sound.init(); startNewGame(); });
    $('btnContinue').addEventListener('click', () => { Sound.init(); continueGame(); });
    $('btnResume').addEventListener('click', () => this.escape());
    $('btnQuit').addEventListener('click', () => { saveGame(); toTitle(); });
    $('btnRespawn').addEventListener('click', () => { $('screen-dead').hidden = true; respawn(); });
    $('btnKeep').addEventListener('click', () => { $('screen-win').hidden = true; Game.state = 'play'; });
    this.mm = $('minimap').getContext('2d');
    this.buildCraft();
  },

  overlayOpen() { return this.craftOpen || this.mapOpen || Game.state !== 'play'; },

  escape() {
    if (this.craftOpen) return this.toggleCraft(false);
    if (this.mapOpen) return this.toggleMap(false);
    if (Game.state === 'play') { Game.state = 'paused'; $('screen-pause').hidden = false; saveGame(); }
    else if (Game.state === 'paused') { Game.state = 'play'; $('screen-pause').hidden = true; }
  },

  toggleCraft(v) {
    if (Game.state !== 'play' && v !== false) return;
    this.craftOpen = v === undefined ? !this.craftOpen : v;
    $('craft').hidden = !this.craftOpen;
    if (this.craftOpen) { this.toggleMap(false); this.refreshCraft(); }
  },

  toggleMap(v) {
    if (Game.state !== 'play' && v !== false) return;
    this.mapOpen = v === undefined ? !this.mapOpen : v;
    $('bigmap').hidden = !this.mapOpen;
    if (this.mapOpen) { this.toggleCraft(false); this.drawBigMap(); }
  },

  toast(text, kind) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  },

  pickupNote(id, n) {
    const q = this.pickupQueue;
    q[id] = (q[id] || 0) + n;
    clearTimeout(this.pickupT);
    this.pickupT = setTimeout(() => {
      const box = $('pickups');
      for (const k in q) {
        const el = document.createElement('div');
        el.className = 'pick';
        el.innerHTML = '<img alt="" src="' + iconURL(k) + '"><span>+' + q[k] + ' ' + ITEMS[k].name + '</span>';
        box.appendChild(el);
        setTimeout(() => el.remove(), 1800);
      }
      this.pickupQueue = {};
      while (box.children.length > 5) box.removeChild(box.firstChild);
    }, 120);
  },

  showSelName() {
    const s = Game.hotbar[Game.sel];
    const el = $('selname');
    if (!s) { el.classList.remove('on'); return; }
    const it = ITEMS[s.id];
    el.innerHTML = '<b>' + it.name + '</b>' + (it.desc ? '<span>' + it.desc + '</span>' : itemHow(it));
    el.classList.add('on');
    this.selTimer = 2.6;
  },

  showStick(x, y) { const s = $('stick'); s.hidden = false; s.style.left = x + 'px'; s.style.top = y + 'px'; $('stickKnob').style.transform = 'translate(-50%,-50%)'; },
  moveStick(ox, oy, dx, dy) { const s = $('stick'); s.style.left = ox + 'px'; s.style.top = oy + 'px'; $('stickKnob').style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))'; },
  hideStick() { $('stick').hidden = true; },

  showDeath() {
    $('deathCause').textContent = 'Taken by ' + Game.lastCause + ' on day ' + Game.day + '.';
    $('deathNote').textContent = World.structs.some((s) => s.type === 'grave') ? 'Your belongings wait in a grave where you fell. Follow the gold marker.' : '';
    $('screen-dead').hidden = false;
    this.toggleCraft(false); this.toggleMap(false);
  },

  showWin() {
    const st = Game.stats;
    $('winStats').innerHTML =
      '<div><b>' + Game.day + '</b><span>days survived</span></div>' +
      '<div><b>' + st.kills + '</b><span>creatures felled</span></div>' +
      '<div><b>' + st.crafted + '</b><span>things crafted</span></div>' +
      '<div><b>' + st.deaths + '</b><span>deaths</span></div>';
    $('screen-win').hidden = false;
    this.toggleCraft(false); this.toggleMap(false);
  },

  // ---------------------------------------------------------- crafting panel
  buildCraft() {
    const groups = [
      { key: null, title: 'Anywhere', note: 'Hands, fiber and patience.' },
      { key: 'fire', title: 'By the fire', note: 'Stand near a lit campfire or brazier.' },
      { key: 'bench', title: 'At the workbench', note: 'Stand near a workbench.' },
    ];
    const list = $('craftList');
    list.innerHTML = '';
    this.rows = [];
    for (const g of groups) {
      const sec = document.createElement('section');
      sec.innerHTML = '<h3>' + g.title + '<small></small></h3>';
      sec.dataset.station = g.key || '';
      this.rows.push({ head: sec.querySelector('small'), station: g.key, note: g.note });
      for (const r of RECIPES) {
        if ((r.station || null) !== g.key) continue;
        const it = ITEMS[r.out];
        const row = document.createElement('button');
        row.type = 'button'; row.className = 'recipe';
        let cost = '';
        for (const k in r.cost) cost += '<span class="c" data-k="' + k + '" data-n="' + r.cost[k] + '"><img alt="" src="' + iconURL(k) + '">' + r.cost[k] + '</span>';
        row.innerHTML = '<img class="ic" alt="" src="' + iconURL(r.out) + '"><span class="nm">' + it.name + (r.n > 1 ? ' <em>×' + r.n + '</em>' : '') +
          '<small>' + (it.desc || itemHow(it, true)) + '</small></span><span class="cost">' + cost + '</span>';
        row.addEventListener('click', () => { craft(r); this.refreshCraft(); });
        sec.appendChild(row);
        r.el = row;
      }
      list.appendChild(sec);
    }
  },

  refreshCraft() {
    const fire = stationNear('fire'), bench = stationNear('bench');
    for (const g of this.rows) {
      const ok = !g.station || (g.station === 'fire' ? fire : bench);
      g.head.textContent = ok ? (g.station ? 'In reach' : '') : g.note;
      g.head.className = ok ? 'ok' : '';
    }
    for (const r of RECIPES) {
      const owned = isKit(r.out) && Game.kit[r.out];
      r.el.classList.toggle('owned', !!owned);
      r.el.classList.toggle('can', canCraft(r));
      r.el.classList.toggle('locked', !!r.station && !(r.station === 'fire' ? fire : bench));
      r.el.querySelectorAll('.c').forEach((c) => c.classList.toggle('short', countOf(c.dataset.k) < Number(c.dataset.n)));
    }
  },

  // ---------------------------------------------------------- per frame
  update(dt) {
    if (Game.state === 'title') return;
    const p = Game.player;
    const b = this.bars;
    b.hp.style.width = p.hp + '%';
    b.food.style.width = p.food + '%';
    b.water.style.width = p.water + '%';
    b.warm.style.width = p.warm + '%';
    b.stam.style.width = p.stam + '%';
    $('st-hp').classList.toggle('low', p.hp < 30);
    $('st-food').classList.toggle('low', p.food < 20);
    $('st-water').classList.toggle('low', p.water < 20);
    $('st-warm').classList.toggle('low', p.warm < 25);
    const trend = p.temp === undefined ? 0 : p.temp;
    $('warmTrend').textContent = trend < -1.5 ? '▼▼' : trend < 0 ? '▼' : trend > 1 ? '▲' : '';
    $('warmTrend').className = trend < 0 ? 'cold' : 'hot';

    // clock
    const tile = TILES[tileAtPx(p.x, p.y)];
    const w = Game.weather;
    const weather = Game.finalStand ? 'The Last Night' : Game.bloodMoon && isNight() ? 'Blood Moon' : w.rain > 0.3 ? (tile.temp <= -2 ? 'Snow' : 'Rain') : isNight() ? 'Night' : 'Clear';
    const txt = 'Day ' + Game.day;
    if ($('clockDay').textContent !== txt) $('clockDay').textContent = txt;
    const sub = tile.name + ' · ' + weather;
    if ($('clockSub').textContent !== sub) $('clockSub').textContent = sub;
    this.drawDial();

    if (this.dirty) { this.refreshHotbar(); this.refreshPouch(); this.dirty = false; if (this.craftOpen) this.refreshCraft(); }
    this.craftTimer -= dt;
    if (this.craftOpen && this.craftTimer <= 0) { this.craftTimer = 0.4; this.refreshCraft(); }
    this.mmTimer -= dt;
    if (this.mmTimer <= 0) { this.mmTimer = 0.2; this.drawMinimap(); if (this.mapOpen) this.drawBigMap(); }
    this.selTimer -= dt;
    if (this.selTimer <= 0) $('selname').classList.remove('on');

    // boss bar
    const bb = $('bossbar');
    if (this.boss && !this.boss.dead && Game.state === 'play') {
      bb.hidden = false;
      $('bossName').textContent = this.boss.def.name;
      $('bossFill').style.width = clamp(this.boss.hp / this.boss.maxhp * 100, 0, 100) + '%';
    } else bb.hidden = true;
    document.body.classList.toggle('boss', !bb.hidden);
    const fs = Game.finalStand;
    const fsEl = $('stand');
    if (fs) {
      fsEl.hidden = false;
      $('standFill').style.width = (fs.t / fs.dur * 100) + '%';
      $('standBeacon').style.width = clamp(fs.beacon.hp / STRUCTS.beacon.hp * 100, 0, 100) + '%';
    } else fsEl.hidden = true;

    // touch buttons reflect what will happen
    if (Input.touch) {
      const it = selItem();
      const lab = !it ? 'Strike' : it.kind === 'food' ? 'Eat' : it.kind === 'place' ? 'Build' : it.kind === 'bow' ? 'Shoot' : it.kind === 'heal' ? 'Heal' : it.kind === 'water' ? 'Drink' : it.kind === 'armor' ? 'Wear' : 'Strike';
      if ($('btnALabel').textContent !== lab) $('btnALabel').textContent = lab;
      $('btnE').classList.toggle('ready', !!Game.hint);
      const el = $('btnELabel'), l = Game.hint ? shortHint(Game.hint) : 'Use';
      if (el.textContent !== l) el.textContent = l;
    }
  },

  drawDial() {
    const c = $('dial'), g = c.getContext('2d');
    const s = c.width;
    g.clearRect(0, 0, s, s);
    const t = Game.time;
    // sky ring: day arc gold, night arc deep blue
    g.lineWidth = s * 0.1;
    const seg = (a0, a1, col) => { g.strokeStyle = col; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, a0 * Math.PI * 2 - Math.PI / 2, a1 * Math.PI * 2 - Math.PI / 2); g.stroke(); };
    seg(0, 0.6, '#e8c86a'); seg(0.6, 0.72, '#ff8a3d'); seg(0.72, 0.93, Game.bloodMoon ? '#a0202c' : '#3a4a8a'); seg(0.93, 1, '#ff8a3d');
    const a = t * Math.PI * 2 - Math.PI / 2;
    const night = darkness(t) > 0.5;
    g.fillStyle = night ? (Game.bloodMoon ? '#ff6b6b' : '#dfe6ff') : '#fff3c4';
    g.beginPath(); g.arc(s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.4, s * 0.12, 0, Math.PI * 2); g.fill();
  },

  refreshHotbar() {
    for (let i = 0; i < HOTBAR; i++) {
      const el = $('slot' + i), s = Game.hotbar[i];
      el.classList.toggle('sel', i === Game.sel);
      const img = el.querySelector('img');
      if (s) { if (img.dataset.id !== s.id) { img.src = iconURL(s.id); img.dataset.id = s.id; } img.hidden = false; }
      else { img.hidden = true; img.dataset.id = ''; }
      el.querySelector('.n').textContent = s && s.count > 1 ? s.count : '';
      el.querySelector('.sips').textContent = s && s.id === 'waterskin' ? s.sips + '/' + s.count * ITEMS.waterskin.sips : '';
      el.title = s ? ITEMS[s.id].name : 'Empty';
      el.setAttribute('aria-label', 'Slot ' + (i + 1) + ': ' + (s ? ITEMS[s.id].name : 'empty'));
    }
    const kit = [bestTool('axe'), bestTool('pick'), bestWeaponId() && ITEMS[bestWeaponId()].kind === 'weapon' ? bestWeaponId() : null];
    const ids = [];
    for (const id in Game.kit) if (kit.includes(ITEMS[id]) || kit.includes(id)) ids.push(id);
    if (Game.armor) ids.push(Game.armor);
    const html = ids.map((id) => '<img alt="' + ITEMS[id].name + '" title="' + ITEMS[id].name + '" src="' + iconURL(id) + '">').join('');
    $('kit').innerHTML = html;
    $('kit').hidden = !html;
  },

  refreshPouch() {
    const order = ['wood', 'stone', 'fiber', 'iron', 'crystal', 'hide', 'shard'];
    let html = '';
    for (const k of order) {
      const n = Game.pouch[k] || 0;
      if (n <= 0 && k !== 'shard') continue;
      if (k === 'shard') {
        const claimed = World.shrines.filter((s) => s.claimed).length;
        html += '<span class="mat shard" title="Ancient Shards"><img alt="" src="' + iconURL('shard') + '">' + n + '<i>/3</i></span>';
        void claimed;
        continue;
      }
      html += '<span class="mat" title="' + ITEMS[k].name + '"><img alt="" src="' + iconURL(k) + '">' + n + '</span>';
    }
    $('pouch').innerHTML = html;
  },

  drawMinimap() {
    const c = $('minimap'), g = this.mm;
    const s = c.width, p = Game.player;
    const ppt = s / 110; // pixels per tile
    g.fillStyle = '#0d1a26'; g.fillRect(0, 0, s, s);
    g.imageSmoothingEnabled = false;
    const ptx = p.x / TILE, pty = p.y / TILE;
    drawMapChunks(g, ptx, pty, ppt, s, s);
    drawMapMarkers(g, ptx, pty, ppt, s, s, false);
  },

  drawBigMap() {
    const c = $('bigmapCanvas');
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = c.getContext('2d');
    g.fillStyle = '#0d1a26'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    const p = Game.player;
    const ppt = 2.2 * dpr;
    drawMapChunks(g, p.x / TILE, p.y / TILE, ppt, c.width, c.height);
    drawMapMarkers(g, p.x / TILE, p.y / TILE, ppt, c.width, c.height, true);
  },
};

function drawMapChunks(g, ptx, pty, ppt, w, h) {
  const halfX = w / 2 / ppt, halfY = h / 2 / ppt;
  const c0 = Math.floor((ptx - halfX) / CS), c1 = Math.floor((ptx + halfX) / CS);
  const r0 = Math.floor((pty - halfY) / CS), r1 = Math.floor((pty + halfY) / CS);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    const m = World.minis.get(chunkKey(cx, cy));
    if (!m) continue;
    const x = Math.floor((cx * CS - ptx) * ppt + w / 2), y = Math.floor((cy * CS - pty) * ppt + h / 2);
    const x2 = Math.floor(((cx + 1) * CS - ptx) * ppt + w / 2), y2 = Math.floor(((cy + 1) * CS - pty) * ppt + h / 2);
    g.drawImage(m, x, y, x2 - x, y2 - y);
  }
}

function drawMapMarkers(g, ptx, pty, ppt, w, h, big) {
  const toS = (x, y) => [(x / TILE - ptx) * ppt + w / 2, (y / TILE - pty) * ppt + h / 2];
  const k = big ? 1.6 : 1;
  for (const s of World.structs) {
    const [x, y] = toS(s.x, s.y);
    if (x < -5 || y < -5 || x > w + 5 || y > h + 5) continue;
    if (s.type === 'campfire' || s.type === 'brazier') { g.fillStyle = s.lit ? '#ff9a3d' : '#7a6a5a'; g.fillRect(x - 2 * k, y - 2 * k, 4 * k, 4 * k); }
    else if (s.type === 'bed') { g.fillStyle = '#efe6d6'; g.fillRect(x - 2 * k, y - 2 * k, 4 * k, 4 * k); }
    else if (s.type === 'beacon') { g.fillStyle = '#b48cff'; g.fillRect(x - 3 * k, y - 3 * k, 6 * k, 6 * k); }
    else if (s.type === 'grave') { g.fillStyle = '#ffe9a8'; g.fillRect(x - 1 * k, y - 4 * k, 2 * k, 8 * k); g.fillRect(x - 3 * k, y - 2 * k, 6 * k, 2 * k); }
    else if (big && s.type === 'wall') { g.fillStyle = '#8a6239'; g.fillRect(x - 1, y - 1, 2, 2); }
  }
  for (const sh of World.shrines) {
    if (!sh.seen && !sh.claimed) continue;
    let [x, y] = toS(sh.x, sh.y);
    const off = x < 4 || y < 4 || x > w - 4 || y > h - 4;
    x = clamp(x, 5, w - 5); y = clamp(y, 5, h - 5);
    g.fillStyle = sh.claimed ? '#77736b' : '#b48cff';
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
    const z = (off ? 3 : 4) * k;
    g.fillRect(-z, -z, z * 2, z * 2);
    g.restore();
  }
  // player arrow
  const p = Game.player;
  g.save(); g.translate(w / 2, h / 2); g.rotate(p.face);
  g.fillStyle = '#ffffff'; g.strokeStyle = '#0d1a26'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(6 * k, 0); g.lineTo(-4 * k, -4 * k); g.lineTo(-2 * k, 0); g.lineTo(-4 * k, 4 * k); g.closePath(); g.stroke(); g.fill();
  g.restore();
}

function itemHow(it, plain) {
  const map = {
    food: 'Eat to restore hunger' + (it.water ? ' and thirst' : '') + '.',
    heal: 'Heals ' + it.hp + ' health.',
    water: 'Drink anywhere. Refill at water.',
    tool: (it.tool === 'axe' ? 'Fells trees faster. Always in your kit.' : 'Breaks rock' + (it.tier > 1 ? ', iron and moon crystal.' : ' and iron ore.') + ' Always in your kit.'),
    weapon: 'Deals ' + it.dmg + ' damage. Always in your kit.',
    ammo: 'Ammunition for the bow.',
    armor: 'Wear it.',
    place: 'Place it in the world.',
  };
  const t = map[it.kind] || '';
  return plain ? t : '<span>' + t + '</span>';
}

function shortHint(h) {
  return { pick: 'Pick', water: 'Drink', fuel: 'Fuel', bed: 'Rest', beacon: 'Ignite', grave: 'Loot' }[h.kind] || 'Use';
}
