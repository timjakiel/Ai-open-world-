'use strict';
// Procedural world: terrain, biomes, objects, chunk caching and chunk rendering.

const World = {
  seed: 1,
  chunks: new Map(),      // key -> { cx, cy, tiles: Uint8Array, objs: [], canvas, mini }
  minis: new Map(),       // key -> 16x16 canvas, kept forever for the map
  removed: new Map(),     // object id -> world day when it grows back
  structs: [],
  buckets: new Map(),     // chunk key -> structs in that chunk
  shrines: [],
  canvasCount: 0,
};

function stretch(v, k) { return clamp((v - 0.5) * k + 0.5, 0, 1); }

function terrainAt(tx, ty) {
  const S = World.seed;
  let e = stretch(fbm(tx / 95, ty / 95, S, 5), 1.9);
  const m = stretch(fbm(tx / 150 + 40, ty / 150, S + 77, 4), 2.0);
  const t = stretch(fbm(tx / 230, ty / 230 + 90, S + 191, 3), 1.8);
  // keep the landing site dry and friendly
  const d = Math.hypot(tx, ty);
  if (d < 26) e = Math.max(e, 0.62 - d * 0.008);
  return { e, m, t, d };
}

function genTile(tx, ty) {
  const { e, m, t, d } = terrainAt(tx, ty);
  const S = World.seed;
  const cold = t < 0.27 && d > 30;
  if (e < 0.27) return cold ? T.ICE : T.DEEP;
  if (e < 0.325) return cold ? T.ICE : T.WATER;
  const river = Math.abs(fbm(tx / 130, ty / 130, S + 333, 3) - 0.5);
  if (river < 0.011 && e < 0.7) return cold ? T.ICE : T.WATER;
  if (e < 0.36) return cold ? T.SNOW : T.SAND;
  if (e > 0.78) return T.ROCKY;
  if (cold) return T.SNOW;
  if (t > 0.68 && m < 0.5 && d > 40) return T.DESERT;
  if (m > 0.63 && e < 0.52) return T.SWAMP;
  if (m > 0.48) return T.FOREST;
  return T.GRASS;
}

function tileAt(tx, ty) {
  const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS);
  const ch = World.chunks.get(chunkKey(cx, cy));
  if (ch) return ch.tiles[(ty - cy * CS) * CS + (tx - cx * CS)];
  return genTile(tx, ty);
}
const tileAtPx = (x, y) => tileAt(Math.floor(x / TILE), Math.floor(y / TILE));

// ---------------------------------------------------------------- objects
function rollObject(tile, r, r2) {
  switch (tile) {
    case T.FOREST:
      if (r < 0.13) return 'tree';
      if (r < 0.155) return 'berry';
      if (r < 0.19) return 'bush';
      if (r < 0.205) return 'mushroom';
      if (r < 0.215) return 'rock';
      if (r < 0.225) return 'flint';
      return null;
    case T.GRASS:
      if (r < 0.035) return 'tree';
      if (r < 0.055) return 'berry';
      if (r < 0.105) return 'bush';
      if (r < 0.12) return 'rock';
      if (r < 0.135) return 'flint';
      return null;
    case T.SNOW:
      if (r < 0.09) return 'pine';
      if (r < 0.115) return 'rock';
      if (r < 0.12) return 'iron';
      if (r < 0.124) return 'crystal';
      if (r < 0.13) return 'berry';
      return null;
    case T.DESERT:
      if (r < 0.035) return 'cactus';
      if (r < 0.055) return 'rock';
      if (r < 0.062) return 'iron';
      if (r < 0.064) return 'deadtree';
      return null;
    case T.SWAMP:
      if (r < 0.05) return 'deadtree';
      if (r < 0.13) return 'reeds';
      if (r < 0.16) return 'mushroom';
      if (r < 0.17) return 'tree';
      return null;
    case T.ROCKY:
      if (r < 0.13) return 'rock';
      if (r < 0.175) return 'iron';
      if (r < 0.183) return 'crystal';
      if (r < 0.2) return 'flint';
      if (r < 0.215) return 'pine';
      return null;
    case T.SAND:
      if (r < 0.025) return 'palm';
      if (r < 0.035) return 'flint';
      return null;
    default:
      return null;
  }
}

