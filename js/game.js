'use strict';
// Game state and simulation: player, survival stats, creatures, combat, crafting, building.

const DAY_LEN = 360;           // seconds per full day
const HOTBAR = 8;

const Game = {
  state: 'title',
  time: 0.12, day: 1,
  player: null,
  mobs: [], projectiles: [], particles: [], pickups: [], texts: [], glows: [],
  pouch: {}, hotbar: [], sel: 0, armor: null, kit: {},
  spawn: { x: 0, y: 0 },
  weather: { rain: 0, target: 0, timer: 80, flash: 0 },
  shake: 0, cam: { x: 0, y: 0 },
  stats: { kills: 0, crafted: 0, built: 0, deaths: 0, gathered: 0 },
  bloodMoon: false, finalStand: null, won: false,
  spawnTimer: 0, hint: null, ghost: null, lastCause: 'the wilds',
  sleepFade: 0, interactCd: 0, useCd: 0,

  worldDays() { return this.day + this.time; },
};

// ---------------------------------------------------------------- time of day
function darkness(t) {
  if (t < 0.6) return 0;
  if (t < 0.72) return (t - 0.6) / 0.12;
  if (t < 0.93) return 1;
  return 1 - (t - 0.93) / 0.07;
}
const isNight = () => darkness(Game.time) > 0.55 || !!Game.finalStand;

// ---------------------------------------------------------------- setup
function newPlayer(x, y) {
  return { x, y, vx: 0, vy: 0, r: 10, hp: 100, food: 100, water: 100, warm: 100, stam: 100,
    face: 0, atkCd: 0, swing: 0, hurt: 0, inv: 0, walk: 0, moving: false, sprinting: false, dead: false, sipCd: 0 };
}

function findSpawn() {
  for (let r = 0; r < 40; r++) for (let a = 0; a < 16; a++) {
    const tx = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), ty = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
    const t = genTile(tx, ty);
    if (t === T.GRASS || t === T.FOREST) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }
  return { x: TILE / 2, y: TILE / 2 };
}

function resetWorld(seed) {
  World.seed = seed;
  World.chunks.clear(); World.minis.clear(); World.removed.clear();
  World.structs.length = 0; World.buckets.clear();
  placeShrines();
  Object.assign(Game, {
    time: 0.12, day: 1, mobs: [], projectiles: [], particles: [], pickups: [], texts: [],
    pouch: {}, hotbar: new Array(HOTBAR).fill(null), sel: 0, armor: null, kit: {},
    weather: { rain: 0, target: 0, timer: 90, flash: 0 },
    stats: { kills: 0, crafted: 0, built: 0, deaths: 0, gathered: 0 },
    bloodMoon: false, finalStand: null, won: false, spawnTimer: 0,
  });
  const sp = findSpawn();
  Game.spawn = { x: sp.x, y: sp.y };
  Game.player = newPlayer(sp.x, sp.y);
  Game.cam.x = sp.x; Game.cam.y = sp.y;
}

// ---------------------------------------------------------------- inventory
const isKit = (id) => ITEMS[id].kind === 'tool' || ITEMS[id].kind === 'weapon';

function countOf(id) {
  if (ITEMS[id].kind === 'mat') return Game.pouch[id] || 0;
  if (isKit(id)) return Game.kit[id] ? 1 : 0;
  let n = 0;
  for (const s of Game.hotbar) if (s && s.id === id) n += s.count;
  return n;
}

function take(id, n) {
  if (ITEMS[id].kind === 'mat') { Game.pouch[id] = (Game.pouch[id] || 0) - n; return; }
  for (let i = 0; i < HOTBAR && n > 0; i++) {
    const s = Game.hotbar[i];
    if (s && s.id === id) {
      const k = Math.min(n, s.count); s.count -= k; n -= k;
      if (s.count <= 0) Game.hotbar[i] = null;
    }
  }
  UI.dirty = true;
}

function addItem(id, n, quiet) {
  const def = ITEMS[id];
  if (def.kind === 'mat') {
    Game.pouch[id] = (Game.pouch[id] || 0) + n;
  } else if (isKit(id)) {
    Game.kit[id] = true;
  } else {
    let slot = Game.hotbar.find((s) => s && s.id === id);
    if (slot) { slot.count += n; if (id === 'waterskin') slot.sips += def.sips * n; }
    else {
      const i = Game.hotbar.indexOf(null);
      if (i < 0) {
        if (!quiet) toast('Hotbar full. Drop something with Q.', 'warn');
        return false;
      }
      Game.hotbar[i] = { id, count: n, sips: id === 'waterskin' ? 0 : undefined };
    }
  }
  UI.dirty = true;
  return true;
}

function bestTool(tool) {
  let best = null;
  for (const id in Game.kit) if (ITEMS[id].tool === tool && (!best || ITEMS[id].tier > best.tier)) best = ITEMS[id];
  return best;
}

function weaponDmg() {
  let d = 5;
  for (const id in Game.kit) d = Math.max(d, ITEMS[id].dmg);
  for (const s of Game.hotbar) if (s && ITEMS[s.id].dmg) d = Math.max(d, ITEMS[s.id].dmg);
  return d;
}

function bestWeaponId() {
  let best = null;
  for (const id in Game.kit) if (!best || ITEMS[id].dmg > ITEMS[best].dmg) best = id;
  return best;
}

function selItem() { const s = Game.hotbar[Game.sel]; return s ? ITEMS[s.id] : null; }

// ---------------------------------------------------------------- feedback
function toast(text, kind) { UI.toast(text, kind); }

function floatText(x, y, text, color) {
  Game.texts.push({ x, y, text, color: color || '#fff', life: 1.1 });
}

function burst(x, y, n, color, speed, life, size, grav) {
  for (let i = 0; i < n; i++) {
    if (Game.particles.length > 700) Game.particles.shift();
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
    Game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (grav ? speed * 0.4 : 0), life: life * (0.6 + Math.random() * 0.4), max: life, size: size || 2, color, grav: grav || 0 });
  }
}

function addShake(v) { Game.shake = Math.min(14, Game.shake + v); }

// ---------------------------------------------------------------- collision
function tileBlocks(x, y, r, mob) {
  const pts = [[x - r * 0.7, y - r * 0.7], [x + r * 0.7, y - r * 0.7], [x - r * 0.7, y + r * 0.7], [x + r * 0.7, y + r * 0.7]];
  for (const [px, py] of pts) {
    const t = tileAtPx(px, py);
    if (t === T.DEEP) return true;
    if (mob && t === T.WATER) return true;
  }
  return false;
}

