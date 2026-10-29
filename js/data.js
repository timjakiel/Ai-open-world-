'use strict';
// Static game data: tiles, world objects, items, recipes, creatures.

const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, DESERT: 5, SNOW: 6, SWAMP: 7, ROCKY: 8, ICE: 9, RUIN: 10 };

const TILES = [
  { name: 'Deep Water', color: '#1d4e7a', solid: true, temp: 0 },
  { name: 'Shallows', color: '#2f78a8', slow: 0.55, water: true, temp: -0.2 },
  { name: 'Beach', color: '#d9c48e', temp: 0.2 },
  { name: 'Meadow', color: '#6aa84f', temp: 0 },
  { name: 'Forest', color: '#3f7d3a', temp: -0.1 },
  { name: 'Desert', color: '#e0b46a', temp: 1.4, hot: true },
  { name: 'Tundra', color: '#e6eef2', temp: -2 },
  { name: 'Swamp', color: '#4f6b45', slow: 0.8, temp: -0.2 },
  { name: 'Highlands', color: '#8a8478', temp: -0.6 },
  { name: 'Frozen Lake', color: '#a9d3e6', temp: -2.2, slippery: true },
  { name: 'Ancient Ruins', color: '#77736b', temp: -0.3 },
];

// World objects that grow out of the land. tool: what is needed to harvest, tier: minimum tool tier.
const OBJ = {
  tree:     { hp: 6,  r: 11, solid: true, tool: 'axe', drops: { wood: [3, 5], fiber: [0, 1] }, regrow: 2.5, hit: 'chop' },
  pine:     { hp: 6,  r: 11, solid: true, tool: 'axe', drops: { wood: [3, 5] }, regrow: 2.5, hit: 'chop' },
  palm:     { hp: 4,  r: 9,  solid: true, tool: 'axe', drops: { wood: [2, 3], fiber: [1, 2] }, regrow: 2, hit: 'chop' },
  deadtree: { hp: 3,  r: 9,  solid: true, tool: 'axe', drops: { wood: [1, 3] }, regrow: 3, hit: 'chop' },
  rock:     { hp: 7,  r: 13, solid: true, tool: 'pick', tier: 1, drops: { stone: [3, 5] }, regrow: 4, hit: 'mine' },
  iron:     { hp: 10, r: 13, solid: true, tool: 'pick', tier: 1, drops: { iron: [2, 3], stone: [1, 2] }, regrow: 6, hit: 'mine' },
  crystal:  { hp: 14, r: 11, solid: true, tool: 'pick', tier: 2, drops: { crystal: [1, 2] }, regrow: 8, hit: 'mine' },
  cactus:   { hp: 3,  r: 9,  solid: true, tool: 'any', drops: { cactus: [1, 2] }, regrow: 2, hit: 'chop', thorns: 3 },
  bush:     { hp: 1,  r: 8,  pick: true, drops: { fiber: [2, 3] }, regrow: 1, hit: 'leaf', label: 'Gather fiber' },
  berry:    { hp: 1,  r: 9,  pick: true, drops: { berry: [2, 4] }, regrow: 1.5, hit: 'leaf', label: 'Pick berries' },
  reeds:    { hp: 1,  r: 7,  pick: true, drops: { fiber: [2, 4] }, regrow: 1, hit: 'leaf', label: 'Cut reeds' },
  mushroom: { hp: 1,  r: 6,  pick: true, drops: { mushroom: [1, 2] }, regrow: 2, hit: 'leaf', label: 'Pick mushrooms' },
  flint:    { hp: 1,  r: 6,  pick: true, drops: { stone: [1, 2] }, regrow: 2, hit: 'mine', label: 'Pick up stones' },
};

