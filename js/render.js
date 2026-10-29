'use strict';
// Drawing: terrain chunks, y-sorted world, creatures, lighting, weather and in-world UI.

const View = { canvas: null, ctx: null, W: 0, H: 0, dpr: 1, zoom: 1, scale: 1, light: null, lctx: null, drops: [], clock: 0 };
const LIGHT_DIV = 4;
const icons = {};

function iconImg(id) {
  if (!icons[id]) { const im = new Image(); im.src = iconURL(id); icons[id] = im; }
  return icons[id];
}

function initView(canvas) {
  View.canvas = canvas;
  View.ctx = canvas.getContext('2d');
  View.light = makeCanvas(4, 4);
  View.lctx = View.light.getContext('2d');
  resizeView();
  window.addEventListener('resize', resizeView);
}

function resizeView() {
  const w = window.innerWidth, h = window.innerHeight;
  View.dpr = Math.min(2, window.devicePixelRatio || 1);
  View.canvas.width = Math.round(w * View.dpr);
  View.canvas.height = Math.round(h * View.dpr);
  View.canvas.style.width = w + 'px';
  View.canvas.style.height = h + 'px';
  View.W = View.canvas.width; View.H = View.canvas.height;
  View.zoom = clamp(Math.min(w, h) / (13 * TILE), 0.85, 2);
  View.scale = View.zoom * View.dpr;
  View.light.width = Math.ceil(View.W / LIGHT_DIV);
  View.light.height = Math.ceil(View.H / LIGHT_DIV);
}

function screenToWorld(sx, sy) {
  return { x: (sx * View.dpr - View.W / 2) / View.scale + Game.cam.x, y: (sy * View.dpr - View.H / 2) / View.scale + Game.cam.y };
}