function moveEntity(e, dx, dy, opts) {
  const mob = opts && opts.mob, ghost = opts && opts.ghost;
  if (!ghost || ghost === 'structs') {
    if (ghost || !tileBlocks(e.x + dx, e.y, e.r, mob)) e.x += dx;
    if (ghost || !tileBlocks(e.x, e.y + dy, e.r, mob)) e.y += dy;
  } else { e.x += dx; e.y += dy; }
  if (ghost === true) return null;
  let hitStruct = null;
  const R = 70;
  if (!ghost) {
    eachObjIn(e.x - R, e.y - R, e.x + R, e.y + R, (o) => {
      const d = OBJ[o.type];
      if (!d.solid) return;
      pushOut(e, o.x, o.y, o.r * 0.8);
    });
    for (const sh of World.shrines) {
      if (Math.abs(sh.x - e.x) > 200 || Math.abs(sh.y - e.y) > 200) continue;
      for (const pl of shrinePillars(sh)) pushOut(e, pl.x, pl.y, 12);
      pushOut(e, sh.x, sh.y, 20);
    }
  }
  eachStructIn(e.x - R, e.y - R, e.x + R, e.y + R, (s) => {
    const d = STRUCTS[s.type];
    if (!d.solid) return;
    if (d.box) {
      const x0 = s.x - 16, y0 = s.y - 16, x1 = s.x + 16, y1 = s.y + 16;
      const cx = clamp(e.x, x0, x1), cy = clamp(e.y, y0, y1);
      const ddx = e.x - cx, ddy = e.y - cy, dd = Math.hypot(ddx, ddy);
      if (dd < e.r) {
        if (dd > 0.001) { e.x = cx + (ddx / dd) * e.r; e.y = cy + (ddy / dd) * e.r; }
        else { e.y = y1 + e.r; }
        hitStruct = s;
      }
    } else if (pushOut(e, s.x, s.y, s.r)) hitStruct = s;
  });
  return hitStruct;
}

function pushOut(e, ox, oy, or) {
  const dx = e.x - ox, dy = e.y - oy, d = Math.hypot(dx, dy), min = e.r + or;
  if (d < min && d > 0.0001) { e.x = ox + (dx / d) * min; e.y = oy + (dy / d) * min; return true; }
  return false;
}

function shrinePillars(sh) {
  if (!sh.pillars) {
    sh.pillars = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      sh.pillars.push({ x: sh.x + Math.cos(a) * 92, y: sh.y + Math.sin(a) * 72, v: i % 3 });
    }
  }
  return sh.pillars;
}

// ---------------------------------------------------------------- fires & stations
function fireNear(x, y, range) {
  let best = null, bd = range;
  eachStructIn(x - range, y - range, x + range, y + range, (s) => {
    if (!STRUCTS[s.type].fire || !s.lit) return;
    const d = dist(x, y, s.x, s.y);
    if (d < bd) { bd = d; best = s; }
  });
  return best;
}

function stationNear(type) {
  const p = Game.player;
  if (type === 'fire') return !!fireNear(p.x, p.y, 140);
  let found = false;
  eachStructIn(p.x - 140, p.y - 140, p.x + 140, p.y + 140, (s) => { if (s.type === 'workbench' && dist(p.x, p.y, s.x, s.y) < 140) found = true; });
  return found;
}

// ---------------------------------------------------------------- crafting
function canCraft(r) {
  if (isKit(r.out) && Game.kit[r.out]) return false;
  if (r.station && !stationNear(r.station)) return false;
  for (const k in r.cost) if (countOf(k) < r.cost[k]) return false;
  return true;
}

function craft(r) {
  if (!canCraft(r)) return false;
  const out = ITEMS[r.out];
  if (out.kind !== 'mat' && !Game.hotbar.some((s) => s && s.id === r.out) && Game.hotbar.indexOf(null) < 0) {
    // freeing a slot by spending ingredients is fine; check after a dry run
    const freed = Object.keys(r.cost).some((k) => ITEMS[k].kind !== 'mat' && countOf(k) === r.cost[k]);
    if (!freed) { toast('Hotbar full. Drop something with Q.', 'warn'); return false; }
  }
  for (const k in r.cost) take(k, r.cost[k]);
  addItem(r.out, r.n || 1);
  Game.stats.crafted++;
  Sound.play('craft');
  toast('Crafted ' + out.name + (r.n > 1 ? ' ×' + r.n : ''), 'good');
  UI.dirty = true;
  return true;
}

// ---------------------------------------------------------------- player actions
function aimPoint() {
  const p = Game.player;
  return { x: p.x + Math.cos(p.face) * 44, y: p.y + Math.sin(p.face) * 44 };
}

function placementTarget() {
  const p = Game.player;
  let x, y;
  const mw = Input.mouseWorld();
  if (mw) {
    const dx = mw.x - p.x, dy = mw.y - p.y, d = Math.hypot(dx, dy), k = d > 72 ? 72 / d : 1;
    x = p.x + dx * k; y = p.y + dy * k;
  } else { const a = aimPoint(); x = a.x; y = a.y; }
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const sx = tx * TILE + TILE / 2, sy = ty * TILE + TILE / 2;
  const t = tileAt(tx, ty);
  let ok = !TILES[t].water && t !== T.DEEP && t !== T.RUIN && !objAtTile(tx, ty) && !structAtTile(tx, ty);
  const item = selItem();
  if (ok && item && STRUCTS[item.struct].solid && dist(sx, sy, p.x, p.y) < 24) ok = false;
  for (const m of Game.mobs) if (ok && dist(sx, sy, m.x, m.y) < 22) ok = false;
  return { tx, ty, x: sx, y: sy, ok };
}