function genChunkData(cx, cy) {
  const S = World.seed;
  const tiles = new Uint8Array(CS * CS);
  for (let y = 0; y < CS; y++)
    for (let x = 0; x < CS; x++) tiles[y * CS + x] = genTile(cx * CS + x, cy * CS + y);
  // stamp shrine ruins
  for (const sh of World.shrines) {
    const lx = sh.tx - cx * CS, ly = sh.ty - cy * CS;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      const px = lx + x, py = ly + y;
      if (px < 0 || py < 0 || px >= CS || py >= CS) continue;
      if (x * x + y * y <= 17) tiles[py * CS + px] = T.RUIN;
    }
  }
  const objs = [];
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    const tx = cx * CS + x, ty = cy * CS + y;
    if (Math.hypot(tx, ty) < 3) continue;
    const tile = tiles[y * CS + x];
    const type = rollObject(tile, hash2(tx, ty, S + 5), hash2(tx, ty, S + 9));
    if (!type) continue;
    const def = OBJ[type];
    objs.push({
      id: tx + ':' + ty, type, tx, ty,
      x: tx * TILE + TILE / 2 + (hash2(tx, ty, S + 11) - 0.5) * 12,
      y: ty * TILE + TILE / 2 + (hash2(tx, ty, S + 13) - 0.5) * 12,
      hp: def.hp, r: def.r, v: Math.floor(hash2(tx, ty, S + 17) * 3), shake: 0,
    });
  }
  return { tiles, objs };
}

function getChunk(cx, cy) {
  const k = chunkKey(cx, cy);
  let ch = World.chunks.get(k);
  if (!ch) {
    const d = genChunkData(cx, cy);
    ch = { cx, cy, key: k, tiles: d.tiles, objs: d.objs, canvas: null, used: 0 };
    World.chunks.set(k, ch);
    if (!World.minis.has(k)) World.minis.set(k, renderMini(ch));
  }
  return ch;
}

function objAlive(o) {
  const until = World.removed.get(o.id);
  if (until === undefined) return true;
  if (until <= Game.worldDays()) { World.removed.delete(o.id); o.hp = OBJ[o.type].hp; return true; }
  return false;
}

// call fn for every live object whose chunk overlaps the rectangle
function eachObjIn(x0, y0, x1, y1, fn) {
  const cx0 = Math.floor(x0 / CHUNK_PX), cy0 = Math.floor(y0 / CHUNK_PX);
  const cx1 = Math.floor(x1 / CHUNK_PX), cy1 = Math.floor(y1 / CHUNK_PX);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const ch = getChunk(cx, cy);
    for (const o of ch.objs) if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1 && objAlive(o)) fn(o);
  }
}

// ---------------------------------------------------------------- structures
function bucketOf(x, y) { return chunkKey(Math.floor(x / CHUNK_PX), Math.floor(y / CHUNK_PX)); }

function addStruct(s) {
  const def = STRUCTS[s.type];
  s.hp = s.hp ?? def.hp;
  s.r = def.r || 16;
  World.structs.push(s);
  const k = bucketOf(s.x, s.y);
  if (!World.buckets.has(k)) World.buckets.set(k, []);
  World.buckets.get(k).push(s);
  return s;
}

function removeStruct(s) {
  World.structs.splice(World.structs.indexOf(s), 1);
  const b = World.buckets.get(bucketOf(s.x, s.y));
  if (b) b.splice(b.indexOf(s), 1);
}