function render(dt) {
  const ctx = View.ctx, S = View.scale, W = View.W, H = View.H;
  View.clock += dt;
  const p = Game.player;

  // camera
  if (Game.state === 'title') { Game.cam.x += dt * 26; Game.cam.y += Math.sin(View.clock * 0.1) * dt * 10; }
  else {
    const lead = 0.12;
    Game.cam.x = lerp(Game.cam.x, p.x + p.vx * lead, Math.min(1, dt * 6));
    Game.cam.y = lerp(Game.cam.y, p.y + p.vy * lead, Math.min(1, dt * 6));
  }
  let cx = Game.cam.x, cy = Game.cam.y;
  if (Game.shake > 0.2) { cx += (Math.random() - 0.5) * Game.shake; cy += (Math.random() - 0.5) * Game.shake; }
  cx = Math.round(cx * S) / S; cy = Math.round(cy * S) / S;
  View.cx = cx; View.cy = cy;
  const halfW = W / 2 / S, halfH = H / 2 / S;
  const x0 = cx - halfW, y0 = cy - halfH, x1 = cx + halfW, y1 = cy + halfH;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1d4e7a';
  ctx.fillRect(0, 0, W, H);

  // ---- ground chunks
  const ccx0 = Math.floor(x0 / CHUNK_PX), ccy0 = Math.floor(y0 / CHUNK_PX);
  const ccx1 = Math.floor(x1 / CHUNK_PX), ccy1 = Math.floor(y1 / CHUNK_PX);
  let budget = Game.state === 'title' ? 3 : 2;
  for (let gy = ccy0 - 1; gy <= ccy1 + 1; gy++) for (let gx = ccx0 - 1; gx <= ccx1 + 1; gx++) {
    const ch = getChunk(gx, gy);
    ch.used = View.clock;
    const visible = gx >= ccx0 && gx <= ccx1 && gy >= ccy0 && gy <= ccy1;
    if (!ch.canvas && (visible || budget > 0)) { if (!visible) budget--; renderChunk(ch); }
    if (!visible || !ch.canvas) continue;
    const sx = Math.round((gx * CHUNK_PX - cx) * S + W / 2), sy = Math.round((gy * CHUNK_PX - cy) * S + H / 2);
    const ex = Math.round(((gx + 1) * CHUNK_PX - cx) * S + W / 2), ey = Math.round(((gy + 1) * CHUNK_PX - cy) * S + H / 2);
    ctx.drawImage(ch.canvas, sx, sy, ex - sx, ey - sy);
  }
  evictChunks(cx, cy);

  ctx.setTransform(S, 0, 0, S, W / 2 - cx * S, H / 2 - cy * S);
  ctx.imageSmoothingEnabled = true;

  // ---- animated water glints
  const t = View.clock;
  ctx.fillStyle = 'rgba(210,240,255,0.22)';
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
    const tt = tileAt(tx, ty);
    if (tt !== T.WATER && tt !== T.DEEP) continue;
    const h = hash2(tx, ty, 77);
    const ph = Math.sin(t * 1.6 + h * 20 + tx * 0.4);
    if (ph > 0.55) ctx.fillRect(tx * TILE + h * 18, ty * TILE + 6 + ((h * 97) % 1) * 18 + ph * 2, 8 + ph * 6, 1.5);
  }

  // ---- gather drawables
  const list = [];
  const lights = [];
  Game.glows = [];
  const night = darkness(Game.time);
  const pad = 90;
  eachObjIn(x0 - pad, y0 - pad, x1 + pad, y1 + pad * 1.5, (o) => {
    list.push({ y: o.y, k: 0, r: o });
    if (night > 0.05) {
      if (o.type === 'mushroom') lights.push({ x: o.x, y: o.y - 6, r: 46, i: 0.75 });
      if (o.type === 'crystal') lights.push({ x: o.x, y: o.y - 18, r: 70, i: 0.8 });
    }
  });
  eachStructIn(x0 - pad, y0 - pad, x1 + pad, y1 + pad * 1.5, (s) => list.push({ y: STRUCTS[s.type].flat ? s.y - 40 : s.y, k: 1, r: s }));
  for (const m of Game.mobs) if (m.x > x0 - 80 && m.x < x1 + 80 && m.y > y0 - 80 && m.y < y1 + 120) list.push({ y: m.y, k: 2, r: m });
  for (const k of Game.pickups) if (k.x > x0 - 20 && k.x < x1 + 20 && k.y > y0 - 20 && k.y < y1 + 20) list.push({ y: k.y, k: 3, r: k });
  for (const sh of World.shrines) {
    if (Math.abs(sh.x - cx) > halfW + 200 || Math.abs(sh.y - cy) > halfH + 200) continue;
    list.push({ y: sh.y, k: 4, r: sh });
    for (const pl of shrinePillars(sh)) list.push({ y: pl.y, k: 5, r: pl });
    if (!sh.claimed) lights.push({ x: sh.x, y: sh.y - 40, r: 170, i: 0.9, flick: 0.05 });
  }
  if (Game.state !== 'title' && !p.dead) list.push({ y: p.y, k: 6, r: p });
  list.sort((a, b) => a.y - b.y);

  for (const e of list) {
    switch (e.k) {
      case 0: drawObject(ctx, e.r, dt, p); break;
      case 1: drawStruct(ctx, e.r, lights, night); break;
      case 2: drawMob(ctx, e.r, night); break;
      case 3: drawPickup(ctx, e.r); break;
      case 4: drawAltar(ctx, e.r); break;
      case 5: drawSprite(ctx, Sprites.pillar[e.r.v], e.r.x, e.r.y); break;
      case 6: drawPlayer(ctx, e.r); break;
    }
  }

  // ---- projectiles
  for (const pr of Game.projectiles) {
    if (pr.kind === 'arrow') {
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
      ctx.fillStyle = '#9a7448'; ctx.fillRect(-12, -1, 16, 2);
      ctx.fillStyle = '#d9d0bf'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(2, -3); ctx.lineTo(2, 3); ctx.fill();
      ctx.fillStyle = '#e8e2cf'; ctx.fillRect(-13, -3, 4, 6);
      ctx.restore();
    } else if (pr.kind === 'boulder') {
      ellipse(ctx, pr.x, pr.y + 18, 8, 3, 'rgba(0,0,0,0.3)');
      circle(ctx, pr.x, pr.y, 9, '#8d8a84'); circle(ctx, pr.x - 3, pr.y - 3, 3, '#bdb9b0');
    } else if (pr.kind === 'wisp') {
      circle(ctx, pr.x, pr.y, 7, 'rgba(120,90,200,0.6)'); circle(ctx, pr.x, pr.y, 3.5, '#e2d6ff');
      lights.push({ x: pr.x, y: pr.y, r: 50, i: 0.6 });
    }
  }

  // ---- particles
  for (const q of Game.particles) {
    const a = clamp(q.life / q.max, 0, 1);
    if (q.ring) {
      ctx.strokeStyle = 'rgba(217,208,191,' + a + ')'; ctx.lineWidth = 4 * a + 1;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, q.size * (1.1 - a), q.size * 0.6 * (1.1 - a), 0, 0, Math.PI * 2); ctx.stroke();
      continue;
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;

  // ---- build ghost
  if (Game.ghost && Game.state === 'play') {
    const g = Game.ghost, it = selItem();
    ctx.globalAlpha = 0.55;
    const spr = Sprites[it.struct];
    if (spr) drawSprite(ctx, spr, g.x, g.y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = g.ok ? 'rgba(140,255,160,0.9)' : 'rgba(255,90,90,0.9)';
    ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.strokeRect(g.tx * TILE + 1, g.ty * TILE + 1, TILE - 2, TILE - 2);
    ctx.setLineDash([]);
  }

  // ---- weather
  drawWeather(ctx, dt, x0, y0, x1, y1, p);

  // ---- lighting
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dusk = Game.time > 0.52 && Game.time < 0.72 ? Math.sin((Game.time - 0.52) / 0.2 * Math.PI) : Game.time > 0.9 ? Math.sin((Game.time - 0.9) / 0.1 * Math.PI) * 0.6 : 0;
  if (dusk > 0.01) { ctx.fillStyle = 'rgba(255,110,50,' + (dusk * 0.14) + ')'; ctx.fillRect(0, 0, W, H); }
  if (Game.state !== 'title' && !p.dead) {
    const held = selItem();
    const torch = held && held.kind === 'torch';
    lights.push({ x: p.x, y: p.y - 10, r: torch ? 175 : 72, i: 1, flick: torch ? 0.08 : 0, warm: torch ? 'rgba(255,150,60,A)' : null });
  }
  const dim = Math.max(night * 0.9, Game.weather.rain * 0.28) * (1 - Game.weather.flash * 0.8);
  if (dim > 0.02) {
    const L = View.lctx, LW = View.light.width, LH = View.light.height;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, LW, LH);
    L.fillStyle = Game.bloodMoon && night > 0.3 ? 'rgba(46,4,10,' + dim + ')' : 'rgba(5,9,26,' + dim + ')';
    L.fillRect(0, 0, LW, LH);
    L.globalCompositeOperation = 'destination-out';
    const ls = S / LIGHT_DIV;
    for (const l of lights) {
      const sx = ((l.x - cx) * S + W / 2) / LIGHT_DIV, sy = ((l.y - cy) * S + H / 2) / LIGHT_DIV;
      const r = l.r * ls * (1 + (l.flick ? (Math.sin(t * 17 + l.x) * 0.5 + Math.sin(t * 7.3 + l.y)) * l.flick : 0));
      if (sx < -r || sy < -r || sx > LW + r || sy > LH + r) continue;
      const g = L.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, 'rgba(0,0,0,' + l.i + ')');
      g.addColorStop(0.55, 'rgba(0,0,0,' + l.i * 0.6 + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = g;
      L.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(View.light, 0, 0, W, H);
    // warm bloom around fires
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.warm) continue;
      if (l.warm.indexOf('A') < 0) continue;
      const sx = (l.x - cx) * S + W / 2, sy = (l.y - cy) * S + H / 2, r = l.r * S * 0.55;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, l.warm.replace('A', String(0.32 * night + 0.06)));
      g.addColorStop(1, l.warm.replace('A', '0'));
      ctx.fillStyle = g;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  if (Game.weather.flash > 0.01) { ctx.fillStyle = 'rgba(220,230,255,' + Game.weather.flash * 0.35 + ')'; ctx.fillRect(0, 0, W, H); }

  // ---- glows that pierce the dark
  ctx.setTransform(S, 0, 0, S, W / 2 - cx * S, H / 2 - cy * S);
  ctx.globalCompositeOperation = 'lighter';
  for (const g of Game.glows) circle(ctx, g.x, g.y, g.r, g.c);
  ctx.globalCompositeOperation = 'source-over';

  // ---- floating text
  ctx.textAlign = 'center';
  ctx.font = '700 11px "Alegreya Sans", system-ui, sans-serif';
  for (const tx of Game.texts) {
    ctx.globalAlpha = clamp(tx.life * 1.5, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(tx.text, tx.x + 1, tx.y + 1);
    ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y);
  }
  ctx.globalAlpha = 1;

  if (Game.state === 'play' && !p.dead) {
    // hurt health bars
    for (const m of Game.mobs) {
      if (m.hp >= m.maxhp || m.def.behav === 'boss') continue;
      const w = Math.max(20, m.r * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(m.x - w / 2, m.y - m.r - 22, w, 4);
      ctx.fillStyle = m.def.behav === 'flee' ? '#9be35b' : '#e5484d'; ctx.fillRect(m.x - w / 2, m.y - m.r - 22, w * clamp(m.hp / m.maxhp, 0, 1), 4);
    }
    drawHint(ctx, p);
    drawCompass(ctx, p, cx, cy, halfW, halfH);
  }

  // vignette for low health or cold
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (Game.state === 'play' && p && !p.dead) {
    const danger = Math.max(p.hp < 30 ? (30 - p.hp) / 30 : 0, p.hurt > 0 ? p.hurt * 1.5 : 0);
    const cold = p.warm < 30 ? (30 - p.warm) / 30 : 0;
    if (danger > 0.01) vignette(ctx, W, H, 'rgba(160,0,10,' + Math.min(0.6, danger * 0.6) + ')');
    if (cold > 0.01) vignette(ctx, W, H, 'rgba(170,220,255,' + cold * 0.45 + ')');
  }
  if (Game.sleepFade > 0) {
    const a = Game.sleepFade > 0.8 ? (1.6 - Game.sleepFade) / 0.8 : Game.sleepFade / 0.8;
    ctx.fillStyle = 'rgba(0,0,0,' + clamp(a, 0, 1) + ')'; ctx.fillRect(0, 0, W, H);
  }
}

function vignette(ctx, W, H, col) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function evictChunks(cx, cy) {
  if (World.canvasCount > 60) {
    for (const ch of World.chunks.values()) {
      if (!ch.canvas) continue;
      const d = Math.max(Math.abs(ch.cx * CHUNK_PX + CHUNK_PX / 2 - cx), Math.abs(ch.cy * CHUNK_PX + CHUNK_PX / 2 - cy)) / CHUNK_PX;
      if (d > 3.5) { ch.canvas = null; World.canvasCount--; }
    }
  }
  if (World.chunks.size > 600) {
    for (const [k, ch] of World.chunks) {
      const d = Math.max(Math.abs(ch.cx * CHUNK_PX - cx), Math.abs(ch.cy * CHUNK_PX - cy)) / CHUNK_PX;
      if (d > 10) { if (ch.canvas) World.canvasCount--; World.chunks.delete(k); }
    }
  }
}

// ---------------------------------------------------------------- world pieces
const TALL = { tree: 1, pine: 1, palm: 1, deadtree: 1, cactus: 1 };

function drawObject(ctx, o, dt, p) {
  const spr = Sprites[o.type][o.v];
  let x = o.x;
  if (o.shake > 0) { x += Math.sin(View.clock * 70) * 2.2 * o.shake; o.shake = Math.max(0, o.shake - dt * 4); }
  let alpha = 1;
  if (TALL[o.type] && p && Game.state !== 'title' && p.y < o.y - 4 && p.y > o.y - spr.ay + 4 && Math.abs(p.x - o.x) < spr.w * 0.42) alpha = 0.45;
  if (o.type === 'tree' || o.type === 'pine' || o.type === 'palm') {
    // gentle sway: draw trunk straight, lean the whole sprite a touch
    const sway = Math.sin(View.clock * 1.3 + o.x * 0.05) * 0.018 * (1 + Game.weather.rain * 2);
    ctx.save(); ctx.translate(x, o.y); ctx.transform(1, 0, sway, 1, 0, 0);
    drawSprite(ctx, spr, 0, 0, alpha);
    ctx.restore();
  } else drawSprite(ctx, spr, x, o.y, alpha);
  if (o.type === 'mushroom' && darkness(Game.time) > 0.3) Game.glows.push({ x: o.x, y: o.y - 6, r: 6, c: 'rgba(80,220,220,0.35)' });
  if (o.type === 'crystal' && darkness(Game.time) > 0.3) Game.glows.push({ x: o.x, y: o.y - 20, r: 9, c: 'rgba(120,220,255,0.3)' });
}

function drawFlame(ctx, x, y, s) {
  const t = View.clock;
  for (let i = 0; i < 3; i++) {
    const f = Math.sin(t * 13 + i * 2.1) * 0.15 + 1;
    const ox = Math.sin(t * 9 + i) * 2 * s;
    ctx.fillStyle = ['rgba(255,90,30,0.9)', 'rgba(255,160,40,0.95)', 'rgba(255,235,140,1)'][i];
    const w = (8 - i * 2.4) * s, h = (18 - i * 5) * s * f;
    ctx.beginPath();
    ctx.moveTo(x - w + ox * 0.3, y);
    ctx.quadraticCurveTo(x - w * 0.8, y - h * 0.6, x + ox, y - h);
    ctx.quadraticCurveTo(x + w * 0.8, y - h * 0.6, x + w + ox * 0.3, y);
    ctx.closePath(); ctx.fill();
  }
  if (Math.random() < 0.15) Game.particles.push({ x: x + rand(-4, 4), y: y - 10 * s, vx: rand(-15, 15), vy: rand(-60, -30), life: 0.9, max: 0.9, size: 1.6, color: '#ffb347', grav: -20 });
}

function drawStruct(ctx, s, lights, night) {
  const def = STRUCTS[s.type];
  if (s.type === 'campfire') {
    drawSprite(ctx, Sprites.campfire, s.x, s.y);
    if (s.lit) {
      const k = clamp(s.fuel / 60, 0.45, 1);
      drawFlame(ctx, s.x, s.y + 1, k);
      lights.push({ x: s.x, y: s.y - 8, r: def.light * (0.6 + k * 0.4) * 0.75, i: 1, flick: 0.06, warm: 'rgba(255,140,50,A)' });
    } else {
      if (Math.random() < 0.03) Game.particles.push({ x: s.x, y: s.y - 4, vx: rand(-5, 5), vy: -20, life: 1.6, max: 1.6, size: 3, color: 'rgba(140,140,140,0.5)', grav: -5 });
    }
  } else if (s.type === 'brazier') {
    drawSprite(ctx, Sprites.brazier, s.x, s.y);
    drawFlame(ctx, s.x, s.y - 24, 0.9);
    lights.push({ x: s.x, y: s.y - 28, r: def.light * 0.75, i: 1, flick: 0.05, warm: 'rgba(255,140,50,A)' });
  } else if (s.type === 'beacon') {
    if (s.lit) {
      const g = ctx.createLinearGradient(0, s.y - 900, 0, s.y - 70);
      g.addColorStop(0, 'rgba(190,150,255,0)'); g.addColorStop(1, 'rgba(210,180,255,0.55)');
      ctx.fillStyle = g;
      const w = 14 + Math.sin(View.clock * 4) * 3;
      ctx.fillRect(s.x - w / 2, s.y - 900, w, 830);
      lights.push({ x: s.x, y: s.y - 60, r: 280, i: 1, flick: 0.04, warm: 'rgba(170,120,255,A)' });
      Game.glows.push({ x: s.x, y: s.y - 72, r: 7 + Math.sin(View.clock * 6), c: 'rgba(200,170,255,0.45)' });
    } else lights.push({ x: s.x, y: s.y - 60, r: def.light, i: 0.6 });
    drawSprite(ctx, Sprites.beacon, s.x, s.y);
  } else {
    drawSprite(ctx, Sprites[s.type], s.x, s.y);
    if (s.type === 'grave') Game.glows.push({ x: s.x, y: s.y - 24, r: 4, c: 'rgba(255,230,150,' + (0.4 + Math.sin(View.clock * 3) * 0.2) + ')' });
  }
  if (s.hurt > 0) { ctx.globalAlpha = 0.45; circle(ctx, s.x, s.y - 12, 18, '#ffffff'); ctx.globalAlpha = 1; }
  if (s.hp < def.hp && def.hp < 9999) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(s.x - 12, s.y + 8, 24, 3);
    ctx.fillStyle = '#e0a040'; ctx.fillRect(s.x - 12, s.y + 8, 24 * clamp(s.hp / def.hp, 0, 1), 3);
  }
}