function useSelected() {
  const p = Game.player;
  const slot = Game.hotbar[Game.sel];
  const item = slot ? ITEMS[slot.id] : null;
  if (!item || item.kind === 'tool' || item.kind === 'weapon' || item.kind === 'torch' || item.kind === 'ammo') return melee();
  if (Game.useCd > 0) return;
  Game.useCd = 0.35;
  switch (item.kind) {
    case 'food': {
      if (p.food >= 99 && !item.water && !item.hp) { toast('You are full.'); return; }
      p.food = clamp(p.food + (item.food || 0), 0, 100);
      p.water = clamp(p.water + (item.water || 0), 0, 100);
      p.stam = clamp(p.stam + (item.stamina || 0), 0, 100);
      if (item.hp) { if (item.hp < 0) hurtPlayer(-item.hp, 'bad food', true); else p.hp = clamp(p.hp + item.hp, 0, 100); }
      take(slot.id, 1);
      Sound.play('eat');
      burst(p.x, p.y - 10, 6, '#c9a85a', 50, 0.4, 2);
      if (slot.id === 'meat') toast('Raw meat. Your stomach disagrees. Cook it at a fire.', 'warn');
      return;
    }
    case 'heal':
      if (p.hp >= 100) { toast('You are not hurt.'); return; }
      p.hp = clamp(p.hp + item.hp, 0, 100); take(slot.id, 1);
      floatText(p.x, p.y - 24, '+' + item.hp, '#7be38a'); Sound.play('craft');
      return;
    case 'water':
      if (slot.sips <= 0) { toast('Waterskin is empty. Fill it at any water with E.', 'warn'); return; }
      slot.sips--; p.water = clamp(p.water + 25, 0, 100); Sound.play('drink'); UI.dirty = true;
      return;
    case 'armor': {
      const old = Game.armor;
      Game.armor = slot.id; take(slot.id, 1);
      if (old) addItem(old, 1);
      toast('Wearing ' + item.name, 'good'); Sound.play('place');
      return;
    }
    case 'place': {
      const pt = placementTarget();
      if (!pt.ok) { toast("Can't build there."); return; }
      const s = addStruct({ type: item.struct, x: pt.x, y: pt.y, tx: pt.tx, ty: pt.ty });
      if (STRUCTS[s.type].fire) { s.lit = true; s.fuel = STRUCTS[s.type].fuel || Infinity; }
      if (s.type === 'bed') { Game.spawn = { x: s.x, y: s.y }; toast('Bedroll placed. You will wake here.', 'good'); }
      if (s.type === 'beacon') toast('The Beacon stands. Press E beside it when you are ready for the last night.', 'gold');
      take(slot.id, 1);
      Game.stats.built++;
      Sound.play('place');
      burst(s.x, s.y, 10, '#b59a72', 60, 0.5, 2);
      return;
    }
    case 'bow': {
      if (countOf('arrow') <= 0) { toast('No arrows. Craft some.', 'warn'); return; }
      if (p.atkCd > 0) return;
      p.atkCd = 0.45; Game.useCd = 0;
      autoAim(420);
      take('arrow', 1);
      Game.projectiles.push({ x: p.x, y: p.y - 6, vx: Math.cos(p.face) * 620, vy: Math.sin(p.face) * 620, life: 0.75, dmg: 20 + (bestTool('pick') ? 0 : 0), from: 'player', kind: 'arrow' });
      Sound.play('shoot');
      return;
    }
  }
}

function autoAim(range) {
  if (Input.mouseWorld()) return;
  const p = Game.player;
  let best = null, bd = range;
  for (const m of Game.mobs) {
    if (m.dead) continue;
    const d = dist(p.x, p.y, m.x, m.y) + (m.def.behav === 'flee' ? 40 : 0);
    if (d < bd) { bd = d; best = m; }
  }
  if (best) p.face = Math.atan2(best.y - p.y, best.x - p.x);
}

function melee() {
  const p = Game.player;
  if (p.atkCd > 0) return;
  autoAim(110);
  p.atkCd = 0.36; p.swing = 1;
  p.stam = Math.max(0, p.stam - 3);
  Sound.play('swing');
  const reach = 46, arc = 1.15;
  let hitAny = false;
  for (const m of Game.mobs) {
    if (m.dead) continue;
    const d = dist(p.x, p.y, m.x, m.y);
    if (d > reach + m.r) continue;
    if (Math.abs(angDiff(Math.atan2(m.y - p.y, m.x - p.x), p.face)) > arc && d > m.r + 6) continue;
    damageMob(m, weaponDmg(), p.x, p.y);
    hitAny = true;
  }
  if (hitAny) return;
  // gather from the nearest object in front
  let best = null, bd = 1e9;
  eachObjIn(p.x - 80, p.y - 80, p.x + 80, p.y + 80, (o) => {
    const d = dist(p.x, p.y, o.x, o.y);
    if (d > reach + o.r) return;
    const ang = Math.abs(angDiff(Math.atan2(o.y - p.y, o.x - p.x), p.face));
    if (ang > arc && d > o.r + 8 && !Input.touch) return;
    const score = d + ang * 20;
    if (score < bd) { bd = score; best = o; }
  });
  if (best) hitObject(best);
}

function hitObject(o) {
  const def = OBJ[o.type];
  const p = Game.player;
  if (def.pick) return harvest(o);
  let power = 1;
  if (def.tool === 'axe') { const t = bestTool('axe'); power = t ? t.power : 1; }
  else if (def.tool === 'pick') {
    const t = bestTool('pick');
    if (!t || t.tier < def.tier) {
      toast(def.tier > 1 ? 'Moon crystal needs an Iron Pickaxe.' : 'You need a pickaxe to break rock.', 'warn');
      burst(o.x, o.y - 10, 4, '#ffe9a8', 80, 0.25, 1.5);
      Sound.play('mine');
      return;
    }
    power = t.power;
  } else if (def.tool === 'any') { const t = bestTool('axe'); power = t ? t.power : 1; }
  if (def.thorns && !bestTool('axe')) hurtPlayer(def.thorns, 'cactus spines', true);
  o.hp -= power; o.shake = 1;
  Sound.play(def.hit);
  const col = def.hit === 'mine' ? (o.type === 'crystal' ? '#9ae9fa' : o.type === 'iron' ? '#c57a3c' : '#a3a09a') : o.type === 'cactus' ? '#3f8f4f' : '#8a6239';
  burst(o.x, o.y - 14, 6, col, 90, 0.4, 2, 300);
  if (def.hit === 'chop') burst(o.x, o.y - 40, 3, '#4f8a2f', 40, 0.9, 2, 60);
  if (o.hp <= 0) destroyObject(o);
}

function harvest(o) {
  const def = OBJ[o.type];
  Sound.play(def.hit);
  burst(o.x, o.y - 6, 8, o.type === 'berry' ? '#d6304a' : '#7db04a', 60, 0.5, 2, 200);
  destroyObject(o);
}

function destroyObject(o) {
  const def = OBJ[o.type];
  World.removed.set(o.id, Game.worldDays() + def.regrow * (0.8 + Math.random() * 0.4));
  for (const k in def.drops) {
    const [a, b] = def.drops[k];
    const n = randi(a, b);
    for (let i = 0; i < n; i++) dropPickup(k, 1, o.x, o.y - 8);
  }
  Game.stats.gathered++;
  if (def.solid) burst(o.x, o.y - 10, 14, def.hit === 'mine' ? '#8d8a84' : '#6b4a2b', 120, 0.6, 3, 350);
}

function dropPickup(id, n, x, y) {
  const a = Math.random() * Math.PI * 2, s = rand(40, 110);
  Game.pickups.push({ id, n, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0, vz: rand(120, 220), t: 0 });
}