function eachStructIn(x0, y0, x1, y1, fn) {
  const cx0 = Math.floor(x0 / CHUNK_PX), cy0 = Math.floor(y0 / CHUNK_PX);
  const cx1 = Math.floor(x1 / CHUNK_PX), cy1 = Math.floor(y1 / CHUNK_PX);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const b = World.buckets.get(chunkKey(cx, cy));
    if (b) for (const s of b) if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) fn(s);
  }
}

function structAtTile(tx, ty) {
  let found = null;
  const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
  eachStructIn(x - 1, y - 1, x + 1, y + 1, (s) => { found = s; });
  return found;
}

function objAtTile(tx, ty) {
  const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS);
  const ch = getChunk(cx, cy);
  for (const o of ch.objs) if (o.tx === tx && o.ty === ty && objAlive(o)) return o;
  return null;
}

// ---------------------------------------------------------------- shrines
function placeShrines() {
  World.shrines = [];
  const rng = mulberry32(World.seed * 7 + 3);
  const base = rng() * Math.PI * 2;
  const dists = [70, 125, 185];
  for (let i = 0; i < 3; i++) {
    const a = base + i * (Math.PI * 2 / 3) + (rng() - 0.5) * 0.6;
    let best = null;
    // spiral out from the ideal point until we find solid ground
    for (let r = 0; r < 60 && !best; r += 2) {
      for (let k = 0; k < 12; k++) {
        const b = (k / 12) * Math.PI * 2;
        const tx = Math.round(Math.cos(a) * dists[i] + Math.cos(b) * r);
        const ty = Math.round(Math.sin(a) * dists[i] + Math.sin(b) * r);
        let ok = true;
        for (let y = -3; y <= 3 && ok; y += 3) for (let x = -3; x <= 3 && ok; x += 3) {
          const tt = genTile(tx + x, ty + y);
          if (tt === T.DEEP || tt === T.WATER || tt === T.ICE) ok = false;
        }
        if (ok) { best = { tx, ty }; break; }
      }
    }
    if (!best) best = { tx: Math.round(Math.cos(a) * dists[i]), ty: Math.round(Math.sin(a) * dists[i]) };
    World.shrines.push({ ...best, x: best.tx * TILE + TILE / 2, y: best.ty * TILE + TILE / 2, level: i, claimed: false, seen: false, awake: false });
  }
}

// ---------------------------------------------------------------- rendering
const TILE_RGB = TILES.map((t) => hexRgb(t.color));

