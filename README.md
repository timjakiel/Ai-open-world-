# Emberwild

An open-world survival game that runs in the browser. No build step, no dependencies.

You wash ashore on an endless, procedurally generated wild. Keep yourself fed, watered and warm, survive the nights, and hunt down the three stone circles that each hold an Ancient Shard and the Stone Guardian protecting it. Forge the shards into **The Beacon**, light it, and hold out until dawn against everything the dark throws at you.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Progress autosaves to your browser.

### Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD / arrows | Drag on the left side |
| Sprint | Shift | Push the stick to the edge |
| Strike / use selected item | Left click or Space | **Strike** button |
| Pick up, drink, refuel, sleep, interact | E or right click | **Use** button |
| Select hotbar slot | 1–8 or mouse wheel | Tap a slot |
| Crafting | C | **Craft** |
| Map | M | **Map** |
| Drop selected | Q | — |
| Pause | Esc | **II** |

## What's in it

- **Infinite procedural world**: meadows, forests, swamps, deserts, tundra with frozen lakes, highlands, beaches, rivers and seas, generated from a seed and streamed in chunks.
- **Survival**: health, hunger, thirst, warmth and stamina. Deserts dry you out, tundra and nights freeze you, rain chills you and puts out fires faster.
- **Day and night**: real-time lighting with torches, campfires, braziers, glowing mushrooms and moon crystals. Every fifth night is a **Blood Moon**.
- **Creatures**: hares, deer and boar to hunt; wolves (in packs at night), bears, scorpions and boglings that hunt you; shades that only walk at night and burn at sunrise. Beasts fear fire.
- **Crafting and building**: 22 recipes across hand, fire and workbench stations. Stone and iron tools, bow and arrows, fur coat and iron mail, waterskins, bandages, stew, log walls, spike traps, bedrolls and braziers.
- **Bosses**: three Stone Guardians that slam and hurl boulders, and the Hollow King who comes for the Beacon.
- **Death has weight**: you drop everything in a grave you can walk back to and loot.
- Minimap with fog of war, full map, weather (rain, snow, thunderstorms), synthesized sound.

## Code layout

| File | What it does |
| --- | --- |
| `js/util.js` | Constants, seeded noise, math helpers |
| `js/data.js` | Tiles, world objects, items, recipes, creatures |
| `js/world.js` | Terrain and biome generation, chunks, structures, shrines |
| `js/sprites.js` | Pre-rendered sprites and item icons |
| `js/game.js` | Simulation: player, survival, AI, combat, crafting, building |
| `js/render.js` | Canvas renderer: terrain, y-sorted world, lighting, weather |
| `js/ui.js` | Input and HUD |
| `js/audio.js` | WebAudio sound effects |
| `js/main.js` | Boot, loop, saving, tips |