function interactTarget() {
  const p = Game.player;
  let best = null, bd = 1e9;
  const consider = (d, t) => { if (d < bd) { bd = d; best = t; } };
  eachStructIn(p.x - 70, p.y - 70, p.x + 70, p.y + 70, (s) => {
    const d = dist(p.x, p.y, s.x, s.y);
    if (d > 58) return;
    if (s.type === 'grave') consider(d - 30, { kind: 'grave', s, label: 'Recover your belongings' });
    else if (s.type === 'campfire') {
      if (!s.lit) consider(d, { kind: 'fuel', s, label: 'Relight fire (2 wood)' });
      else if (s.fuel < 420) consider(d, { kind: 'fuel', s, label: 'Add wood (' + Math.ceil(s.fuel) + 's left)' });
    } else if (s.type === 'bed') consider(d, { kind: 'bed', s, label: isNight() && !Game.finalStand ? 'Sleep until dawn' : 'Rest (sets respawn)' });
    else if (s.type === 'beacon' && !Game.finalStand && !Game.won) consider(d - 20, { kind: 'beacon', s, label: 'Light the Beacon' });
  });
  eachObjIn(p.x - 60, p.y - 60, p.x + 60, p.y + 60, (o) => {
    const def = OBJ[o.type];
    if (!def.pick) return;
    const d = dist(p.x, p.y, o.x, o.y);
    if (d < 34 + o.r) consider(d, { kind: 'pick', o, label: def.label });
  });
  if (!best) {
    const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
    for (let dy = -1; dy <= 1 && !best; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(ptx + dx, pty + dy);
      if (TILES[t].water || t === T.ICE || t === T.DEEP) {
        best = { kind: 'water', label: t === T.ICE ? 'Break ice and drink' : 'Drink' + (Game.hotbar.some((s) => s && s.id === 'waterskin') ? ' and fill waterskin' : '') };
        break;
      }
    }
  }
  return best;
}

function interact() {
  if (Game.interactCd > 0) return;
  const t = interactTarget();
  if (!t) return;
  Game.interactCd = 0.3;
  const p = Game.player;
  switch (t.kind) {
    case 'pick': harvest(t.o); break;
    case 'water': {
      p.water = clamp(p.water + 30, 0, 100);
      for (const s of Game.hotbar) if (s && s.id === 'waterskin') s.sips = s.count * ITEMS.waterskin.sips;
      Sound.play('drink'); burst(p.x + Math.cos(p.face) * 20, p.y + Math.sin(p.face) * 20, 8, '#9fd8ff', 60, 0.4, 2, 200);
      UI.dirty = true;
      break;
    }
    case 'fuel': {
      const need = t.s.lit ? 1 : 2;
      if (countOf('wood') < need) { toast('You need wood.', 'warn'); break; }
      take('wood', need);
      t.s.fuel = Math.min(480, (t.s.lit ? t.s.fuel : 0) + 120); t.s.lit = true;
      burst(t.s.x, t.s.y - 8, 12, '#ffb347', 90, 0.6, 2, -80); Sound.play('crackle');
      break;
    }
    case 'bed': {
      Game.spawn = { x: t.s.x, y: t.s.y };
      if (!isNight() || Game.finalStand) { toast('Respawn point set. You can sleep here at night.', 'good'); break; }
      const threat = Game.mobs.some((m) => m.def.behav !== 'flee' && (m.aggro || m.def.behav === 'boss') && dist(m.x, m.y, p.x, p.y) < 420);
      if (threat) { toast("You can't sleep with enemies close by.", 'warn'); break; }
      Game.sleepFade = 1.6;
      break;
    }
    case 'beacon': startFinalStand(t.s); break;
    case 'grave': {
      const loot = t.s.loot;
      for (const k in loot.pouch) if (loot.pouch[k] > 0) addItem(k, loot.pouch[k], true);
      const left = [];
      for (const s of loot.hotbar) if (s) {
        if (!addItem(s.id, s.count, true)) left.push(s);
        else if (s.id === 'waterskin') { const slot = Game.hotbar.find((h) => h && h.id === 'waterskin'); slot.sips = s.sips; }
      }
      if (loot.armor) { if (!Game.armor) Game.armor = loot.armor; else left.push({ id: loot.armor, count: 1 }); }
      if (left.length) { loot.pouch = {}; loot.hotbar = left; loot.armor = null; toast('Some items stay in the grave. Free hotbar space.', 'warn'); }
      else { removeStruct(t.s); toast('Belongings recovered.', 'good'); }
      Sound.play('pickup');
      break;
    }
  }
}

function dropSelected() {
  const s = Game.hotbar[Game.sel];
  if (!s) return;
  const p = Game.player;
  Game.hotbar[Game.sel] = null;
  dropPickup(s.id, s.count, p.x + Math.cos(p.face) * 30, p.y + Math.sin(p.face) * 30);
  Game.pickups[Game.pickups.length - 1].t = -2.5;
  toast('Dropped ' + ITEMS[s.id].name);
  UI.dirty = true;
}

// ---------------------------------------------------------------- damage
function hurtPlayer(dmg, cause, raw) {
  const p = Game.player;
  if (p.dead || (!raw && p.inv > 0)) return;
  let d = dmg;
  if (!raw && Game.armor) d *= 1 - ITEMS[Game.armor].armor;
  p.hp -= d; p.hurt = 0.3;
  if (!raw) p.inv = 0.35;
  Game.lastCause = cause;
  floatText(p.x, p.y - 26, '-' + Math.round(d), '#ff6b6b');
  burst(p.x, p.y - 6, 6, '#b3202a', 80, 0.5, 2, 200);
  addShake(raw ? 2 : 6);
  Sound.play('hurt');
  if (p.hp <= 0) killPlayer();
}

function damageMob(m, dmg, fx, fy) {
  m.hp -= dmg; m.hurt = 0.18;
  const a = Math.atan2(m.y - fy, m.x - fx);
  const kb = m.def.behav === 'boss' ? 40 : 200;
  m.kx = Math.cos(a) * kb; m.ky = Math.sin(a) * kb;
  if (m.def.behav === 'neutral' || m.def.behav === 'hostile') m.aggro = true;
  if (m.def.behav === 'flee') m.scared = 4;
  floatText(m.x, m.y - m.r - 14, String(Math.round(dmg)), '#ffe9a8');
  burst(m.x, m.y - 4, 7, m.type === 'shade' || m.type === 'hollow' ? '#6b4f9e' : m.type === 'guardian' ? '#8d8a84' : '#b3202a', 110, 0.45, 2, 250);
  Sound.play('hit');
  addShake(2);
  if (m.hp <= 0) killMob(m);
}