function drawAltar(ctx, sh) {
  drawSprite(ctx, Sprites.altar, sh.x, sh.y);
  if (!sh.claimed) {
    const b = Math.sin(View.clock * 2) * 4;
    ctx.save(); ctx.translate(sh.x, sh.y - 44 + b);
    ctx.rotate(Math.sin(View.clock) * 0.2);
    ctx.drawImage(iconImg('shard'), -12, -12, 24, 24);
    ctx.restore();
    Game.glows.push({ x: sh.x, y: sh.y - 44 + b, r: 16, c: 'rgba(160,120,255,0.35)' });
    if (Math.random() < 0.2) Game.particles.push({ x: sh.x + rand(-20, 20), y: sh.y - 20, vx: 0, vy: -30, life: 1.2, max: 1.2, size: 2, color: '#b48cff', grav: -10 });
  }
}

function drawPickup(ctx, k) {
  const im = iconImg(k.id);
  const bob = k.z > 0 ? k.z : Math.sin(View.clock * 4 + k.x) * 1.5 + 1.5;
  ellipse(ctx, k.x, k.y + 4, 6, 2.2, 'rgba(0,0,0,0.25)');
  if (k.t > 140 && Math.floor(View.clock * 6) % 2) return;
  ctx.drawImage(im, k.x - 8, k.y - 12 - bob, 16, 16);
}