function renderMini(ch) {
  const c = makeCanvas(CS, CS);
  const g = c.getContext('2d');
  const img = g.createImageData(CS, CS);
  for (let i = 0; i < CS * CS; i++) {
    const [r, gg, b] = TILE_RGB[ch.tiles[i]];
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // trees darken the map a touch
  g.fillStyle = 'rgba(20,40,20,0.45)';
  for (const o of ch.objs) if (o.type === 'tree' || o.type === 'pine') g.fillRect(o.tx - ch.cx * CS, o.ty - ch.cy * CS, 1, 1);
  return c;
}

const EDGE_PRIORITY = [0, 1, 6, 4, 6, 3, 8, 5, 7, 2, 9];

function renderChunk(ch) {
  const c = makeCanvas(CHUNK_PX, CHUNK_PX);
  const g = c.getContext('2d');
  const S = World.seed;
  const ox = ch.cx * CS, oy = ch.cy * CS;
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    const tx = ox + x, ty = oy + y;
    const t = ch.tiles[y * CS + x];
    const px = x * TILE, py = y * TILE;
    const h = hash2(tx, ty, S + 21);
    g.fillStyle = shade(TILES[t].color, (h - 0.5) * 0.08);
    g.fillRect(px, py, TILE, TILE);
    drawTileDetail(g, t, px, py, tx, ty);
  }
  // soft dithered borders between biomes and wet shorelines
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    const tx = ox + x, ty = oy + y;
    const t = ch.tiles[y * CS + x];
    const px = x * TILE, py = y * TILE;
    const nb = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i++) {
      const nx = x + nb[i][0], ny = y + nb[i][1];
      const n = nx >= 0 && ny >= 0 && nx < CS && ny < CS ? ch.tiles[ny * CS + nx] : tileAt(tx + nb[i][0], ty + nb[i][1]);
      if (n === t) continue;
      const waterSide = TILES[t].water || t === T.DEEP;
      const nWater = TILES[n].water || n === T.DEEP;
      if (!waterSide && nWater) {
        g.fillStyle = 'rgba(40,60,50,0.28)';
        edgeStrip(g, i, px, py, 4);
        continue;
      }
      if (waterSide && !nWater && n !== T.ICE) {
        g.fillStyle = 'rgba(230,245,255,0.45)';
        edgeStrip(g, i, px, py, 2);
        continue;
      }
      if (EDGE_PRIORITY[n] > EDGE_PRIORITY[t]) {
        g.fillStyle = TILES[n].color;
        for (let k = 0; k < 8; k++) {
          const along = Math.floor(hash2(tx * 4 + k, ty * 4 + i, S + 31) * 8) * 4;
          const depth = Math.floor(hash2(tx * 4 + k, ty * 4 + i, S + 37) * 3) * 4;
          if (i === 0) g.fillRect(px + along, py + depth * 0.5, 4, 4);
          else if (i === 2) g.fillRect(px + along, py + TILE - 4 - depth * 0.5, 4, 4);
          else if (i === 1) g.fillRect(px + TILE - 4 - depth * 0.5, py + along, 4, 4);
          else g.fillRect(px + depth * 0.5, py + along, 4, 4);
        }
      }
    }
  }
  ch.canvas = c;
  World.canvasCount++;
}

function edgeStrip(g, side, px, py, w) {
  if (side === 0) g.fillRect(px, py, TILE, w);
  else if (side === 2) g.fillRect(px, py + TILE - w, TILE, w);
  else if (side === 1) g.fillRect(px + TILE - w, py, w, TILE);
  else g.fillRect(px, py, w, TILE);
}