function killMob(m, silent) {
  m.dead = true;
  if (!silent) {
    Game.stats.kills++;
    for (const k in m.def.drops) {
      const v = m.def.drops[k];
      const n = v < 1 ? (Math.random() < v ? 1 : 0) : v;
      for (let i = 0; i < n; i++) dropPickup(k, 1, m.x, m.y);
    }
    burst(m.x, m.y, 18, m.type === 'shade' || m.type === 'hollow' ? '#2b1f47' : '#7a1820', 140, 0.8, 3, 200);
  }
  if (m.type === 'guardian' && m.shrine) {
    m.shrine.claimed = true;
    const n = World.shrines.filter((s) => s.claimed).length;
    Sound.play('shrine');
    toast('The guardian crumbles. Ancient Shard ' + n + ' of 3.', 'gold');
    if (n === 3) toast('All three shards. Build a Workbench and forge The Beacon.', 'gold');
    addShake(10);
    UI.boss = null;
  }
  if (m.type === 'hollow') { toast('The Hollow King is broken. Hold until dawn!', 'gold'); UI.boss = null; addShake(12); }
}

function killPlayer() {
  const p = Game.player;
  p.dead = true; p.hp = 0;
  Game.stats.deaths++;
  Sound.play('die');
  const hasLoot = Object.values(Game.pouch).some((v) => v > 0) || Game.hotbar.some((s) => s) || Game.armor;
  if (hasLoot) {
    addStruct({ type: 'grave', x: p.x, y: p.y, tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE),
      loot: { pouch: { ...Game.pouch }, hotbar: Game.hotbar.map((s) => s && { ...s }), armor: Game.armor } });
  }
  Game.pouch = {}; Game.hotbar = new Array(HOTBAR).fill(null); Game.armor = null;
  if (Game.finalStand) endFinalStand(false);
  Game.state = 'dead';
  UI.showDeath();
}

function respawn() {
  const p = newPlayer(Game.spawn.x, Game.spawn.y);
  p.food = 75; p.water = 75; p.inv = 3;
  Game.player = p;
  Game.mobs = Game.mobs.filter((m) => m.def.behav === 'boss' || dist(m.x, m.y, p.x, p.y) > 500);
  Game.state = 'play';
  UI.dirty = true;
}

// ---------------------------------------------------------------- final stand
function startFinalStand(beacon) {
  if (Game.finalStand) return;
  beacon.lit = true;
  Game.finalStand = { t: 0, dur: 150, beacon, boss: false, wave: 0 };
  Game.prevTime = Game.time;
  Game.time = Math.max(Game.time, 0.75); if (Game.time > 0.9) Game.time = 0.75;
  Sound.play('roar');
  toast('The Beacon blazes into the sky. Everything in the dark has seen it.', 'gold');
  toast('Protect the Beacon until dawn.', 'warn');
  addShake(8);
}

function endFinalStand(success) {
  const fs = Game.finalStand;
  if (!fs) return;
  Game.finalStand = null;
  UI.boss = null;
  if (success) {
    Game.won = true;
    Game.time = 0.95;
    for (const m of Game.mobs) if (m.def.night) killMob(m, true);
    Sound.play('win');
    Game.state = 'won';
    UI.showWin();
  } else {
    fs.beacon.lit = false;
    if (World.structs.includes(fs.beacon) && fs.beacon.hp <= 0) removeStruct(fs.beacon);
    if (!World.structs.includes(fs.beacon)) { addItem('beacon', 1, true); toast('The Beacon fell. Its core returns to your pack.', 'warn'); }
  }
}

// ---------------------------------------------------------------- creatures
function spawnMob(type, x, y, extra) {
  const def = MOBS[type];
  const scale = def.behav === 'hostile' ? Math.min(1.8, 1 + (Game.day - 1) * 0.06) : 1;
  const m = { type, def, x, y, vx: 0, vy: 0, kx: 0, ky: 0, r: def.r, hp: def.hp * scale, maxhp: def.hp * scale,
    dmg: (def.dmg || 0) * Math.min(1.9, 1 + (Game.day - 1) * 0.05), speed: def.speed,
    t: 0, dir: Math.random() * Math.PI * 2, atkCd: 1, hurt: 0, aggro: false, face: 1, anim: Math.random() * 10, scared: 0, burn: 0, special: 2 };
  Object.assign(m, extra || {});
  Game.mobs.push(m);
  return m;
}

function pickWeighted(table) {
  let tot = 0;
  for (const k in table) tot += table[k];
  let r = Math.random() * tot;
  for (const k in table) { r -= table[k]; if (r <= 0) return k; }
  return null;
}

function spawnTick() {
  const p = Game.player;
  const night = isNight();
  let cap = 10 + (night ? 6 + Math.min(Game.day, 10) : 0);
  if (Game.bloodMoon && night) cap += 8;
  let count = 0;
  for (const m of Game.mobs) if (m.def.behav !== 'boss') count++;
  if (count >= cap) return;
  const a = Math.random() * Math.PI * 2, d = rand(560, 820);
  const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
  const t = tileAtPx(x, y);
  if (fireNear(x, y, 320)) return;
  let type;
  const shadeChance = Game.bloodMoon ? 0.75 : 0.5;
  if (night && Math.random() < shadeChance) type = 'shade';
  else {
    if (TILES[t].water || t === T.DEEP || t === T.RUIN) return;
    const table = SPAWNS[t];
    if (!table) return;
    type = pickWeighted(table);
    if (!type) return;
    if (MOBS[type].behav === 'hostile' && !night && Game.day === 1 && Math.random() < 0.6) return;
  }
  const pack = type === 'wolf' && night ? randi(2, 3) : type === 'shade' && Game.bloodMoon ? 2 : 1;
  for (let i = 0; i < pack; i++) spawnMob(type, x + rand(-30, 30), y + rand(-30, 30));
}