const ITEMS = {
  // materials live in the pouch
  wood:     { name: 'Wood', kind: 'mat' },
  stone:    { name: 'Stone', kind: 'mat' },
  fiber:    { name: 'Plant Fiber', kind: 'mat' },
  iron:     { name: 'Iron Ore', kind: 'mat' },
  crystal:  { name: 'Moon Crystal', kind: 'mat' },
  hide:     { name: 'Hide', kind: 'mat' },
  shard:    { name: 'Ancient Shard', kind: 'mat' },
  // usables live in the hotbar
  berry:    { name: 'Berries', kind: 'food', food: 9, water: 4 },
  mushroom: { name: 'Glowcap', kind: 'food', food: 6, stamina: 40, hp: -3 },
  cactus:   { name: 'Cactus Flesh', kind: 'food', food: 4, water: 18 },
  meat:     { name: 'Raw Meat', kind: 'food', food: 12, hp: -6 },
  cooked:   { name: 'Roast Meat', kind: 'food', food: 35, hp: 6 },
  stew:     { name: 'Hearty Stew', kind: 'food', food: 55, water: 20, hp: 35 },
  bandage:  { name: 'Bandage', kind: 'heal', hp: 30 },
  waterskin:{ name: 'Waterskin', kind: 'water', sips: 5 },
  torch:    { name: 'Torch', kind: 'torch', dmg: 7, desc: 'Hold it to light the way.' },
  axe1:     { name: 'Stone Axe', kind: 'tool', tool: 'axe', tier: 1, power: 2, dmg: 11 },
  pick1:    { name: 'Stone Pickaxe', kind: 'tool', tool: 'pick', tier: 1, power: 2, dmg: 9 },
  sword1:   { name: 'Flint Blade', kind: 'weapon', dmg: 18 },
  axe2:     { name: 'Iron Axe', kind: 'tool', tool: 'axe', tier: 2, power: 4, dmg: 16 },
  pick2:    { name: 'Iron Pickaxe', kind: 'tool', tool: 'pick', tier: 2, power: 4, dmg: 13 },
  sword2:   { name: 'Iron Sword', kind: 'weapon', dmg: 32 },
  bow:      { name: 'Hunting Bow', kind: 'bow', desc: 'Fires arrows where you aim.' },
  arrow:    { name: 'Arrows', kind: 'ammo' },
  hide_armor:{ name: 'Fur Coat', kind: 'armor', armor: 0.25, warm: 1.6, desc: 'Cuts damage by a quarter and keeps out the cold.' },
  iron_armor:{ name: 'Iron Mail', kind: 'armor', armor: 0.5, warm: 0.6, desc: 'Halves incoming damage.' },
  campfire: { name: 'Campfire', kind: 'place', struct: 'campfire', desc: 'Light, warmth, cooking. Beasts fear it.' },
  wall:     { name: 'Log Wall', kind: 'place', struct: 'wall' },
  spikes:   { name: 'Spike Trap', kind: 'place', struct: 'spikes' },
  workbench:{ name: 'Workbench', kind: 'place', struct: 'workbench', desc: 'Unlocks advanced recipes nearby.' },
  brazier:  { name: 'Brazier', kind: 'place', struct: 'brazier', desc: 'A fire that never goes out.' },
  bed:      { name: 'Bedroll', kind: 'place', struct: 'bed', desc: 'Sets your respawn. Sleep through the night.' },
  beacon:   { name: 'The Beacon', kind: 'place', struct: 'beacon', desc: 'Light it and survive until dawn to be rescued.' },
};