// ---------------------------------------------------------------- player
function drawPlayer(ctx, p) {
  const bob = p.moving ? Math.abs(Math.sin(p.walk)) * 1.5 : Math.sin(View.clock * 2) * 0.4;
  const step = p.moving ? Math.sin(p.walk) * 3 : 0;
  const fx = Math.cos(p.face), fy = Math.sin(p.face);
  if (p.inv > 0 && p.hurt <= 0 && Math.floor(View.clock * 12) % 2) ctx.globalAlpha = 0.55;
  ellipse(ctx, p.x, p.y + 2, 10, 4, 'rgba(0,0,0,0.3)');
  // legs
  ctx.fillStyle = '#3b2f2a';
  ctx.fillRect(p.x - 5, p.y - 6 + step * 0.5, 4, 8 - step * 0.3);
  ctx.fillRect(p.x + 1, p.y - 6 - step * 0.5, 4, 8 + step * 0.3);
  const armor = Game.armor;
  const body = armor === 'hide_armor' ? '#9a6b42' : armor === 'iron_armor' ? '#8f98a3' : '#3f6f8a';
  const behind = fy < -0.3;
  const item = Game.state === 'play' ? (Game.hotbar[Game.sel] || (bestWeaponId() && { id: bestWeaponId() })) : null;
  const drawHeld = () => {
    if (!item) return;
    let a = p.face + 0.6;
    if (p.swing > 0) a = p.face - 1.3 + (1 - p.swing) * 2.6;
    const hx = p.x + Math.cos(a) * 11, hy = p.y - 12 - bob + Math.sin(a) * 8;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(a + Math.PI / 4);
    ctx.drawImage(iconImg(item.id), -2, -16, 18, 18);
    if (item.id === 'torch') {
      const m = ctx.getTransform(), inv = View.scale;
      const fx2 = 9.8, fy2 = -11.5;
      const wx = (m.a * fx2 + m.c * fy2 + m.e - View.W / 2) / inv + View.cx;
      const wy = (m.b * fx2 + m.d * fy2 + m.f - View.H / 2) / inv + View.cy;
      Game.glows.push({ x: wx, y: wy, r: 3 + Math.random(), c: 'rgba(255,190,90,0.55)' });
      if (Math.random() < 0.2) Game.particles.push({ x: wx, y: wy, vx: rand(-8, 8), vy: rand(-40, -20), life: 0.6, max: 0.6, size: 1.5, color: '#ffb347', grav: -10 });
    }
    ctx.restore();
    circle(ctx, hx, hy, 2.8, '#e8b98f');
  };
  if (behind) drawHeld();
  circle(ctx, p.x, p.y - 12 - bob, 8.5, shade(body, -0.25));
  ellipse(ctx, p.x, p.y - 13 - bob, 7.5, 7, body);
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(p.x - 7, p.y - 9 - bob, 14, 2);
  // head
  const hx = p.x + fx * 1.5, hy = p.y - 24 - bob;
  circle(ctx, hx, hy, 6.5, '#e8b98f');
  ctx.fillStyle = '#4a2f1d';
  ctx.beginPath(); ctx.arc(hx, hy - 1, 6.8, Math.PI * 1.05 + (behind ? -0.6 : 0), Math.PI * 1.95 + (behind ? 0.6 : 0)); ctx.fill();
  if (behind) circle(ctx, hx, hy, 5.5, '#4a2f1d');
  else {
    ctx.fillStyle = '#2a1d16';
    ctx.fillRect(hx + fx * 2.5 - 2.6, hy + 0.5, 1.6, 1.8);
    ctx.fillRect(hx + fx * 2.5 + 1.2, hy + 0.5, 1.6, 1.8);
  }
  if (!behind) drawHeld();
  if (p.hurt > 0) { ctx.globalAlpha = clamp(p.hurt * 2.5, 0, 0.7); circle(ctx, p.x, p.y - 16, 13, '#ff3b3b'); }
  ctx.globalAlpha = 1;
  if (p.swing > 0.05) {
    ctx.strokeStyle = 'rgba(255,255,255,' + p.swing * 0.5 + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y - 12, 30, p.face - 1.1, p.face - 1.1 + (1 - p.swing) * 2.2); ctx.stroke();
  }
}