function updateMob(m, dt) {
  const p = Game.player;
  const def = m.def;
  m.anim += dt; m.hurt -= dt; m.atkCd -= dt; m.scared -= dt;
  const d = dist(m.x, m.y, p.x, p.y);
  let tx = null, ty = null, speed = 0, target = null;
  const night = isNight();

  if (def.night && !night) {
    m.burn += dt;
    if (Math.random() < dt * 20) burst(m.x, m.y - 8, 1, '#ffb347', 60, 0.6, 2, -120);
    if (m.burn > 1.2) { killMob(m, true); burst(m.x, m.y, 16, '#2b1f47', 100, 0.8, 3); return; }
  }

  if (def.behav === 'flee') {
    if (d < 170 || m.scared > 0) { tx = m.x + (m.x - p.x); ty = m.y + (m.y - p.y); speed = m.speed; }
  } else if (def.behav === 'neutral') {
    if (m.aggro && !p.dead) { target = p; speed = m.speed; if (d > 500) m.aggro = false; }
  } else if (def.behav === 'hostile') {
    const range = def.aggro * (night ? 1.4 : 1);
    if (!p.dead && (d < range || (m.aggro && d < range * 1.6))) { m.aggro = true; target = p; speed = m.speed; }
    else m.aggro = false;
    if (Game.finalStand && def.night) {
      const b = Game.finalStand.beacon;
      if (d > 260 || p.dead) { target = b; speed = m.speed; m.aggro = true; }
    }
  } else if (def.behav === 'boss') {
    updateBoss(m, dt, d);
    if (m.dead) return;
    if (m.charging > 0) { speed = 0; }
    else if (!p.dead) { target = p; speed = m.speed; }
  }

  // fear of fire
  if (target && def.behav !== 'boss') {
    const f = fireNear(m.x, m.y, 115);
    if (f && !(Game.finalStand && target === Game.finalStand.beacon && f !== target)) {
      tx = m.x + (m.x - f.x); ty = m.y + (m.y - f.y); target = null; speed = m.speed * 0.8;
      if (def.night) m.hp -= dt * 6;
    }
  }

  if (target) { tx = target.x; ty = target.y; }
  let mx = 0, my = 0;
  if (tx !== null) {
    const a = Math.atan2(ty - m.y, tx - m.x);
    const td = dist(m.x, m.y, tx, ty);
    if (!target || td > m.r + (target.r || 16) + 2) { mx = Math.cos(a) * speed; my = Math.sin(a) * speed; }
  } else {
    m.t -= dt;
    if (m.t <= 0) { m.t = rand(1.5, 4); m.dir = Math.random() < 0.35 ? null : Math.random() * Math.PI * 2; }
    if (m.dir !== null) { mx = Math.cos(m.dir) * m.speed * 0.3; my = Math.sin(m.dir) * m.speed * 0.3; }
  }
  if (m.charging > 0 && m.dashV) { mx = m.dashV.x; my = m.dashV.y; }
  m.vx = lerp(m.vx, mx, Math.min(1, dt * 8));
  m.vy = lerp(m.vy, my, Math.min(1, dt * 8));
  if (Math.abs(m.vx) > 4) m.face = m.vx > 0 ? 1 : -1;
  const ghost = def.night ? 'structs' : false;
  const hit = moveEntity(m, (m.vx + m.kx) * dt, (m.vy + m.ky) * dt, { mob: true, ghost });
  m.kx *= Math.pow(0.002, dt); m.ky *= Math.pow(0.002, dt);
  if (!def.night && m.dir !== null && tx === null && hit) m.t = 0;

  // attacks
  if (target === p && !p.dead && d < m.r + p.r + 8 && m.atkCd <= 0 && def.dmg) {
    m.atkCd = def.behav === 'boss' ? 1.3 : 1.0;
    m.lunge = 0.2;
    hurtPlayer(m.dmg, 'a ' + def.name.toLowerCase());
    const a = Math.atan2(p.y - m.y, p.x - m.x);
    p.vx += Math.cos(a) * 260; p.vy += Math.sin(a) * 260;
  } else if (target && target !== p && dist(m.x, m.y, target.x, target.y) < m.r + 30 && m.atkCd <= 0) {
    m.atkCd = 1; damageStruct(target, m.dmg);
  } else if (hit && m.aggro && m.atkCd <= 0 && def.dmg && (hit.type === 'wall' || hit.type === 'beacon' || hit.type === 'workbench' || hit.type === 'campfire')) {
    m.atkCd = 1.2; damageStruct(hit, m.dmg * 0.8);
  }
  m.lunge = Math.max(0, (m.lunge || 0) - dt);

  // spike traps
  if (def.behav !== 'flee') eachStructIn(m.x - 30, m.y - 30, m.x + 30, m.y + 30, (s) => {
    if (s.type !== 'spikes' || m.dead) return;
    if (dist(m.x, m.y, s.x, s.y) < 18 + m.r && (m.spikeCd || 0) <= 0) {
      m.spikeCd = 0.6; damageMob(m, 14, s.x, s.y); damageStruct(s, 6);
    }
  });
  m.spikeCd = (m.spikeCd || 0) - dt;
  if (m.hp <= 0 && !m.dead) killMob(m);
}

function damageStruct(s, dmg) {
  if (!World.structs.includes(s)) return;
  s.hp -= dmg; s.hurt = 0.2;
  burst(s.x, s.y - 10, 5, '#8a6239', 80, 0.4, 2, 250);
  Sound.play('chop');
  if (s.hp <= 0) {
    removeStruct(s);
    burst(s.x, s.y, 16, '#6b4a2b', 130, 0.7, 3, 300);
    if (Game.finalStand && s === Game.finalStand.beacon) endFinalStand(false);
  }
}

function updateBoss(m, dt, d) {
  const p = Game.player;
  m.special -= dt;
  m.charging = Math.max(0, (m.charging || 0) - dt);
  if (m.type === 'guardian') {
    const sh = m.shrine;
    if (dist(p.x, p.y, sh.x, sh.y) > 760 || p.dead) {
      // leash back home and recover
      m.hp = Math.min(m.maxhp, m.hp + dt * 40);
      if (dist(m.x, m.y, sh.x, sh.y) > 20) { m.x = lerp(m.x, sh.x, dt); m.y = lerp(m.y, sh.y, dt); }
      UI.boss = null;
      return;
    }
    UI.boss = m;
    if (m.special <= 0 && d < 520) {
      const roll = Math.random();
      if (roll < 0.45 && d > 90) {
        // hurl a boulder
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        Game.projectiles.push({ x: m.x, y: m.y - 20, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, life: 1.8, dmg: 14 + sh.level * 4, from: 'mob', kind: 'boulder', cause: 'a hurled boulder' });
        m.special = 2.2;
      } else {
        m.slam = 0.7; m.special = 3.4; m.charging = 0.7;
      }
    }
    if (m.slam > 0) {
      m.slam -= dt;
      if (m.slam <= 0) {
        Game.particles.push({ ring: true, x: m.x, y: m.y, life: 0.5, max: 0.5, size: 110, color: '#d9d0bf', vx: 0, vy: 0, grav: 0 });
        addShake(9); Sound.play('hit'); Sound.play('mine');
        if (dist(p.x, p.y, m.x, m.y) < 110) hurtPlayer(20 + sh.level * 6, 'a guardian slam');
      }
    }
    if (!m.summoned && m.hp < m.maxhp * 0.5 && sh.level > 0) {
      m.summoned = true;
      for (let i = 0; i < 1 + sh.level; i++) spawnMob('shade', m.x + rand(-60, 60), m.y + rand(-60, 60), { aggro: true });
      toast('The guardian calls the shadows!', 'warn');
    }
  } else if (m.type === 'hollow') {
    UI.boss = m;
    if (m.special <= 0) {
      m.special = rand(2.5, 3.5);
      if (Math.random() < 0.6) {
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        m.dashV = { x: Math.cos(a) * 520, y: Math.sin(a) * 520 };
        m.charging = 0.45; m.dashing = true;
        Sound.play('swing');
      } else {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          Game.projectiles.push({ x: m.x, y: m.y - 20, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 1.6, dmg: 13, from: 'mob', kind: 'wisp', cause: 'the Hollow King' });
        }
        Sound.play('roar');
      }
    }
    if (m.charging <= 0) m.dashV = null;
    if (m.dashV && dist(p.x, p.y, m.x, m.y) < m.r + p.r + 6) hurtPlayer(m.dmg, 'the Hollow King');
  }
}