function drawTileDetail(g, t, px, py, tx, ty) {
  const S = World.seed;
  const r = (k) => hash2(tx * 7 + k, ty * 13 - k, S + 101 + k);
  switch (t) {
    case T.GRASS:
    case T.FOREST: {
      g.fillStyle = t === T.GRASS ? '#5a9443' : '#336b31';
      for (let k = 0; k < 6; k++) g.fillRect(px + Math.floor(r(k) * 15) * 2, py + Math.floor(r(k + 9) * 15) * 2, 2, 4);
      g.fillStyle = t === T.GRASS ? '#7dbb5e' : '#4b8c43';
      for (let k = 0; k < 4; k++) g.fillRect(px + Math.floor(r(k + 20) * 15) * 2, py + Math.floor(r(k + 30) * 15) * 2, 2, 2);
      if (t === T.GRASS && r(50) < 0.12) {
        g.fillStyle = ['#f2e86d', '#f29fd1', '#ffffff', '#9fc8f2'][Math.floor(r(51) * 4)];
        const fx = px + 6 + Math.floor(r(52) * 10) * 2, fy = py + 6 + Math.floor(r(53) * 10) * 2;
        g.fillRect(fx, fy, 2, 2); g.fillRect(fx + 4, fy + 2, 2, 2); g.fillRect(fx + 1, fy + 5, 2, 2);
      }
      if (t === T.FOREST && r(60) < 0.15) {
        g.fillStyle = '#6b5a2e';
        g.fillRect(px + Math.floor(r(61) * 12) * 2, py + Math.floor(r(62) * 12) * 2, 4, 2);
      }
      break;
    }
    case T.SAND:
    case T.DESERT: {
      g.fillStyle = t === T.SAND ? '#c9b37b' : '#cf9f55';
      for (let k = 0; k < 5; k++) g.fillRect(px + Math.floor(r(k) * 15) * 2, py + Math.floor(r(k + 9) * 15) * 2, 2, 2);
      if (t === T.DESERT && r(40) < 0.25) {
        g.fillStyle = 'rgba(160,110,50,0.35)';
        g.fillRect(px + 2, py + 8 + Math.floor(r(41) * 8) * 2, TILE - 6, 2);
      }
      if (t === T.DESERT && r(42) < 0.03) {
        g.fillStyle = '#f2ead8';
        const bx = px + 8, by = py + 12;
        g.fillRect(bx, by, 12, 2); g.fillRect(bx + 2, by - 2, 2, 6); g.fillRect(bx + 8, by - 2, 2, 6);
      }
      if (t === T.SAND && r(43) < 0.05) {
        g.fillStyle = '#f5d9cf';
        g.fillRect(px + 10 + Math.floor(r(44) * 6) * 2, py + 12, 4, 3);
      }
      break;
    }
    case T.SNOW: {
      g.fillStyle = '#cfdde6';
      for (let k = 0; k < 4; k++) g.fillRect(px + Math.floor(r(k) * 15) * 2, py + Math.floor(r(k + 9) * 15) * 2, 4, 2);
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 3; k++) g.fillRect(px + Math.floor(r(k + 30) * 15) * 2, py + Math.floor(r(k + 40) * 15) * 2, 2, 2);
      break;
    }
    case T.SWAMP: {
      if (r(1) < 0.35) {
        g.fillStyle = '#3a5a52';
        g.fillRect(px + 4 + Math.floor(r(2) * 6) * 2, py + 6 + Math.floor(r(3) * 6) * 2, 12, 8);
        g.fillStyle = '#4c7268';
        g.fillRect(px + 6 + Math.floor(r(2) * 6) * 2, py + 8 + Math.floor(r(3) * 6) * 2, 4, 2);
      }
      g.fillStyle = '#5f7d4e';
      for (let k = 0; k < 4; k++) g.fillRect(px + Math.floor(r(k + 5) * 15) * 2, py + Math.floor(r(k + 15) * 15) * 2, 2, 4);
      break;
    }
    case T.ROCKY: {
      g.fillStyle = '#7a7468';
      for (let k = 0; k < 5; k++) g.fillRect(px + Math.floor(r(k) * 14) * 2, py + Math.floor(r(k + 9) * 14) * 2, 4, 4);
      g.fillStyle = '#9b958a';
      for (let k = 0; k < 3; k++) g.fillRect(px + Math.floor(r(k + 30) * 15) * 2, py + Math.floor(r(k + 40) * 15) * 2, 2, 2);
      break;
    }
    case T.ICE: {
      g.fillStyle = '#c4e4f2';
      if (r(1) < 0.4) g.fillRect(px + 4, py + 6 + Math.floor(r(2) * 8) * 2, 18, 2);
      g.fillStyle = '#8fc0d8';
      if (r(3) < 0.3) g.fillRect(px + 10, py + 2 + Math.floor(r(4) * 10) * 2, 2, 10);
      break;
    }
    case T.RUIN: {
      g.fillStyle = '#625f58';
      g.fillRect(px, py, TILE, 2); g.fillRect(px, py, 2, TILE);
      g.fillRect(px + 16, py, 2, 16);
      g.fillStyle = '#8a857b';
      if (r(1) < 0.3) g.fillRect(px + 6, py + 20, 6, 4);
      break;
    }
    case T.WATER:
    case T.DEEP: {
      g.fillStyle = t === T.DEEP ? '#1a4670' : '#3584b5';
      for (let k = 0; k < 2; k++) g.fillRect(px + Math.floor(r(k) * 12) * 2, py + Math.floor(r(k + 9) * 14) * 2, 8, 2);
      break;
    }
  }
}