// station: null (anywhere), 'fire' (near a lit campfire or brazier), 'bench' (near a workbench)
const RECIPES = [
  { out: 'axe1', cost: { wood: 3, stone: 3, fiber: 2 } },
  { out: 'pick1', cost: { wood: 3, stone: 3, fiber: 2 } },
  { out: 'sword1', cost: { wood: 2, stone: 5, fiber: 2 } },
  { out: 'torch', n: 2, cost: { wood: 2, fiber: 2 } },
  { out: 'campfire', cost: { wood: 6, stone: 4 } },
  { out: 'bandage', cost: { fiber: 5 } },
  { out: 'arrow', n: 6, cost: { wood: 2, stone: 2, fiber: 1 } },
  { out: 'wall', n: 2, cost: { wood: 5 } },
  { out: 'workbench', cost: { wood: 12, stone: 6 } },
  { out: 'cooked', cost: { meat: 1 }, station: 'fire' },
  { out: 'stew', cost: { cooked: 1, mushroom: 1, berry: 3 }, station: 'fire' },
  { out: 'waterskin', cost: { hide: 2, fiber: 3 }, station: 'bench' },
  { out: 'bow', cost: { wood: 5, fiber: 6 }, station: 'bench' },
  { out: 'spikes', cost: { wood: 4, stone: 3 }, station: 'bench' },
  { out: 'hide_armor', cost: { hide: 6, fiber: 6 }, station: 'bench' },
  { out: 'bed', cost: { wood: 10, hide: 3, fiber: 8 }, station: 'bench' },
  { out: 'brazier', cost: { stone: 8, wood: 4, iron: 2 }, station: 'bench' },
  { out: 'axe2', cost: { wood: 3, iron: 4 }, station: 'bench' },
  { out: 'pick2', cost: { wood: 3, iron: 4 }, station: 'bench' },
  { out: 'sword2', cost: { wood: 2, iron: 6, crystal: 1 }, station: 'bench' },
  { out: 'iron_armor', cost: { iron: 10, hide: 4 }, station: 'bench' },
  { out: 'beacon', cost: { shard: 3, crystal: 3, iron: 6, wood: 10 }, station: 'bench' },
];

const STRUCTS = {
  campfire:  { r: 12, solid: true, hp: 80, light: 300, fire: true, fuel: 240 },
  brazier:   { r: 12, solid: true, hp: 200, light: 340, fire: true },
  wall:      { box: true, solid: true, hp: 160 },
  spikes:    { r: 14, hp: 70, flat: true },
  workbench: { r: 15, solid: true, hp: 120 },
  bed:       { r: 14, hp: 60, flat: true },
  beacon:    { r: 18, solid: true, hp: 700, light: 200 },
  grave:     { r: 10, hp: 9999, flat: true },
};

const MOBS = {
  rabbit:   { name: 'Hare', hp: 8, speed: 165, r: 7, behav: 'flee', drops: { meat: 1 } },
  deer:     { name: 'Deer', hp: 24, speed: 185, r: 12, behav: 'flee', drops: { meat: 2, hide: 1 } },
  boar:     { name: 'Boar', hp: 42, speed: 135, r: 12, behav: 'neutral', dmg: 10, drops: { meat: 3, hide: 1 } },
  wolf:     { name: 'Wolf', hp: 34, speed: 160, r: 11, behav: 'hostile', aggro: 250, dmg: 8, drops: { meat: 1, hide: 2 } },
  bear:     { name: 'Bear', hp: 110, speed: 125, r: 17, behav: 'hostile', aggro: 170, dmg: 22, drops: { meat: 4, hide: 3 } },
  scorpion: { name: 'Scorpion', hp: 28, speed: 130, r: 10, behav: 'hostile', aggro: 190, dmg: 11, drops: { meat: 1 } },
  bogling:  { name: 'Bogling', hp: 30, speed: 105, r: 11, behav: 'hostile', aggro: 210, dmg: 9, drops: { mushroom: 1, fiber: 2 } },
  shade:    { name: 'Shade', hp: 36, speed: 140, r: 11, behav: 'hostile', aggro: 700, dmg: 12, night: true, drops: { crystal: 0.2 } },
  guardian: { name: 'Stone Guardian', hp: 260, speed: 105, r: 24, behav: 'boss', dmg: 24, drops: { shard: 1, stone: 8 } },
  hollow:   { name: 'The Hollow King', hp: 700, speed: 115, r: 30, behav: 'boss', dmg: 30, night: true, drops: { crystal: 5 } },
};

// creature spawn weights per tile type (day)
const SPAWNS = {
  [T.GRASS]:  { rabbit: 5, deer: 3, boar: 2, wolf: 0.6 },
  [T.FOREST]: { rabbit: 2, deer: 3, boar: 2, wolf: 2, bear: 0.7 },
  [T.SNOW]:   { rabbit: 2, wolf: 3, bear: 1.2 },
  [T.ICE]:    { wolf: 1 },
  [T.DESERT]: { scorpion: 3, rabbit: 0.5 },
  [T.SWAMP]:  { bogling: 3, boar: 1 },
  [T.SAND]:   { rabbit: 1 },
  [T.ROCKY]:  { wolf: 1, boar: 1 },
};