// ---------------------------------------------------------------- shrines
function updateShrines() {
  const p = Game.player;
  for (const sh of World.shrines) {
    const d = dist(p.x, p.y, sh.x, sh.y);
    if (d < 900 && !sh.seen) { sh.seen = true; toast('You sense ancient stones nearby.', 'gold'); }
    if (sh.claimed || p.dead) continue;
    const has = Game.mobs.some((m) => m.type === 'guardian' && m.shrine === sh);
    if (d < 290 && !has) {
      const g = spawnMob('guardian', sh.x, sh.y - 10, { shrine: sh, hp: 220 + sh.level * 120, maxhp: 220 + sh.level * 120, dmg: 20 + sh.level * 6, speed: 95 + sh.level * 12 });
      g.special = 1.5;
      Sound.play('roar'); addShake(8);
      toast('A Stone Guardian wakes!', 'warn');
    }
  }
}

// ---------------------------------------------------------------- main update
function update(dt) {
  const p = Game.player;
  Game.interactCd -= dt; Game.useCd -= dt;
  Game.shake *= Math.pow(0.0005, dt);
  Game.weather.flash = Math.max(0, Game.weather.flash - dt * 2.5);

  // --- time
  if (Game.sleepFade > 0) {
    const before = Game.sleepFade;
    Game.sleepFade -= dt;
    if (before > 0.8 && Game.sleepFade <= 0.8) {
      Game.day++; Game.time = 0.0;
      p.food = clamp(p.food - 20, 5, 100); p.water = clamp(p.water - 20, 5, 100); p.hp = clamp(p.hp + 35, 0, 100); p.warm = 100;
      for (const m of Game.mobs) if (m.def.night) m.dead = true;
      toast('You wake rested. Day ' + Game.day + '.', 'good');
      Sound.play('day');
    }
  }
  const prev = Game.time;
  if (!Game.finalStand) Game.time += dt / DAY_LEN;
  else {
    const fs = Game.finalStand;
    fs.t += dt;
    Game.time = 0.75 + (fs.t / fs.dur) * 0.18;
    if (!fs.boss && fs.t > fs.dur * 0.4) {
      fs.boss = true;
      const a = Math.random() * Math.PI * 2;
      spawnMob('hollow', fs.beacon.x + Math.cos(a) * 520, fs.beacon.y + Math.sin(a) * 520, { aggro: true, special: 3 });
      Sound.play('roar'); addShake(10);
      toast('The Hollow King rises to snuff out the light!', 'warn');
    }
    fs.wave -= dt;
    if (fs.wave <= 0) {
      fs.wave = Math.max(1.4, 3.5 - fs.t / 60);
      const n = 2 + Math.floor(fs.t / 40);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        spawnMob('shade', fs.beacon.x + Math.cos(a) * rand(480, 620), fs.beacon.y + Math.sin(a) * rand(480, 620), { aggro: true });
      }
    }
    if (fs.t >= fs.dur) endFinalStand(true);
  }
  if (prev < 0.66 && Game.time >= 0.66) {
    Game.bloodMoon = Game.day % 5 === 0;
    if (Game.bloodMoon) { toast('The moon rises red. The shades are restless tonight.', 'warn'); Sound.play('roar'); }
    else toast('Night is coming. Find fire and shelter.', 'warn');
    Sound.play('howl');
  }
  if (prev < 0.94 && Game.time >= 0.94 && !Game.finalStand) { toast('Dawn breaks. The shadows burn away.', 'good'); Sound.play('day'); }
  if (Game.time >= 1) { Game.time -= 1; Game.day++; Game.bloodMoon = false; toast('Day ' + Game.day, 'gold'); }

  // --- weather
  const w = Game.weather;
  w.timer -= dt;
  if (w.timer <= 0) { w.target = Math.random() < 0.32 ? rand(0.5, 1) : 0; w.timer = rand(60, 150); }
  w.rain = lerp(w.rain, w.target, Math.min(1, dt * 0.25));
  if (w.rain > 0.75 && Math.random() < dt * 0.04) { w.flash = 1; setTimeout(() => Sound.play('thunder'), rand(200, 1200)); }

  // --- fires
  for (const s of World.structs) {
    if (s.type === 'campfire' && s.lit) {
      s.fuel -= dt * (1 + w.rain * 0.6);
      if (s.fuel <= 0) { s.lit = false; s.fuel = 0; burst(s.x, s.y - 6, 10, '#777', 40, 1, 3, -40); }
    }
    if (s.hurt) s.hurt -= dt;
  }

  if (!p.dead) updatePlayer(dt);

  // --- creatures
  Game.spawnTimer -= dt;
  if (Game.spawnTimer <= 0) { Game.spawnTimer = 0.7; spawnTick(); }
  for (const m of Game.mobs) if (!m.dead) updateMob(m, dt);
  for (const m of Game.mobs) if (!m.dead && m.def.behav !== 'boss' && dist(m.x, m.y, p.x, p.y) > 1500) m.dead = true;
  for (const m of Game.mobs) if (!m.dead && m.type === 'guardian' && dist(m.x, m.y, p.x, p.y) > 2200) m.dead = true;
  Game.mobs = Game.mobs.filter((m) => !m.dead);
  // light separation so packs do not stack
  for (let i = 0; i < Game.mobs.length; i++) for (let j = i + 1; j < Game.mobs.length; j++) {
    const a = Game.mobs[i], b = Game.mobs[j];
    const dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy), min = a.r + b.r;
    if (dd < min && dd > 0.01) { const k = (min - dd) / dd * 0.5; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
  }
  updateShrines();

  // --- projectiles
  for (const pr of Game.projectiles) {
    pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
    if (pr.kind === 'wisp' && Math.random() < 0.5) burst(pr.x, pr.y, 1, '#8a6bd6', 20, 0.3, 2);
    if (pr.from === 'player') {
      for (const m of Game.mobs) if (!m.dead && dist(pr.x, pr.y, m.x, m.y - 4) < m.r + 4) { damageMob(m, pr.dmg, pr.x - pr.vx * 0.05, pr.y - pr.vy * 0.05); pr.life = 0; break; }
      if (pr.life > 0) eachObjIn(pr.x - 20, pr.y - 20, pr.x + 20, pr.y + 20, (o) => {
        if (OBJ[o.type].solid && dist(pr.x, pr.y, o.x, o.y) < o.r) { pr.life = 0; burst(pr.x, pr.y, 3, '#9a7448', 50, 0.3, 1.5); }
      });
    } else if (!p.dead && dist(pr.x, pr.y, p.x, p.y - 4) < p.r + 8) {
      hurtPlayer(pr.dmg, pr.cause); pr.life = 0;
      burst(pr.x, pr.y, 8, pr.kind === 'wisp' ? '#8a6bd6' : '#8d8a84', 100, 0.5, 3, 200);
    }
  }
  Game.projectiles = Game.projectiles.filter((pr) => pr.life > 0);

  // --- pickups
  for (const k of Game.pickups) {
    k.t += dt;
    k.vz -= 600 * dt; k.z = Math.max(0, k.z + k.vz * dt);
    if (k.z === 0) { k.vx *= Math.pow(0.01, dt); k.vy *= Math.pow(0.01, dt); }
    k.x += k.vx * dt; k.y += k.vy * dt;
    const d = dist(k.x, k.y, p.x, p.y);
    if (!p.dead && k.t > 0.35 && d < 80) {
      const a = Math.atan2(p.y - k.y, p.x - k.x), s = 380 * (1 - d / 100) + 80;
      k.x += Math.cos(a) * s * dt; k.y += Math.sin(a) * s * dt;
      if (d < 14) {
        if (addItem(k.id, k.n, true)) {
          k.gone = true; Sound.play('pickup');
          UI.pickupNote(k.id, k.n);
        } else { k.t = -3; k.vx = -Math.cos(a) * 100; k.vy = -Math.sin(a) * 100; k.vz = 150; if (!Game.fullWarned) { toast('Hotbar full. Drop something with Q.', 'warn'); Game.fullWarned = true; setTimeout(() => { Game.fullWarned = false; }, 4000); } }
      }
    }
    if (k.t > 150) k.gone = true;
  }
  Game.pickups = Game.pickups.filter((k) => !k.gone);

  // --- particles & text
  for (const q of Game.particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.grav * dt; q.vx *= Math.pow(0.1, dt); if (!q.grav) q.vy *= Math.pow(0.1, dt); }
  Game.particles = Game.particles.filter((q) => q.life > 0);
  for (const t of Game.texts) { t.life -= dt; t.y -= 30 * dt; }
  Game.texts = Game.texts.filter((t) => t.life > 0);

  // --- objects wobble back
  // (shake decays in render where they are visited)

  Game.hint = p.dead ? null : interactTarget();
  const it = selItem();
  Game.ghost = it && it.kind === 'place' && !p.dead ? placementTarget() : null;

  Sound.setAmbient(w.rain, TILES[tileAtPx(p.x, p.y)].temp < -1 ? 1 : 0.25);
  if (Math.random() < dt * 4 && fireNear(p.x, p.y, 200)) Sound.play('crackle');
}

