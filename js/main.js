'use strict';
// Boot, main loop, saving and the first-time survival tips.

const SAVE_KEY = 'emberwild-save-v1';
let lastFrame = 0, autosave = 20, tipTimer = 1;

const TIPS = [
  { id: 'start', when: () => true, text: () => 'Strike trees for wood. Grab fiber and stones with ' + (Input.touch ? 'the Use button' : 'E') + '.' },
  { id: 'axe', when: () => countOf('wood') >= 3 && countOf('stone') >= 3 && countOf('fiber') >= 2 && !bestTool('axe'), text: () => 'You can craft a Stone Axe. Open crafting with ' + (Input.touch ? 'the Craft button' : 'C') + '.' },
  { id: 'fire', when: () => Game.time > 0.45 && !World.structs.some((s) => s.type === 'campfire'), text: () => 'Night comes fast. A Campfire needs 6 wood and 4 stone, and beasts fear it.' },
  { id: 'food', when: () => Game.player.food < 55, text: () => 'Hungry. Berries, hares and deer will feed you.' },
  { id: 'water', when: () => Game.player.water < 55, text: () => 'Thirsty. Stand at the water\'s edge and press ' + (Input.touch ? 'Use' : 'E') + ' to drink.' },
  { id: 'meat', when: () => countOf('meat') > 0, text: () => 'Cook raw meat by a lit fire from the crafting menu.' },
  { id: 'cold', when: () => Game.player.warm < 55, text: () => 'You are freezing. Stay near fire or craft a Fur Coat at a workbench.' },
  { id: 'hide', when: () => countOf('hide') >= 2, text: () => 'Hide makes waterskins, coats and bedrolls at a Workbench.' },
  { id: 'shrine', when: () => World.shrines.some((s) => s.seen), text: () => 'Follow the violet marker. Each stone circle hides a Shard and its guardian.' },
  { id: 'iron', when: () => World.shrines.some((s) => s.claimed), text: () => 'Iron ore hides in highlands and tundra. Moon crystal needs an Iron Pickaxe.' },
  { id: 'beacon', when: () => countOf('shard') >= 3, text: () => 'Three shards. Forge The Beacon at a workbench, fortify, then light it.' },
];
let tipsShown = new Set();

function boot() {
  buildSprites();
  initView($('view'));
  Input.init();
  UI.init();
  resetWorld(Math.floor(Math.random() * 1e9));
  Game.state = 'title';
  // nudge the title camera off the beach so the panorama has some land in it
  Game.cam.x = Game.player.x - 200; Game.cam.y = Game.player.y;
  const save = loadSave();
  $('btnContinue').hidden = !save;
  if (save) $('continueNote').textContent = 'Day ' + save.day + ' · ' + save.shrines.filter((s) => s.claimed).length + ' of 3 shards';
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => { if (document.hidden && Game.state === 'play') saveGame(); });
  window.addEventListener('beforeunload', () => { if (Game.state === 'play' || Game.state === 'paused') saveGame(); });
  try { window.claude && window.claude.hot && window.claude.hot.snapshot && window.claude.hot.snapshot(() => (Game.state === 'title' ? {} : { save: serialize() })); } catch (e) { /* not in a viewer */ }
}

function loop(ts) {
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0.016);
  lastFrame = ts;
  if (Game.state === 'play') {
    update(dt);
    autosave -= dt;
    if (autosave <= 0) { autosave = 25; saveGame(); }
    tipTimer -= dt;
    if (tipTimer <= 0) { tipTimer = 1.5; checkTips(); }
  } else if (Game.state === 'title' || Game.state === 'dead' || Game.state === 'won') {
    // the world keeps breathing behind menus
    for (const q of Game.particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; }
    Game.particles = Game.particles.filter((q) => q.life > 0);
    if (Game.state === 'title') Game.time = 0.3 + Math.sin(ts / 30000) * 0.05;
  }
  render(dt);
  UI.update(dt);
  requestAnimationFrame(loop);
}

function checkTips() {
  for (const t of TIPS) {
    if (tipsShown.has(t.id)) continue;
    if (t.when()) { tipsShown.add(t.id); UI.toast(t.text(), 'tip'); return; }
  }
}

function startNewGame() {
  resetWorld(Math.floor(Math.random() * 1e9));
  tipsShown = new Set();
  Game.state = 'play';
  $('screen-title').hidden = true;
  document.body.classList.add('playing');
  UI.dirty = true;
  UI.toast('You wash ashore with nothing. Three Ancient Shards lie in the stone circles of this land.', 'gold');
  setTimeout(() => UI.toast('Forge them into The Beacon and survive its last night to be rescued.', 'gold'), 2500);
  tipTimer = 5;
  saveGame();
}