// ---------------------------------------------------------------- creatures
function drawMob(ctx, m, night) {
  const t = m.anim;
  const moving = Math.hypot(m.vx, m.vy) > 10;
  ctx.save();
  ctx.translate(m.x, m.y);
  const lunge = (m.lunge || 0) * 20;
  switch (m.type) {
    case 'rabbit': {
      const hop = moving ? Math.abs(Math.sin(t * 14)) * 5 : 0;
      ellipse(ctx, 0, 2, 7, 2.5, 'rgba(0,0,0,0.25)');
      ctx.scale(m.face, 1);
      ellipse(ctx, 0, -5 - hop, 7, 5.5, '#a89580');
      circle(ctx, 5, -9 - hop, 4, '#b8a690');
      ellipse(ctx, 4, -16 - hop, 1.6, 5, '#a89580'); ellipse(ctx, 6.5, -15 - hop, 1.6, 5, '#b8a690');
      circle(ctx, -7, -5 - hop, 2.5, '#f2ead8');
      circle(ctx, 7, -10 - hop, 0.9, '#1a1a1a');
      break;
    }
    case 'deer': {
      const leg = moving ? Math.sin(t * 12) * 4 : 0;
      ellipse(ctx, 0, 2, 13, 4, 'rgba(0,0,0,0.25)');
      ctx.scale(m.face, 1);
      ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(-8 + leg, 1); ctx.moveTo(-5, -8); ctx.lineTo(-5 - leg, 1); ctx.moveTo(6, -8); ctx.lineTo(6 - leg, 1); ctx.moveTo(9, -8); ctx.lineTo(9 + leg, 1); ctx.stroke();
      ellipse(ctx, 0, -12, 12, 6, '#a0703f');
      ellipse(ctx, 0, -10, 9, 3, '#c9a577');
      ctx.fillStyle = '#a0703f'; ctx.beginPath(); ctx.moveTo(8, -14); ctx.lineTo(14, -24); ctx.lineTo(17, -21); ctx.lineTo(12, -11); ctx.fill();
      ellipse(ctx, 16, -24, 4.5, 3, '#a0703f');
      circle(ctx, 17, -25, 0.9, '#111');
      ctx.strokeStyle = '#d9c9a8'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(14, -27); ctx.lineTo(12, -34); ctx.lineTo(9, -36); ctx.moveTo(12, -32); ctx.lineTo(15, -36); ctx.stroke();
      circle(ctx, -12, -13, 2.4, '#f2ead8');
      break;
    }
    case 'boar': {
      const leg = moving ? Math.sin(t * 14) * 3 : 0;
      ellipse(ctx, 0, 2, 13, 4, 'rgba(0,0,0,0.3)');
      ctx.scale(m.face, 1); ctx.translate(lunge * 0.5, 0);
      ctx.fillStyle = '#3b2a20'; ctx.fillRect(-8 + leg, -5, 3, 6); ctx.fillRect(5 - leg, -5, 3, 6);
      ellipse(ctx, 0, -9, 12, 7.5, '#5e4434');
      ctx.fillStyle = '#3b2a20'; for (let i = -6; i < 6; i += 3) ctx.fillRect(i, -17, 2, 3);
      ellipse(ctx, 11, -8, 5.5, 4.5, '#6d5040');
      ellipse(ctx, 15, -7, 2.5, 2, '#c58a7a');
      ctx.fillStyle = '#efe6d6'; ctx.beginPath(); ctx.moveTo(13, -5); ctx.lineTo(16, -11); ctx.lineTo(14, -5); ctx.fill();
      circle(ctx, 11, -11, 1, m.aggro ? '#ff4040' : '#111');
      break;
    }
    case 'wolf': {
      const leg = moving ? Math.sin(t * 15) * 4 : 0;
      ellipse(ctx, 0, 2, 13, 4, 'rgba(0,0,0,0.3)');
      ctx.scale(m.face, 1); ctx.translate(lunge, 0);
      ctx.strokeStyle = '#4b4f55'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(-8, -7); ctx.lineTo(-8 + leg, 1); ctx.moveTo(-4, -7); ctx.lineTo(-4 - leg, 1); ctx.moveTo(6, -7); ctx.lineTo(6 - leg, 1); ctx.moveTo(9, -7); ctx.lineTo(9 + leg, 1); ctx.stroke();
      ctx.fillStyle = '#6e737a'; ctx.beginPath(); ctx.moveTo(-11, -12); ctx.quadraticCurveTo(-22, -16, -20, -6); ctx.quadraticCurveTo(-16, -10, -11, -9); ctx.fill();
      ellipse(ctx, 0, -11, 12, 5.5, '#80858c');
      ellipse(ctx, 0, -9, 9, 2.5, '#a2a6ab');
      ellipse(ctx, 12, -15, 5.5, 4.5, '#80858c');
      ctx.fillStyle = '#80858c'; ctx.beginPath(); ctx.moveTo(15, -15); ctx.lineTo(21, -13); ctx.lineTo(15, -11); ctx.fill();
      ctx.fillStyle = '#5c6066'; ctx.beginPath(); ctx.moveTo(9, -18); ctx.lineTo(10, -24); ctx.lineTo(13, -19); ctx.fill();
      circle(ctx, 14, -16, 1.1, '#ffd34d');
      if (night > 0.3 || m.aggro) Game.glows.push({ x: m.x + 14 * m.face, y: m.y - 16, r: 2.4, c: 'rgba(255,210,80,0.9)' });
      break;
    }
    case 'bear': {
      const leg = moving ? Math.sin(t * 9) * 3 : 0;
      ellipse(ctx, 0, 3, 19, 6, 'rgba(0,0,0,0.3)');
      ctx.scale(m.face, 1); ctx.translate(lunge * 0.6, 0);
      ctx.fillStyle = '#3d2a1c'; ctx.fillRect(-12 + leg, -6, 6, 8); ctx.fillRect(7 - leg, -6, 6, 8);
      ellipse(ctx, 0, -14, 18, 11, '#5a3e28');
      ellipse(ctx, -2, -18, 12, 6, '#6b4a31');
      circle(ctx, 16, -18, 8, '#5a3e28');
      circle(ctx, 13, -25, 3, '#5a3e28');
      ellipse(ctx, 22, -16, 4, 3, '#8a6a4c');
      circle(ctx, 24.5, -17, 1.4, '#111');
      circle(ctx, 18, -20, 1.2, m.aggro ? '#ff5030' : '#111');
      break;
    }
    case 'scorpion': {
      const leg = moving ? Math.sin(t * 20) * 2 : 0;
      ellipse(ctx, 0, 2, 12, 4, 'rgba(0,0,0,0.25)');
      ctx.scale(m.face, 1); ctx.translate(lunge * 0.6, 0);
      ctx.strokeStyle = '#7a5a2c'; ctx.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 4, -5); ctx.lineTo(i * 4 - 3, 1 + leg * (i % 2 ? 1 : -1)); ctx.moveTo(i * 4, -5); ctx.lineTo(i * 4 + 3, 1 - leg); ctx.stroke(); }
      ellipse(ctx, 0, -6, 9, 5, '#b08440');
      ctx.strokeStyle = '#b08440'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.quadraticCurveTo(-18, -14, -12, -24); ctx.quadraticCurveTo(-6, -28, -2, -22 - Math.sin(t * 5) * 2); ctx.stroke();
      circle(ctx, -2, -22 - Math.sin(t * 5) * 2, 2.5, '#5a2c1c');
      ellipse(ctx, 11, -8, 4, 2.5, '#c49a52'); ellipse(ctx, 11, -3, 4, 2.5, '#c49a52');
      circle(ctx, 7, -8, 0.9, '#111');
      break;
    }
    case 'bogling': {
      const sq = Math.sin(t * 6) * 1.5;
      ellipse(ctx, 0, 2, 11, 4, 'rgba(0,0,0,0.3)');
      ctx.scale(m.face, 1); ctx.translate(lunge * 0.5, 0);
      ellipse(ctx, 0, -9, 11 + sq, 10 - sq, '#5b6b3a');
      ellipse(ctx, -2, -12, 7, 5, '#6f8247');
      ctx.fillStyle = '#3d4a28'; ctx.fillRect(-8, -3, 3, 4); ctx.fillRect(4, -3, 3, 4);
      circle(ctx, 4, -12, 2.5, '#e8f070'); circle(ctx, 4.5, -12, 1, '#111');
      circle(ctx, -3, -13, 2, '#e8f070'); circle(ctx, -2.6, -13, 0.8, '#111');
      ctx.fillStyle = '#87a356'; ctx.fillRect(-4, -21, 2, 5); ctx.fillRect(1, -22, 2, 5);
      break;
    }
    case 'shade': case 'hollow': {
      const big = m.type === 'hollow' ? 2.4 : 1;
      ctx.scale(big, big);
      const fl = Math.sin(t * 3) * 2;
      ctx.globalAlpha = 0.88;
      ellipse(ctx, 0, 2, 9, 3, 'rgba(40,10,60,0.35)');
      ctx.fillStyle = '#140d22';
      ctx.beginPath();
      ctx.moveTo(-10, -12 + fl);
      ctx.quadraticCurveTo(-11, -30 + fl, 0, -32 + fl);
      ctx.quadraticCurveTo(11, -30 + fl, 10, -12 + fl);
      for (let i = 0; i < 5; i++) {
        const x = 10 - i * 5, y = -2 + fl + Math.sin(t * 8 + i) * 3;
        ctx.lineTo(x - 2.5, y); ctx.lineTo(x - 5, -8 + fl);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a1d44'; ellipse(ctx, -3, -24 + fl, 4, 5, '#2a1d44');
      ctx.globalAlpha = 1;
      const ey = -22 + fl, ex = m.face * 2;
      circle(ctx, ex - 3, ey, 1.6, '#d9c7ff'); circle(ctx, ex + 3, ey, 1.6, '#d9c7ff');
      Game.glows.push({ x: m.x + (ex - 3) * big, y: m.y + ey * big, r: 2.6 * big, c: 'rgba(200,170,255,0.8)' });
      Game.glows.push({ x: m.x + (ex + 3) * big, y: m.y + ey * big, r: 2.6 * big, c: 'rgba(200,170,255,0.8)' });
      if (m.type === 'hollow') {
        ctx.fillStyle = '#c9a54a';
        ctx.beginPath(); ctx.moveTo(-7, -33 + fl); for (let i = 0; i < 5; i++) { ctx.lineTo(-7 + i * 3.5 + 1.75, -40 + fl); ctx.lineTo(-7 + (i + 1) * 3.5, -33 + fl); } ctx.closePath(); ctx.fill();
      }
      if (Math.random() < 0.25) Game.particles.push({ x: m.x + rand(-8, 8) * big, y: m.y - 4, vx: rand(-10, 10), vy: rand(-20, -5), life: 0.8, max: 0.8, size: 2.5 * big, color: 'rgba(30,18,50,0.7)', grav: 0 });
      break;
    }
    case 'guardian': {
      const st = moving ? Math.sin(t * 6) * 2 : 0;
      const charge = m.slam > 0 ? (0.7 - m.slam) * 10 : 0;
      ellipse(ctx, 0, 4, 28, 9, 'rgba(0,0,0,0.35)');
      if (m.slam > 0) {
        ctx.strokeStyle = 'rgba(255,120,80,' + (0.3 + (0.7 - m.slam)) + ')'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.ellipse(0, 0, 110, 66, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = '#5f5a52'; ctx.fillRect(-16, -12 + st, 11, 14); ctx.fillRect(5, -12 - st, 11, 14);
      poly(ctx, [-24, -16, -20, -48, 20, -48, 24, -16, 14, -10, -14, -10], '#7a756c');
      poly(ctx, [-20, -48, -12, -56, 12, -56, 20, -48], '#8e897f');
      ctx.fillStyle = '#5f5a52';
      ctx.fillRect(-34, -46 - charge, 11, 30); ctx.fillRect(23, -46 - charge, 11, 30);
      ctx.fillStyle = '#4e7a4a'; ctx.fillRect(-18, -40, 8, 5); ctx.fillRect(10, -30, 6, 4);
      poly(ctx, [-6, -64, 6, -64, 9, -52, -9, -52], '#6e6a62');
      circle(ctx, 0, -32, 6, '#9d7bff');
      Game.glows.push({ x: m.x, y: m.y - 32, r: 9, c: 'rgba(160,120,255,0.55)' });
      Game.glows.push({ x: m.x - 3, y: m.y - 59, r: 2, c: 'rgba(200,170,255,1)' });
      Game.glows.push({ x: m.x + 3, y: m.y - 59, r: 2, c: 'rgba(200,170,255,1)' });
      break;
    }
  }
  ctx.restore();
  if (m.hurt > 0) {
    const k = m.type === 'hollow' ? 2.4 : 1;
    ctx.globalAlpha = clamp(m.hurt * 4, 0, 0.6);
    ellipse(ctx, m.x, m.y - m.r * 0.9 * k, m.r * 1.2 * k, m.r * k, '#ffffff');
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- weather
function drawWeather(ctx, dt, x0, y0, x1, y1, p) {
  const rain = Game.weather.rain;
  if (rain < 0.05) return;
  const snowy = p && (TILES[tileAtPx(Game.cam.x, Game.cam.y)].temp <= -2);
  const want = Math.floor(rain * 260);
  const D = View.drops;
  while (D.length < want) D.push({ x: rand(x0, x1), y: rand(y0, y1), s: rand(0.7, 1.3) });
  if (D.length > want) D.length = want;
  const w = x1 - x0, h = y1 - y0;
  ctx.strokeStyle = 'rgba(190,210,240,0.45)'; ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  for (const d of D) {
    if (snowy) { d.y += 40 * d.s * dt; d.x += Math.sin(View.clock + d.s * 9) * 20 * dt; }
    else { d.y += 520 * d.s * dt; d.x += 90 * dt; }
    if (d.y > y1) { d.y = y0 + (d.y - y1) % h; d.x = rand(x0, x1); }
    if (d.y < y0) d.y += h;
    if (d.x > x1) d.x -= w; if (d.x < x0) d.x += w;
    if (snowy) ctx.rect(d.x, d.y, 2 * d.s, 2 * d.s);
    else { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 3, d.y - 12 * d.s); }
  }
  if (snowy) ctx.fill(); else ctx.stroke();
}

// ---------------------------------------------------------------- hint & compass
function drawHint(ctx, p) {
  const h = Game.hint;
  if (!h) return;
  const label = (Input.touch ? '' : 'E  ') + h.label;
  ctx.font = '600 9px "Alegreya Sans", system-ui, sans-serif';
  const w = ctx.measureText(label).width + 12;
  const x = p.x, y = p.y - 46;
  ctx.fillStyle = 'rgba(14,16,18,0.78)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 9, w, 14, 4) : ctx.rect(x - w / 2, y - 9, w, 14); ctx.fill();
  ctx.fillStyle = '#efe6d6'; ctx.textAlign = 'center'; ctx.fillText(label, x, y + 1.5);
  if (!Input.touch) { ctx.fillStyle = '#ff9a3d'; ctx.textAlign = 'left'; ctx.fillText('E', x - w / 2 + 6, y + 1.5); }
}

function objectiveTarget() {
  const p = Game.player;
  if (Game.won) return null;
  const left = World.shrines.filter((s) => !s.claimed);
  if (left.length) {
    let best = null, bd = 1e9;
    for (const s of left) { const d = dist(p.x, p.y, s.x, s.y); if (d < bd) { bd = d; best = s; } }
    return { x: best.x, y: best.y, label: 'Shard', col: '#b48cff' };
  }
  const grave = World.structs.find((s) => s.type === 'grave');
  if (grave) return { x: grave.x, y: grave.y, label: 'Grave', col: '#ffe9a8' };
  return null;
}

function drawCompass(ctx, p, cx, cy, halfW, halfH) {
  const targets = [];
  const ob = objectiveTarget();
  if (ob) targets.push(ob);
  const grave = World.structs.find((s) => s.type === 'grave');
  if (grave && (!ob || ob.label !== 'Grave')) targets.push({ x: grave.x, y: grave.y, label: 'Grave', col: '#ffe9a8' });
  for (const tg of targets) {
    const dx = tg.x - cx, dy = tg.y - cy;
    const inView = Math.abs(dx) < halfW - 30 && Math.abs(dy) < halfH - 30;
    if (inView) continue;
    const a = Math.atan2(dy, dx);
    const z = View.zoom;
    const ex = halfW - 30 / z * (View.W / View.dpr < 640 ? 1.5 : 1), top = halfH - (View.W / View.dpr < 640 ? 190 : 120) / z, bot = halfH - 185 / z;
    const ey = Math.sin(a) < 0 ? top : bot;
    const k = Math.min(ex / Math.abs(Math.cos(a) || 0.001), ey / Math.abs(Math.sin(a) || 0.001));
    const ax = cx + Math.cos(a) * k, ay = cy + Math.sin(a) * k;
    ctx.save(); ctx.translate(ax, ay);
    ctx.fillStyle = 'rgba(14,16,18,0.7)';
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(a);
    ctx.fillStyle = tg.col;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-5, -6); ctx.lineTo(-2, 0); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = '700 8px "Alegreya Sans", system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = tg.col;
    ctx.fillText(tg.label + ' ' + Math.round(dist(p.x, p.y, tg.x, tg.y) / TILE) + 'm', ax, ay + 23);
  }
}