function updatePlayer(dt) {
  const p = Game.player;
  p.atkCd -= dt; p.swing = Math.max(0, p.swing - dt * 4); p.hurt -= dt; p.inv -= dt;
  const mv = Input.move();
  const mag = Math.hypot(mv.x, mv.y);
  p.moving = mag > 0.1;
  const tile = tileAtPx(p.x, p.y);
  const tdef = TILES[tile];
  const wantSprint = Input.sprint() && p.moving;
  if (p.stam < 1) p.exhausted = true;
  if (p.stam > 25) p.exhausted = false;
  p.sprinting = wantSprint && !p.exhausted;
  let speed = p.sprinting ? 235 : 150;
  if (tdef.slow) speed *= tdef.slow;
  if (p.warm < 20) speed *= 0.85;
  if (p.sprinting) p.stam = Math.max(0, p.stam - 24 * dt);
  else p.stam = Math.min(100, p.stam + (p.moving ? 12 : 22) * dt * (p.food > 10 ? 1 : 0.3));
  const accel = tdef.slippery ? 1.6 : 14;
  p.vx = lerp(p.vx, mv.x * speed, Math.min(1, dt * accel));
  p.vy = lerp(p.vy, mv.y * speed, Math.min(1, dt * accel));
  moveEntity(p, p.vx * dt, p.vy * dt);
  if (p.moving) p.walk += dt * (p.sprinting ? 14 : 10);
  if (tdef.water && p.moving && Math.random() < dt * 12) burst(p.x, p.y + 6, 1, '#cfeeff', 30, 0.4, 2);

  // facing
  const mw = Input.mouseWorld();
  if (mw) p.face = Math.atan2(mw.y - p.y, mw.x - p.x);
  else if (p.moving && p.swing <= 0) p.face = Math.atan2(mv.y, mv.x);

  if (Input.attackHeld()) useSelected();
  if (Input.consume('interact')) interact();
  if (Input.consume('drop')) dropSelected();

  // survival stats
  const night = isNight();
  const day = !night;
  p.food -= (100 / 480) * (p.sprinting ? 1.7 : 1) * dt;
  p.water -= (100 / 360) * (tdef.hot && day ? 2 : 1) * (Game.weather.rain > 0.3 ? 0.7 : 1) * dt;
  let temp = tdef.temp;
  if (tdef.hot && night) temp = -1;
  if (night) temp -= 0.9;
  temp -= Game.weather.rain * 0.6;
  const f = fireNear(p.x, p.y, 170);
  if (f) temp += 1.2 + 3.5 * (1 - dist(p.x, p.y, f.x, f.y) / 170);
  if (Game.armor) temp += ITEMS[Game.armor].warm;
  const held = selItem();
  if (held && held.kind === 'torch') temp += 0.4;
  p.temp = temp;
  if (temp < 0) p.warm += temp * 0.6 * dt; else p.warm += (2 + temp * 4) * dt;
  p.food = clamp(p.food, 0, 100); p.water = clamp(p.water, 0, 100); p.warm = clamp(p.warm, 0, 100);
  if (p.food <= 0) { p.hp -= 1.2 * dt; Game.lastCause = 'starvation'; }
  if (p.water <= 0) { p.hp -= 1.6 * dt; Game.lastCause = 'thirst'; }
  if (p.warm <= 0) { p.hp -= 2 * dt; Game.lastCause = 'the cold'; }
  if (p.food > 45 && p.water > 45 && p.warm > 35) p.hp = Math.min(100, p.hp + (f ? 1.6 : 0.6) * dt);
  if (p.hp <= 0) killPlayer();
}