function continueGame() {
  const s = loadSave();
  if (!s) return startNewGame();
  applySave(s);
  Game.state = 'play';
  $('screen-title').hidden = true;
  document.body.classList.add('playing');
  UI.dirty = true;
  UI.toast('Day ' + Game.day + '. The wilds remember you.', 'gold');
}

function toTitle() {
  $('screen-pause').hidden = true;
  Game.state = 'title';
  document.body.classList.remove('playing');
  $('screen-title').hidden = false;
  const s = loadSave();
  $('btnContinue').hidden = !s;
  if (s) $('continueNote').textContent = 'Day ' + s.day + ' · ' + s.shrines.filter((x) => x.claimed).length + ' of 3 shards';
}

// ---------------------------------------------------------------- persistence
function serialize() {
  const p = Game.player;
  return {
    v: 1, seed: World.seed, time: Game.time, day: Game.day,
    p: { x: p.x, y: p.y, hp: p.hp, food: p.food, water: p.water, warm: p.warm, stam: p.stam, dead: p.dead },
    pouch: Game.pouch, kit: Game.kit, hotbar: Game.hotbar, sel: Game.sel, armor: Game.armor, spawn: Game.spawn,
    removed: [...World.removed.entries()].filter(([, v]) => v > Game.worldDays()),
    structs: World.structs.map((s) => ({ type: s.type, x: s.x, y: s.y, tx: s.tx, ty: s.ty, hp: s.hp, fuel: s.fuel === Infinity ? -1 : s.fuel, lit: s.lit && !(s.type === 'beacon'), loot: s.loot })),
    shrines: World.shrines.map((s) => ({ claimed: s.claimed, seen: s.seen })),
    explored: [...World.minis.keys()],
    stats: Game.stats, won: Game.won, weather: { rain: Game.weather.rain, target: Game.weather.target, timer: Game.weather.timer },
    tips: [...tipsShown],
  };
}

function saveGame() {
  if (Game.state === 'title' || !Game.player) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) { /* storage unavailable */ }
}

function loadSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

function applySave(s) {
  resetWorld(s.seed);
  Game.time = s.time; Game.day = s.day;
  Object.assign(Game.player, s.p);
  if (Game.player.dead) { Game.player.dead = false; Game.player.hp = 60; }
  Game.cam.x = Game.player.x; Game.cam.y = Game.player.y;
  Game.pouch = s.pouch || {};
  Game.kit = s.kit || {};
  Game.hotbar = (s.hotbar || []).slice(0, HOTBAR);
  while (Game.hotbar.length < HOTBAR) Game.hotbar.push(null);
  Game.sel = s.sel || 0; Game.armor = s.armor || null;
  Game.spawn = s.spawn || Game.spawn;
  for (const [k, v] of s.removed || []) World.removed.set(k, v);
  for (const st of s.structs || []) {
    const o = addStruct({ type: st.type, x: st.x, y: st.y, tx: st.tx, ty: st.ty, hp: st.hp, lit: st.lit, fuel: st.fuel === -1 ? Infinity : st.fuel, loot: st.loot });
    if (o.type === 'brazier') { o.lit = true; o.fuel = Infinity; }
  }
  (s.shrines || []).forEach((sh, i) => { if (World.shrines[i]) Object.assign(World.shrines[i], sh); });
  Game.stats = Object.assign(Game.stats, s.stats || {});
  Game.won = !!s.won;
  if (s.weather) Object.assign(Game.weather, s.weather);
  tipsShown = new Set(s.tips || []);
  // rebuild the explored map a few chunks at a time
  const queue = (s.explored || []).slice();
  const step = () => {
    for (let i = 0; i < 12 && queue.length; i++) {
      const [cx, cy] = queue.shift().split(',').map(Number);
      const k = chunkKey(cx, cy);
      if (!World.minis.has(k)) { const d = genChunkData(cx, cy); World.minis.set(k, renderMini({ cx, cy, tiles: d.tiles, objs: d.objs })); }
    }
    if (queue.length) setTimeout(step, 16);
  };
  step();
}

function bootWhenReady() {
  const hot = window.claude && window.claude.hot;
  const start = (data) => {
    boot();
    if (data && data.save) {
      applySave(data.save);
      Game.state = 'play';
      $('screen-title').hidden = true;
      document.body.classList.add('playing');
      UI.dirty = true;
    }
  };
  if (hot && hot.ready) hot.ready(start);
  else start(hot && hot.data ? hot.data : {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootWhenReady);
else bootWhenReady();
