'use strict';
// 3D renderer (Three.js r128): low-poly terrain chunks, instanced vegetation, creatures,
// structures, dynamic lights, sky, weather and a third-person orbit camera.
// The simulation stays in world pixels (a 32px tile); here 1px = 1/16 m, so a tile is 2 m.

const PX = 1 / 16;
const View = {
  is3D: true, canvas: null, W: 0, H: 0, dpr: 1, clock: 0,
  yaw: -Math.PI / 2, pitch: 0.6, dist: 10.5, viewR: 4, objR: 3,
  slowFrames: 0, lowQuality: false,
};

let R3 = null; // renderer internals

// ------------------------------------------------------------------ terrain height
const smooth01 = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function rawHeight(tx, ty) {
  const { e, t, d } = terrainAt(tx, ty);
  let h = (e - 0.325) * 34;
  if (e > 0.6) h += (e - 0.6) * (e - 0.6) * 140;
  const river = Math.abs(fbm(tx / 130, ty / 130, World.seed + 333, 3) - 0.5);
  if (river < 0.03 && e < 0.7) h = Math.min(h, lerp(-0.9, h, smooth01(0.011, 0.03, river)));
  if (t < 0.27 && d > 30 && h < 0.08) h = 0.08;
  return h;
}

function heightM(tx, ty) {
  let h = rawHeight(tx, ty);
  for (const sh of World.shrines) {
    const dx = tx - sh.tx, dy = ty - sh.ty;
    const d2 = dx * dx + dy * dy;
    if (d2 > 64) continue;
    if (sh.h3 === undefined) sh.h3 = Math.max(0.3, rawHeight(sh.tx, sh.ty));
    h = lerp(sh.h3, h, smooth01(4.2, 8, Math.sqrt(d2)));
  }
  return h;
}

// height in metres at a world-pixel position, matching the rendered triangles exactly
function heightAt(x, y) {
  const tx = x / TILE, ty = y / TILE;
  const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS);
  const ch = World.chunks.get(chunkKey(cx, cy));
  const ix = Math.floor(tx), iy = Math.floor(ty);
  const fx = tx - ix, fy = ty - iy;
  let h00, h10, h01, h11;
  if (ch && ch.h) {
    const N = CS + 1, li = ix - cx * CS, lj = iy - cy * CS;
    h00 = ch.h[lj * N + li]; h10 = ch.h[lj * N + li + 1]; h01 = ch.h[(lj + 1) * N + li]; h11 = ch.h[(lj + 1) * N + li + 1];
  } else {
    h00 = heightM(ix, iy); h10 = heightM(ix + 1, iy); h01 = heightM(ix, iy + 1); h11 = heightM(ix + 1, iy + 1);
  }
  if (fx + fy < 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fy;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fy);
}

// ------------------------------------------------------------------ geometry helpers
const _c = new THREE.Color();
const MATS = {};
function lam(color, extra) {
  const k = color + (extra ? JSON.stringify(extra) : '');
  if (!MATS[k]) MATS[k] = new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
  return MATS[k];
}

// collect primitive parts with colours and bake them into one non-indexed geometry
function bake(parts) {
  let total = 0;
  const geos = parts.map(([geo, color, pos, rot, scl, jitter]) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(pos || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))),
      new THREE.Vector3(...(scl || [1, 1, 1])));
    g.applyMatrix4(m);
    if (jitter) {
      const p = g.attributes.position, rng = mulberry32(jitter * 9973);
      const seen = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
        if (!seen.has(key)) seen.set(key, [(rng() - 0.5) * jitter * 0.01, (rng() - 0.5) * jitter * 0.01, (rng() - 0.5) * jitter * 0.01]);
        const j = seen.get(key);
        p.setXYZ(i, p.getX(i) + j[0], p.getY(i) + j[1], p.getZ(i) + j[2]);
      }
    }
    total += g.attributes.position.count;
    return [g, color];
  });
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const [g, color] of geos) {
    pos.set(g.attributes.position.array, o * 3);
    _c.set(color);
    for (let i = 0; i < g.attributes.position.count; i++) { col[(o + i) * 3] = _c.r; col[(o + i) * 3 + 1] = _c.g; col[(o + i) * 3 + 2] = _c.b; }
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

const G = {};
function prims() {
  G.box = new THREE.BoxGeometry(1, 1, 1);
  G.cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6);
  G.cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
  G.cone6 = new THREE.ConeGeometry(1, 1, 6);
  G.cone8 = new THREE.ConeGeometry(1, 1, 8);
  G.ico = new THREE.IcosahedronGeometry(1, 0);
  G.ico1 = new THREE.IcosahedronGeometry(1, 1);
  G.dodo = new THREE.DodecahedronGeometry(1, 0);
  G.oct = new THREE.OctahedronGeometry(1, 0);
  G.sph = new THREE.SphereGeometry(1, 8, 6);
  G.hemi = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
}

function objectGeometries() {
  const O = {};
  O.tree = bake([
    [G.cyl6, '#5b3d22', [0, 1.4, 0], 0, [0.28, 2.8, 0.28]],
    [G.ico, '#2f6b2c', [0, 3.6, 0], 0, [1.9, 1.7, 1.9], 22],
    [G.ico, '#3f8a37', [0.7, 4.3, 0.4], 0, [1.3, 1.2, 1.3], 15],
    [G.ico, '#4f9a40', [-0.5, 4.9, -0.3], 0, [1.1, 1.0, 1.1], 12],
  ]);
  O.pine = bake([
    [G.cyl6, '#4a311b', [0, 0.8, 0], 0, [0.22, 1.6, 0.22]],
    [G.cone6, '#1f4d3a', [0, 2.3, 0], 0, [1.7, 2.4, 1.7]],
    [G.cone6, '#28604a', [0, 3.6, 0], 0, [1.3, 2.0, 1.3]],
    [G.cone6, '#327258', [0, 4.7, 0], 0, [0.9, 1.7, 0.9]],
    [G.cone6, '#e9f1f5', [0, 5.35, 0], 0, [0.42, 0.6, 0.42]],
  ]);
  const palmParts = [];
  for (let i = 0; i < 6; i++) palmParts.push([G.cyl6, '#8a6a3c', [Math.sin(i * 0.35) * 0.35 * i * 0.3, 0.45 + i * 0.75, 0], [0, 0, -i * 0.05], [0.2 - i * 0.012, 0.8, 0.2 - i * 0.012]]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    palmParts.push([G.box, i % 2 ? '#3f8f3a' : '#57a845', [0.6 + Math.cos(a) * 1.0, 4.45, Math.sin(a) * 1.0], [0, -a, -0.35], [2.0, 0.06, 0.5]]);
  }
  palmParts.push([G.sph, '#6b4a22', [0.75, 4.2, 0.2], 0, [0.18, 0.18, 0.18]]);
  O.palm = bake(palmParts);
  O.deadtree = bake([
    [G.cyl6, '#5e5446', [0, 1.5, 0], 0, [0.22, 3.0, 0.22]],
    [G.cyl6, '#5e5446', [0.5, 2.6, 0], [0, 0, -0.8], [0.09, 1.4, 0.09]],
    [G.cyl6, '#5e5446', [-0.45, 2.2, 0.2], [0.3, 0, 0.9], [0.08, 1.2, 0.08]],
    [G.cyl6, '#776b5a', [0.1, 3.3, -0.3], [-0.4, 0, 0.2], [0.07, 1.0, 0.07]],
  ]);
  O.rock = bake([[G.dodo, '#8d8a84', [0, 0.45, 0], 0, [1.0, 0.75, 0.9], 30], [G.dodo, '#9a948a', [0.55, 0.3, 0.3], 0, [0.5, 0.45, 0.5], 18]]);
  O.iron = bake([
    [G.dodo, '#6f6a66', [0, 0.45, 0], 0, [1.0, 0.75, 0.9], 30],
    [G.box, '#c57a3c', [0.45, 0.6, 0.35], [0.4, 0.5, 0.2], [0.25, 0.25, 0.25]],
    [G.box, '#d98a46', [-0.35, 0.75, 0.25], [0.8, 0.1, 0.4], [0.22, 0.22, 0.22]],
    [G.box, '#c57a3c', [0.1, 0.95, -0.3], [0.2, 0.7, 0.1], [0.24, 0.24, 0.24]],
    [G.box, '#e09a56', [-0.2, 0.5, -0.55], [0.5, 0.3, 0.9], [0.2, 0.2, 0.2]],
  ]);
  O.crystal = bake([
    [G.dodo, '#55525e', [0, 0.25, 0], 0, [0.9, 0.4, 0.8], 20],
    [G.oct, '#7fe0f5', [0, 1.1, 0], [0, 0, 0.1], [0.32, 1.1, 0.32]],
    [G.oct, '#9ae9fa', [0.45, 0.8, 0.2], [0.2, 0, -0.5], [0.22, 0.75, 0.22]],
    [G.oct, '#6fd6ef', [-0.4, 0.75, -0.2], [-0.2, 0, 0.5], [0.22, 0.7, 0.22]],
  ]);
  O.cactus = bake([
    [G.cyl8, '#3f8f4f', [0, 1.2, 0], 0, [0.32, 2.4, 0.32]],
    [G.sph, '#3f8f4f', [0, 2.4, 0], 0, [0.32, 0.25, 0.32]],
    [G.cyl8, '#3f8f4f', [0.55, 1.0, 0], [0, 0, Math.PI / 2], [0.2, 0.6, 0.2]],
    [G.cyl8, '#3f8f4f', [0.8, 1.45, 0], 0, [0.2, 0.9, 0.2]],
    [G.cyl8, '#358545', [-0.5, 1.4, 0], [0, 0, Math.PI / 2], [0.18, 0.5, 0.18]],
    [G.cyl8, '#358545', [-0.72, 1.75, 0], 0, [0.18, 0.7, 0.18]],
    [G.sph, '#e86aa0', [0, 2.62, 0], 0, [0.12, 0.08, 0.12]],
  ]);
  const grass = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    grass.push([G.cone6, i % 2 ? '#7db04a' : '#8cc05a', [Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35], [0.07, 0.85, 0.07]]);
  }
  O.bush = bake(grass);
  O.berry = bake([
    [G.ico, '#2f6b33', [0, 0.55, 0], 0, [0.75, 0.6, 0.75], 12],
    [G.ico, '#3b7d3c', [0.3, 0.75, 0.2], 0, [0.45, 0.4, 0.45]],
    ...[[0.5, 0.6, 0.3], [-0.4, 0.7, 0.35], [0.1, 1.0, -0.3], [-0.2, 0.5, -0.6], [0.55, 0.45, -0.4], [-0.6, 0.45, 0], [0.2, 0.85, 0.5]].map((p) => [G.sph, '#d6304a', p, 0, [0.11, 0.11, 0.11]]),
  ]);
  const reeds = [];
  for (let i = 0; i < 7; i++) {
    const x = (i % 3 - 1) * 0.2, z = (Math.floor(i / 3) - 1) * 0.2, h = 1.1 + (i % 3) * 0.25;
    reeds.push([G.cyl6, '#7a9a4d', [x, h / 2, z], [x * 0.5, 0, z * 0.5], [0.03, h, 0.03]]);
    if (i % 2 === 0) reeds.push([G.cyl6, '#6b4a2b', [x * 1.1, h, z * 1.1], 0, [0.06, 0.28, 0.06]]);
  }
  O.reeds = bake(reeds);
  O.mushroom = bake([
    [G.cyl6, '#e8e2cf', [0, 0.2, 0], 0, [0.06, 0.4, 0.06]], [G.hemi, '#43c6c9', [0, 0.38, 0], 0, [0.22, 0.16, 0.22]],
    [G.cyl6, '#e8e2cf', [0.25, 0.14, 0.15], 0, [0.05, 0.28, 0.05]], [G.hemi, '#43c6c9', [0.25, 0.27, 0.15], 0, [0.16, 0.12, 0.16]],
    [G.cyl6, '#e8e2cf', [-0.2, 0.1, 0.2], 0, [0.04, 0.2, 0.04]], [G.hemi, '#5ad8db', [-0.2, 0.19, 0.2], 0, [0.12, 0.09, 0.12]],
  ]);
  O.flint = bake([[G.dodo, '#8c8a86', [0, 0.12, 0], 0, [0.28, 0.18, 0.24], 8], [G.dodo, '#a3a09a', [0.3, 0.1, 0.15], 0, [0.2, 0.14, 0.2], 6], [G.dodo, '#9a968f', [-0.2, 0.08, -0.2], 0, [0.15, 0.1, 0.15]]]);
  return O;
}

const TALL3 = { tree: 1, pine: 1, palm: 1, deadtree: 1, cactus: 1 };
const GLOWY = { crystal: '#3aa6c4', mushroom: '#1f8f92' };

// ------------------------------------------------------------------ setup
function initView(canvas) {
  View.canvas = canvas;
  prims();
  const touchy = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !touchy || (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8ec5ea, 40, 110);
  scene.background = new THREE.Color(0x8ec5ea);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 400);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 0.9);
  const sun = new THREE.DirectionalLight(0xfff1d6, 0.85);
  const amb = new THREE.AmbientLight(0x404040, 0.15);
  scene.add(hemi, sun, sun.target, amb);
  const plight = new THREE.PointLight(0xffb060, 0, 10, 1.5);
  scene.add(plight);
  const fires = [];
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff9a40, 0, 20, 1.4); scene.add(l); fires.push(l); }

  R3 = {
    renderer, scene, camera, hemi, sun, amb, plight, fires,
    terrainMat: new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0, specular: 0x000000 }),
    chunkMeshes: new Map(), objMeshes: {}, ghostMeshes: {}, objGeo: objectGeometries(), active: new Set(), lastRebuild: 0, objDirty: true,
    tall: [], ghosted: [], mobs: new Map(), structs: new Map(), pickups: new Map(), projs: new Map(), rings: new Map(), shrines: [],
    texCache: {}, raycaster: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    camTarget: new THREE.Vector3(), camPos: new THREE.Vector3(),
  };

  // vegetation: one instanced mesh per object type, plus a see-through twin for things blocking the camera
  const vegMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const type in OBJ) {
    const cap = type === 'tree' || type === 'pine' || type === 'bush' ? 3200 : 1800;
    const mat = GLOWY[type] ? new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(GLOWY[type]), emissiveIntensity: 0 }) : vegMat;
    const m = new THREE.InstancedMesh(R3.objGeo[type], mat, cap);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.count = 0; m.frustumCulled = false;
    scene.add(m);
    R3.objMeshes[type] = m;
    if (TALL3[type]) {
      const gm = new THREE.InstancedMesh(R3.objGeo[type], new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false }), 24);
      gm.count = 0; gm.frustumCulled = false;
      scene.add(gm);
      R3.ghostMeshes[type] = gm;
    }
  }
  // blob shadows under trees
  R3.shadowTex = blobTexture();
  R3.shadowMat = new THREE.MeshBasicMaterial({ map: R3.shadowTex, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
  const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
  R3.shadowGeo = sg;
  R3.treeShadows = new THREE.InstancedMesh(sg, R3.shadowMat, 4000);
  R3.treeShadows.count = 0; R3.treeShadows.frustumCulled = false; R3.treeShadows.renderOrder = 1;
  scene.add(R3.treeShadows);

  // water
  const wg = new THREE.PlaneGeometry(420, 420, 1, 1); wg.rotateX(-Math.PI / 2);
  R3.water = new THREE.Mesh(wg, new THREE.MeshPhongMaterial({ color: 0x2c7ab0, transparent: true, opacity: 0.78, shininess: 90, specular: 0x6a8aa8 }));
  R3.water.position.y = -0.12;
  R3.water.renderOrder = 2;
  scene.add(R3.water);

  // sky dressing
  const starPos = new Float32Array(900 * 3);
  const rng = mulberry32(7);
  for (let i = 0; i < 900; i++) {
    const a = rng() * Math.PI * 2, b = Math.acos(rng() * 0.95);
    starPos[i * 3] = Math.cos(a) * Math.sin(b) * 300; starPos[i * 3 + 1] = Math.cos(b) * 300; starPos[i * 3 + 2] = Math.sin(a) * Math.sin(b) * 300;
  }
  const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  R3.stars = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(R3.stars);
  R3.moon = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8eeff, fog: false }));
  R3.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
  scene.add(R3.moon, R3.sunDisc);

  // rain and snow
  const rp = new Float32Array(700 * 6);
  const rgeo = new THREE.BufferGeometry(); rgeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  R3.rain = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({ color: 0xbfd2ee, transparent: true, opacity: 0.5 }));
  R3.rain.frustumCulled = false;
  R3.rainDrops = [];
  for (let i = 0; i < 700; i++) R3.rainDrops.push([rand(-30, 30), rand(0, 30), rand(-30, 30), rand(0.8, 1.2)]);
  scene.add(R3.rain);

  // particles
  const NP = 700;
  R3.np = NP; R3.pi = 0;
  R3.pPos = new Float32Array(NP * 3).fill(-9999); R3.pCol = new Float32Array(NP * 3); R3.pVel = new Float32Array(NP * 3); R3.pLife = new Float32Array(NP); R3.pGrav = new Float32Array(NP);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(R3.pPos, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(R3.pCol, 3));
  R3.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  R3.points.frustumCulled = false;
  scene.add(R3.points);

  // placement ghost
  R3.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 1.9), new THREE.MeshBasicMaterial({ color: 0x8cffa0, transparent: true, opacity: 0.35, depthWrite: false }));
  R3.ghost.visible = false;
  scene.add(R3.ghost);

  R3.player = buildPlayer();
  scene.add(R3.player.g);

  buildOverlay();
  resizeView();
  window.addEventListener('resize', resizeView);
  window.addEventListener('orientationchange', () => setTimeout(resizeView, 200));
}

function blobTexture() {
  const c = makeCanvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function resizeView() {
  const w = window.innerWidth, h = window.innerHeight;
  const cap = View.lowQuality ? 1.25 : 2;
  View.dpr = Math.min(cap, window.devicePixelRatio || 1);
  R3.renderer.setPixelRatio(View.dpr);
  R3.renderer.setSize(w, h, false);
  View.canvas.style.width = w + 'px'; View.canvas.style.height = h + 'px';
  View.W = Math.round(w * View.dpr); View.H = Math.round(h * View.dpr);
  R3.camera.aspect = w / h;
  R3.camera.fov = w < h ? 68 : 55;
  R3.camera.updateProjectionMatrix();
}

function screenToWorld(sx, sy) {
  const v = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  R3.raycaster.setFromCamera(v, R3.camera);
  const p = Game.player;
  R3.plane.constant = -(heightAt(p.x, p.y) + 0.9);
  const hit = new THREE.Vector3();
  if (!R3.raycaster.ray.intersectPlane(R3.plane, hit)) return null;
  return { x: hit.x / PX, y: hit.z / PX };
}

// ------------------------------------------------------------------ terrain chunks
function buildTerrain(ch) {
  const N = CS, N1 = CS + 1;
  const h = new Float32Array(N1 * N1);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) h[j * N1 + i] = heightM(ch.cx * CS + i, ch.cy * CS + j);
  ch.h = h;
  const pos = new Float32Array(N * N * 18), col = new Float32Array(N * N * 18);
  const S = World.seed;
  const rocky = new THREE.Color('#857f74'), tmp = new THREE.Color();
  let k = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const t = ch.tiles[j * N + i];
    const tx = ch.cx * CS + i, ty = ch.cy * CS + j;
    const a = h[j * N1 + i], b = h[j * N1 + i + 1], c = h[(j + 1) * N1 + i], d = h[(j + 1) * N1 + i + 1];
    const x0 = i * 2, z0 = j * 2, x1 = x0 + 2, z1 = z0 + 2;
    const underwater = TILES[t].water || t === T.DEEP;
    tmp.set(underwater ? (t === T.DEEP ? '#2b5560' : '#5f8a7a') : TILES[t].color);
    const v = (hash2(tx, ty, S + 21) - 0.5) * 0.09;
    tmp.offsetHSL(0, 0, v);
    const steep = Math.max(a, b, c, d) - Math.min(a, b, c, d);
    if (!underwater && steep > 2.4 && t !== T.SNOW && t !== T.ICE) tmp.lerp(rocky, clamp((steep - 2.4) / 3, 0, 0.8));
    if (t === T.SNOW && steep > 3) tmp.lerp(rocky, 0.35);
    const tris = [[x0, a, z0, x0, c, z1, x1, b, z0], [x1, b, z0, x0, c, z1, x1, d, z1]];
    for (let q = 0; q < 2; q++) {
      const tri = tris[q];
      const shadeK = q ? 0.97 : 1.0;
      for (let v3 = 0; v3 < 3; v3++) {
        pos[k] = tri[v3 * 3]; pos[k + 1] = tri[v3 * 3 + 1]; pos[k + 2] = tri[v3 * 3 + 2];
        col[k] = tmp.r * shadeK; col[k + 1] = tmp.g * shadeK; col[k + 2] = tmp.b * shadeK;
        k += 3;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, R3.terrainMat);
  mesh.position.set(ch.cx * CS * 2, 0, ch.cy * CS * 2);
  return mesh;
}

function updateChunks(px, py) {
  const pcx = Math.floor(px / CHUNK_PX), pcy = Math.floor(py / CHUNK_PX);
  const want = new Set();
  const order = [];
  const VR = View.viewR;
  for (let dy = -VR; dy <= VR; dy++) for (let dx = -VR; dx <= VR; dx++) {
    if (dx * dx + dy * dy > VR * VR + 2) continue;
    const k = chunkKey(pcx + dx, pcy + dy);
    want.add(k);
    if (!R3.chunkMeshes.has(k)) order.push([dx * dx + dy * dy, pcx + dx, pcy + dy, k]);
  }
  order.sort((a, b) => a[0] - b[0]);
  let budget = Game.state === 'title' ? 6 : 3;
  for (const [d2, cx, cy, k] of order) {
    if (budget-- <= 0 && d2 > 2) break;
    const ch = getChunk(cx, cy);
    const m = buildTerrain(ch);
    R3.scene.add(m);
    R3.chunkMeshes.set(k, m);
    R3.objDirty = true;
  }
  for (const [k, m] of R3.chunkMeshes) {
    if (want.has(k)) continue;
    R3.scene.remove(m); m.geometry.dispose(); R3.chunkMeshes.delete(k);
    const ch = World.chunks.get(k); if (ch) ch.h = null;
  }
  // keep the 2D data map from growing forever
  if (World.chunks.size > 700) {
    for (const [k, ch] of World.chunks) {
      if (Math.abs(ch.cx - pcx) > 12 || Math.abs(ch.cy - pcy) > 12) World.chunks.delete(k);
    }
  }
  const key = pcx + ',' + pcy;
  if (key !== R3.objCenter) { R3.objCenter = key; R3.objDirty = true; }
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

function rebuildObjects(px, py) {
  R3.objDirty = false;
  R3.lastRebuild = View.clock;
  for (const t in R3.objMeshes) R3.objMeshes[t].count = 0;
  R3.tall = [];
  let ns = 0;
  const pcx = Math.floor(px / CHUNK_PX), pcy = Math.floor(py / CHUNK_PX);
  const OR = View.objR;
  for (let dy = -OR; dy <= OR; dy++) for (let dx = -OR; dx <= OR; dx++) {
    const ch = World.chunks.get(chunkKey(pcx + dx, pcy + dy));
    if (!ch || !ch.h) continue;
    for (const o of ch.objs) {
      if (!objAlive(o)) { o._mi = -1; continue; }
      const m = R3.objMeshes[o.type];
      if (m.count >= m.instanceMatrix.count) continue;
      const i = m.count++;
      const hr = hash2(o.tx, o.ty, 91);
      const sc = (TALL3[o.type] ? 0.8 : 0.85) + hr * 0.4;
      const y = heightAt(o.x, o.y) - 0.05;
      _q.setFromEuler(_e.set(0, hr * Math.PI * 2, 0));
      _m4.compose(_v.set(o.x * PX, y, o.y * PX), _q, _s.set(sc, sc * (o.type === 'tree' ? 0.9 + o.v * 0.12 : 1), sc));
      m.setMatrixAt(i, _m4);
      const tint = 0.88 + hash2(o.tx, o.ty, 93) * 0.24;
      m.instanceColor.setXYZ(i, tint, tint * (o.type === 'tree' ? 0.96 + o.v * 0.05 : 1), tint);
      o._mi = i; o._mat = o._mat || new THREE.Matrix4(); o._mat.copy(_m4);
      if (TALL3[o.type]) {
        R3.tall.push(o);
        if (ns < R3.treeShadows.instanceMatrix.count) {
          const r = o.type === 'cactus' ? 1.3 : o.type === 'deadtree' ? 1.6 : 3.4 * sc;
          _m4.compose(_v.set(o.x * PX, y + 0.08, o.y * PX), _q.identity(), _s.set(r, 1, r));
          R3.treeShadows.setMatrixAt(ns++, _m4);
        }
      }
    }
  }
  R3.treeShadows.count = ns;
  R3.treeShadows.instanceMatrix.needsUpdate = true;
  for (const t in R3.objMeshes) { R3.objMeshes[t].instanceMatrix.needsUpdate = true; R3.objMeshes[t].instanceColor.needsUpdate = true; }
  R3.ghosted = [];
}

// hide trees standing between the camera and the player; draw see-through copies instead
function updateOccluders() {
  const p = Game.player;
  for (const o of R3.ghosted) if (o._mi >= 0) { R3.objMeshes[o.type].setMatrixAt(o._mi, o._mat); R3.objMeshes[o.type].instanceMatrix.needsUpdate = true; }
  R3.ghosted = [];
  for (const t in R3.ghostMeshes) R3.ghostMeshes[t].count = 0;
  if (Game.state === 'title' || p.dead) return;
  const ax = p.x * PX, az = p.y * PX, bx = R3.camera.position.x, bz = R3.camera.position.z;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  if (L2 < 0.01) return;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const o of R3.tall) {
    const ox = o.x * PX - ax, oz = o.y * PX - az;
    if (Math.abs(ox) > 16 || Math.abs(oz) > 16) continue;
    const t = (ox * dx + oz * dz) / L2;
    if (t < 0.02 || t > 1.05) continue;
    const ex = ox - dx * t, ez = oz - dz * t;
    if (ex * ex + ez * ez > (o.type === 'tree' ? 6.5 : 3.2)) continue;
    const gm = R3.ghostMeshes[o.type];
    if (gm.count >= 24) continue;
    gm.setMatrixAt(gm.count++, o._mat);
    R3.objMeshes[o.type].setMatrixAt(o._mi, zero);
    R3.objMeshes[o.type].instanceMatrix.needsUpdate = true;
    R3.ghosted.push(o);
  }
  for (const t in R3.ghostMeshes) R3.ghostMeshes[t].instanceMatrix.needsUpdate = true;
}

function updateShakes(dt) {
  for (const o of R3.shaking || []) {
    if (o._mi < 0 || !o._mat) continue;
    o.shake = Math.max(0, (o.shake || 0) - dt * 4);
    const m = R3.objMeshes[o.type];
    _m4.copy(o._mat);
    if (o.shake > 0) {
      const w = Math.sin(View.clock * 60) * 0.06 * o.shake;
      _m4.multiply(new THREE.Matrix4().makeRotationZ(w));
    }
    m.setMatrixAt(o._mi, _m4);
    m.instanceMatrix.needsUpdate = true;
  }
  if (R3.shaking) R3.shaking = R3.shaking.filter((o) => o.shake > 0);
}

// ------------------------------------------------------------------ models
function part(parent, geo, color, pos, scl, rot, mat) {
  const m = new THREE.Mesh(geo, mat || lam(color));
  m.position.set(...pos);
  if (scl) m.scale.set(...scl);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}

function pivot(parent, pos) { const g = new THREE.Group(); g.position.set(...pos); parent.add(g); return g; }

function shadowDisc(parent, r) {
  const m = new THREE.Mesh(R3.shadowGeo, R3.shadowMat);
  m.scale.set(r, 1, r); m.position.y = 0.06; m.renderOrder = 1;
  parent.add(m);
  return m;
}

function buildPlayer() {
  const g = new THREE.Group();
  shadowDisc(g, 1.3);
  const body = new THREE.Group(); g.add(body);
  const legL = pivot(body, [0, 0.8, -0.13]), legR = pivot(body, [0, 0.8, 0.13]);
  part(legL, G.box, '#3b2f2a', [0, -0.4, 0], [0.2, 0.8, 0.18]);
  part(legR, G.box, '#3b2f2a', [0, -0.4, 0], [0.2, 0.8, 0.18]);
  const torsoMat = new THREE.MeshLambertMaterial({ color: '#3f6f8a' });
  const torso = part(body, G.box, null, [0, 1.15, 0], [0.32, 0.72, 0.5], null, torsoMat);
  part(body, G.box, '#6b4a2b', [0, 0.86, 0], [0.34, 0.08, 0.52]);
  const head = part(body, G.box, '#e8b98f', [0, 1.72, 0], [0.38, 0.38, 0.38]);
  part(body, G.box, '#4a2f1d', [-0.04, 1.93, 0], [0.42, 0.1, 0.42]);
  part(body, G.box, '#4a2f1d', [-0.18, 1.78, 0], [0.08, 0.3, 0.42]);
  part(body, G.box, '#2a1d16', [0.19, 1.74, -0.09], [0.02, 0.06, 0.05]);
  part(body, G.box, '#2a1d16', [0.19, 1.74, 0.09], [0.02, 0.06, 0.05]);
  const armL = pivot(body, [0, 1.45, -0.32]), armR = pivot(body, [0, 1.45, 0.32]);
  part(armL, G.box, '#e8b98f', [0, -0.32, 0], [0.15, 0.62, 0.15]);
  part(armR, G.box, '#e8b98f', [0, -0.32, 0], [0.15, 0.62, 0.15]);
  const hand = pivot(armR, [0, -0.62, 0]);
  return { g, body, legL, legR, armL, armR, hand, torsoMat, head, held: null, heldId: null };
}

function heldModel(id) {
  const g = new THREE.Group();
  const it = ITEMS[id];
  const wood = '#7a5631';
  if (!it) return g;
  if (it.tool === 'axe') {
    part(g, G.box, wood, [0.32, 0, 0], [0.64, 0.06, 0.06]);
    part(g, G.box, id === 'axe2' ? '#c3cbd4' : '#8d8a84', [0.58, 0.1, 0], [0.14, 0.26, 0.04]);
  } else if (it.tool === 'pick') {
    part(g, G.box, wood, [0.32, 0, 0], [0.64, 0.06, 0.06]);
    part(g, G.box, id === 'pick2' ? '#c3cbd4' : '#8d8a84', [0.6, 0, 0], [0.06, 0.5, 0.06], [0, 0, 0.15]);
  } else if (it.kind === 'weapon') {
    part(g, G.box, '#6b4a2b', [0.08, 0, 0], [0.18, 0.06, 0.06]);
    part(g, G.box, '#6b4a2b', [0.17, 0, 0], [0.04, 0.22, 0.06]);
    part(g, G.box, id === 'sword2' ? '#d8e0e8' : '#a3a09a', [0.6, 0, 0], [0.82, 0.08, 0.02]);
  } else if (it.kind === 'torch') {
    part(g, G.box, wood, [0.28, 0, 0], [0.56, 0.06, 0.06]);
    part(g, G.cone6, null, [0.62, 0, 0], [0.1, 0.24, 0.1], [0, 0, -Math.PI / 2], new THREE.MeshBasicMaterial({ color: '#ffb347' }));
    g.userData.flame = true;
  } else if (it.kind === 'bow') {
    for (let i = -3; i <= 3; i++) part(g, G.box, '#8a6239', [0.12 + Math.cos(i * 0.32) * 0.12, Math.sin(i * 0.32) * 0.45, 0], [0.04, 0.16, 0.04], [0, 0, i * 0.32]);
    part(g, G.box, '#e8e2cf', [0.0, 0, 0], [0.01, 0.9, 0.01]);
  } else {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex(id) }));
    sp.scale.set(0.42, 0.42, 1); sp.position.set(0.15, 0, 0);
    g.add(sp);
  }
  return g;
}

function iconTex(id) {
  if (!R3.texCache[id]) {
    const t = new THREE.TextureLoader().load(iconURL(id));
    t.minFilter = THREE.LinearFilter;
    R3.texCache[id] = t;
  }
  return R3.texCache[id];
}

function legRig(parent, spots, len, w, color) {
  return spots.map(([x, z]) => { const p = pivot(parent, [x, len, z]); part(p, G.box, color, [0, -len / 2, 0], [w, len, w]); return p; });
}

function mobModel(type) {
  const g = new THREE.Group();
  const rig = { g, legs: [], parts: [], eyes: [], float: 0 };
  const own = (c) => new THREE.MeshLambertMaterial({ color: c });
  const P = (geo, c, pos, scl, rot) => { const m = part(g, geo, null, pos, scl, rot, own(c)); rig.parts.push(m); return m; };
  const eye = (pos, c, s) => { const m = part(g, G.box, null, pos, [s, s, s], null, new THREE.MeshBasicMaterial({ color: c })); rig.eyes.push(m); return m; };
  switch (type) {
    case 'rabbit':
      shadowDisc(g, 0.7);
      P(G.sph, '#a89580', [0, 0.25, 0], [0.32, 0.22, 0.22]);
      P(G.sph, '#b8a690', [0.26, 0.38, 0], [0.15, 0.14, 0.13]);
      P(G.box, '#a89580', [0.24, 0.6, -0.05], [0.05, 0.28, 0.06], [0, 0, -0.2]);
      P(G.box, '#b8a690', [0.24, 0.6, 0.05], [0.05, 0.28, 0.06], [0, 0, -0.1]);
      P(G.sph, '#f2ead8', [-0.32, 0.3, 0], [0.08, 0.08, 0.08]);
      eye([0.38, 0.42, -0.07], '#1a1a1a', 0.035); eye([0.38, 0.42, 0.07], '#1a1a1a', 0.035);
      rig.hop = true;
      break;
    case 'deer':
      shadowDisc(g, 1.4);
      rig.legs = legRig(g, [[0.35, -0.13], [0.35, 0.13], [-0.35, -0.13], [-0.35, 0.13]], 0.8, 0.09, '#6b4a2b');
      P(G.box, '#a0703f', [0, 0.98, 0], [1.0, 0.42, 0.38]);
      P(G.box, '#c9a577', [0, 0.82, 0], [0.8, 0.1, 0.32]);
      P(G.box, '#a0703f', [0.55, 1.3, 0], [0.18, 0.55, 0.2], [0, 0, -0.5]);
      P(G.box, '#a0703f', [0.78, 1.55, 0], [0.34, 0.2, 0.2]);
      P(G.box, '#d9c9a8', [0.68, 1.85, -0.12], [0.04, 0.4, 0.04], [0.3, 0, 0.2]);
      P(G.box, '#d9c9a8', [0.68, 1.85, 0.12], [0.04, 0.4, 0.04], [-0.3, 0, 0.2]);
      P(G.box, '#f2ead8', [-0.52, 1.08, 0], [0.08, 0.16, 0.14]);
      eye([0.9, 1.6, -0.1], '#111', 0.04); eye([0.9, 1.6, 0.1], '#111', 0.04);
      break;
    case 'boar':
      shadowDisc(g, 1.3);
      rig.legs = legRig(g, [[0.28, -0.15], [0.28, 0.15], [-0.28, -0.15], [-0.28, 0.15]], 0.35, 0.12, '#3b2a20');
      P(G.box, '#5e4434', [0, 0.6, 0], [0.95, 0.5, 0.5]);
      P(G.box, '#3b2a20', [0, 0.88, 0], [0.7, 0.1, 0.12]);
      P(G.box, '#6d5040', [0.56, 0.6, 0], [0.32, 0.36, 0.38]);
      P(G.box, '#c58a7a', [0.75, 0.55, 0], [0.08, 0.18, 0.22]);
      P(G.cone6, '#efe6d6', [0.72, 0.5, -0.17], [0.03, 0.18, 0.03], [0, 0, -0.6]);
      P(G.cone6, '#efe6d6', [0.72, 0.5, 0.17], [0.03, 0.18, 0.03], [0, 0, -0.6]);
      eye([0.66, 0.72, -0.12], '#111', 0.04); eye([0.66, 0.72, 0.12], '#111', 0.04);
      break;
    case 'wolf':
      shadowDisc(g, 1.3);
      rig.legs = legRig(g, [[0.3, -0.12], [0.3, 0.12], [-0.3, -0.12], [-0.3, 0.12]], 0.55, 0.09, '#4b4f55');
      P(G.box, '#80858c', [0, 0.72, 0], [0.9, 0.34, 0.32]);
      P(G.box, '#a2a6ab', [0.05, 0.58, 0], [0.7, 0.08, 0.26]);
      P(G.box, '#80858c', [0.55, 0.88, 0], [0.3, 0.3, 0.3]);
      P(G.box, '#6e737a', [0.78, 0.82, 0], [0.24, 0.13, 0.16]);
      P(G.cone6, '#5c6066', [0.5, 1.1, -0.1], [0.06, 0.16, 0.06]);
      P(G.cone6, '#5c6066', [0.5, 1.1, 0.1], [0.06, 0.16, 0.06]);
      P(G.box, '#6e737a', [-0.58, 0.72, 0], [0.4, 0.1, 0.1], [0, 0, 0.5]);
      eye([0.71, 0.93, -0.09], '#ffd34d', 0.05); eye([0.71, 0.93, 0.09], '#ffd34d', 0.05);
      rig.glowEyes = true;
      break;
    case 'bear':
      shadowDisc(g, 2.0);
      rig.legs = legRig(g, [[0.45, -0.3], [0.45, 0.3], [-0.45, -0.3], [-0.45, 0.3]], 0.55, 0.26, '#3d2a1c');
      P(G.box, '#5a3e28', [0, 1.05, 0], [1.4, 0.9, 0.85]);
      P(G.box, '#6b4a31', [-0.1, 1.45, 0], [0.9, 0.2, 0.7]);
      P(G.box, '#5a3e28', [0.85, 1.25, 0], [0.5, 0.5, 0.55]);
      P(G.box, '#8a6a4c', [1.12, 1.15, 0], [0.22, 0.22, 0.3]);
      P(G.box, '#5a3e28', [0.8, 1.55, -0.22], [0.14, 0.14, 0.1]);
      P(G.box, '#5a3e28', [0.8, 1.55, 0.22], [0.14, 0.14, 0.1]);
      eye([1.1, 1.36, -0.14], '#111', 0.06); eye([1.1, 1.36, 0.14], '#111', 0.06);
      break;
    case 'scorpion':
      shadowDisc(g, 1.2);
      rig.legs = legRig(g, [[0.2, -0.3], [0, -0.32], [-0.2, -0.3], [0.2, 0.3], [0, 0.32], [-0.2, 0.3]], 0.22, 0.05, '#7a5a2c');
      P(G.box, '#b08440', [0, 0.28, 0], [0.75, 0.2, 0.42]);
      for (let i = 0; i < 4; i++) P(G.box, '#b08440', [-0.45 - Math.sin(i * 0.6) * 0.2, 0.35 + i * 0.18, 0], [0.16, 0.16, 0.14], [0, 0, i * 0.4]);
      P(G.cone6, '#5a2c1c', [-0.32, 1.05, 0], [0.06, 0.2, 0.06], [0, 0, -1.8]);
      P(G.box, '#c49a52', [0.55, 0.3, -0.25], [0.3, 0.12, 0.14]);
      P(G.box, '#c49a52', [0.55, 0.3, 0.25], [0.3, 0.12, 0.14]);
      eye([0.38, 0.4, -0.08], '#111', 0.04); eye([0.38, 0.4, 0.08], '#111', 0.04);
      break;
    case 'bogling':
      shadowDisc(g, 1.3);
      rig.legs = legRig(g, [[0, -0.25], [0, 0.25]], 0.25, 0.14, '#3d4a28');
      P(G.sph, '#5b6b3a', [0, 0.7, 0], [0.55, 0.5, 0.55]);
      P(G.sph, '#6f8247', [-0.1, 0.9, 0], [0.35, 0.25, 0.4]);
      P(G.box, '#87a356', [0, 1.25, -0.1], [0.05, 0.3, 0.05]);
      P(G.box, '#87a356', [0.05, 1.25, 0.12], [0.05, 0.25, 0.05]);
      eye([0.48, 0.82, -0.16], '#e8f070', 0.1); eye([0.48, 0.82, 0.16], '#e8f070', 0.1);
      rig.glowEyes = true;
      break;
    case 'shade':
    case 'hollow': {
      const k = type === 'hollow' ? 2.6 : 1;
      const dark = new THREE.MeshLambertMaterial({ color: '#160e26', transparent: true, opacity: 0.88, emissive: new THREE.Color('#1a0f33') });
      const body = part(g, G.cone8, null, [0, 1.0 * k, 0], [0.45 * k, 1.6 * k, 0.45 * k], [Math.PI, 0, 0], dark);
      const head = part(g, G.sph, null, [0, 1.8 * k, 0], [0.32 * k, 0.36 * k, 0.32 * k], null, dark);
      rig.parts.push(body, head);
      eye([0.27 * k, 1.85 * k, -0.11 * k], '#d9c7ff', 0.08 * k); eye([0.27 * k, 1.85 * k, 0.11 * k], '#d9c7ff', 0.08 * k);
      if (type === 'hollow') for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        part(g, G.cone6, '#c9a54a', [Math.cos(a) * 0.55, 2.55 * k * 0.98, Math.sin(a) * 0.55], [0.12, 0.45, 0.12]);
      }
      rig.float = 0.4; rig.shade = true; rig.glowEyes = true;
      break;
    }
    case 'guardian': {
      shadowDisc(g, 3.4);
      rig.legs = legRig(g, [[0, -0.45], [0, 0.45]], 1.1, 0.55, '#5f5a52');
      P(G.box, '#7a756c', [0, 2.1, 0], [1.3, 1.9, 2.0]);
      P(G.box, '#8e897f', [0, 3.15, 0], [1.1, 0.3, 1.7]);
      const armL = pivot(g, [0, 2.9, -1.3]), armR = pivot(g, [0, 2.9, 1.3]);
      rig.parts.push(part(armL, G.box, null, [0, -0.9, 0], [0.6, 1.9, 0.6], null, own('#5f5a52')));
      rig.parts.push(part(armR, G.box, null, [0, -0.9, 0], [0.6, 1.9, 0.6], null, own('#5f5a52')));
      rig.arms = [armL, armR];
      P(G.box, '#6e6a62', [0.15, 3.65, 0], [0.7, 0.7, 0.7]);
      P(G.box, '#4e7a4a', [0.66, 2.5, -0.5], [0.05, 0.3, 0.4]);
      const core = part(g, G.oct, null, [0.66, 2.2, 0], [0.32, 0.32, 0.32], null, new THREE.MeshBasicMaterial({ color: '#b48cff' }));
      rig.core = core;
      eye([0.52, 3.7, -0.16], '#e2d6ff', 0.1); eye([0.52, 3.7, 0.16], '#e2d6ff', 0.1);
      rig.glowEyes = true;
      const ringMat = new THREE.MeshBasicMaterial({ color: '#ff7a50', transparent: true, opacity: 0.0, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(6.3, 6.9, 40), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
      g.add(ring);
      rig.slamRing = ring;
      break;
    }
  }
  return rig;
}

function structModel(s) {
  const g = new THREE.Group();
  const rig = { g };
  switch (s.type) {
    case 'campfire': {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; part(g, G.dodo, i % 2 ? '#7d7a74' : '#96938c', [Math.cos(a) * 0.7, 0.14, Math.sin(a) * 0.7], [0.2, 0.17, 0.2]); }
      part(g, G.cyl6, '#5b3d22', [0, 0.18, 0], [0.11, 1.1, 0.11], [Math.PI / 2, 0, 0.6]);
      part(g, G.cyl6, '#5b3d22', [0, 0.18, 0], [0.11, 1.1, 0.11], [Math.PI / 2, 0, -0.6]);
      rig.flame = flameRig(g, 0.25, 1);
      break;
    }
    case 'brazier':
      part(g, G.cyl6, '#5f5a52', [0, 0.5, 0], [0.18, 1.0, 0.18]);
      part(g, G.cyl8, '#77736b', [0, 0.06, 0], [0.5, 0.12, 0.5]);
      part(g, G.cyl8, '#6d675e', [0, 1.1, 0], [0.62, 0.32, 0.62]);
      part(g, G.cyl8, '#c57a3c', [0, 1.27, 0], [0.5, 0.03, 0.5]);
      rig.flame = flameRig(g, 1.3, 0.9);
      break;
    case 'wall':
      for (let i = 0; i < 4; i++) {
        const z = -0.75 + i * 0.5, hh = 1.9 + (i % 2) * 0.2;
        part(g, G.cyl6, i % 2 ? '#7a5631' : '#8a6239', [0, hh / 2, z], [0.24, hh, 0.24]);
        part(g, G.cone6, '#9a7448', [0, hh + 0.18, z], [0.24, 0.36, 0.24]);
      }
      part(g, G.box, '#5b3d22', [0.18, 0.7, 0], [0.1, 0.16, 2.0]);
      part(g, G.box, '#5b3d22', [0.18, 1.5, 0], [0.1, 0.16, 2.0]);
      rig.wall = true;
      break;
    case 'spikes':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(g, G.cone6, '#d9d0bf', [Math.cos(a) * 0.5, 0.35, Math.sin(a) * 0.5], [0.07, 0.75, 0.07], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4]);
      }
      part(g, G.cyl6, '#9a7448', [0, 0.06, 0], [0.75, 0.12, 0.75]);
      break;
    case 'workbench':
      for (const [x, z] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) part(g, G.box, '#5b3d22', [x, 0.42, z], [0.12, 0.84, 0.12]);
      part(g, G.box, '#9a7041', [0, 0.9, 0], [1.8, 0.14, 1.0]);
      part(g, G.box, '#8d8a84', [-0.4, 1.05, 0.1], [0.4, 0.2, 0.3]);
      part(g, G.box, '#6b4a2b', [0.4, 1.0, -0.1], [0.05, 0.05, 0.6]);
      part(g, G.box, '#a3a09a', [0.4, 1.02, 0.22], [0.25, 0.06, 0.08]);
      break;
    case 'bed':
      part(g, G.box, '#7d5b3a', [0, 0.08, 0], [1.0, 0.16, 2.0]);
      part(g, G.box, '#b08a5c', [0, 0.2, 0.25], [0.9, 0.12, 1.3]);
      part(g, G.box, '#e4dccb', [0, 0.22, -0.7], [0.7, 0.18, 0.4]);
      break;
    case 'beacon': {
      part(g, G.box, '#5f5a52', [0, 0.3, 0], [2.0, 0.6, 2.0]);
      part(g, G.box, '#77736b', [0, 2.6, 0], [1.1, 4.0, 1.1]);
      part(g, G.box, '#4c4842', [0, 1.6, 0], [1.15, 0.12, 1.15]);
      part(g, G.box, '#4c4842', [0, 3.4, 0], [1.15, 0.12, 1.15]);
      part(g, G.box, '#8e897f', [0, 4.75, 0], [1.4, 0.3, 1.4]);
      rig.crystal = part(g, G.oct, null, [0, 5.8, 0], [0.55, 0.9, 0.55], null, new THREE.MeshLambertMaterial({ color: '#b48cff', emissive: new THREE.Color('#5a3a9a') }));
      const beamMat = new THREE.MeshBasicMaterial({ color: '#c8a8ff', transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      rig.beam = part(g, G.cyl8, null, [0, 60, 0], [0.5, 110, 0.5], null, beamMat);
      break;
    }
    case 'grave':
      part(g, G.sph, '#5a4632', [0, 0, 0], [0.7, 0.25, 1.0]);
      part(g, G.box, '#8a8478', [0, 0.65, -0.6], [0.14, 1.2, 0.14]);
      part(g, G.box, '#8a8478', [0, 0.9, -0.6], [0.6, 0.14, 0.14]);
      rig.glow = part(g, G.sph, null, [0, 1.45, -0.6], [0.08, 0.08, 0.08], null, new THREE.MeshBasicMaterial({ color: '#ffe9a8' }));
      break;
  }
  return rig;
}

function flameRig(parent, y, k) {
  const f = new THREE.Group(); f.position.y = y; parent.add(f);
  const cols = ['#ff5a1e', '#ffa028', '#ffeb8c'];
  const parts = cols.map((c, i) => part(f, G.cone6, null, [0, 0.45 * k - i * 0.05, 0], [0.42 * k - i * 0.12 * k, 0.9 * k - i * 0.22 * k, 0.42 * k - i * 0.12 * k], null, new THREE.MeshBasicMaterial({ color: c, transparent: i < 2, opacity: i === 0 ? 0.85 : 0.95 })));
  return { g: f, parts };
}

function shrineModel(sh) {
  const g = new THREE.Group();
  const y = heightAt(sh.x, sh.y);
  part(g, G.box, '#6e6a62', [0, 0.35, 0], [2.8, 0.7, 2.0]);
  part(g, G.box, '#8e897f', [0, 0.8, 0], [2.2, 0.2, 1.5]);
  for (const pl of shrinePillars(sh)) {
    const ph = 3.6 + pl.v * 0.6;
    const m = part(g, G.box, '#6e6a62', [(pl.x - sh.x) * PX, ph / 2, (pl.y - sh.y) * PX], [0.9, ph, 0.9], [0, pl.v, (pl.v - 1) * 0.06]);
    part(g, G.box, '#4e7a4a', [(pl.x - sh.x) * PX + 0.46, ph * 0.6, (pl.y - sh.y) * PX], [0.04, 0.5, 0.4]);
    void m;
  }
  const shard = part(g, G.oct, null, [0, 2.2, 0], [0.35, 0.6, 0.35], null, new THREE.MeshLambertMaterial({ color: '#9d7bff', emissive: new THREE.Color('#6a48d0') }));
  g.position.set(sh.x * PX, y, sh.y * PX);
  R3.scene.add(g);
  const light = new THREE.PointLight(0xa080ff, 0, 16, 1.4);
  light.position.set(0, 2.6, 0); g.add(light);
  return { g, shard, light, sh };
}

// ------------------------------------------------------------------ particles (3D override of game.js burst)
function spawnParticle(x, y, z, vx, vy, vz, color, life, grav) {
  const i = R3.pi; R3.pi = (R3.pi + 1) % R3.np;
  R3.pPos[i * 3] = x; R3.pPos[i * 3 + 1] = y; R3.pPos[i * 3 + 2] = z;
  R3.pVel[i * 3] = vx; R3.pVel[i * 3 + 1] = vy; R3.pVel[i * 3 + 2] = vz;
  _c.set(color.startsWith('rgba') ? color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)') : color);
  R3.pCol[i * 3] = _c.r; R3.pCol[i * 3 + 1] = _c.g; R3.pCol[i * 3 + 2] = _c.b;
  R3.pLife[i] = life; R3.pGrav[i] = grav;
}

burst = function (x, y, n, color, speed, life, size, grav) {
  if (!R3) return;
  const base = heightAt(x, y) + 0.7;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * PX * (0.3 + Math.random() * 0.7);
    const up = grav < 0 ? rand(0.6, 1.6) : speed * PX * rand(0.3, 1.0);
    spawnParticle(x * PX + rand(-0.2, 0.2), base + rand(0, 0.6), y * PX + rand(-0.2, 0.2), Math.cos(a) * s, up, Math.sin(a) * s, color, life * (0.6 + Math.random() * 0.4), grav > 0 ? -12 : grav < 0 ? 1.2 : -2);
  }
};

const _hitObject = hitObject;
hitObject = function (o) { _hitObject(o); if (o.shake > 0) { R3.shaking = R3.shaking || []; if (!R3.shaking.includes(o)) R3.shaking.push(o); } };
const _destroyObject = destroyObject;
destroyObject = function (o) { _destroyObject(o); R3.objDirty = true; };

function updateParticles(dt) {
  const P = R3.pPos, V = R3.pVel;
  for (let i = 0; i < R3.np; i++) {
    if (R3.pLife[i] <= 0) continue;
    R3.pLife[i] -= dt;
    if (R3.pLife[i] <= 0) { P[i * 3 + 1] = -9999; continue; }
    V[i * 3 + 1] += R3.pGrav[i] * dt;
    const drag = Math.pow(0.25, dt);
    V[i * 3] *= drag; V[i * 3 + 2] *= drag;
    P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
  }
  R3.points.geometry.attributes.position.needsUpdate = true;
  R3.points.geometry.attributes.color.needsUpdate = true;
}

// ------------------------------------------------------------------ DOM overlay for labels
const OV = {};
function buildOverlay() {
  const root = document.createElement('div');
  root.id = 'wui';
  View.canvas.parentNode.insertBefore(root, View.canvas.nextSibling);
  const mk = (cls) => { const d = document.createElement('div'); d.className = cls; d.hidden = true; root.appendChild(d); return d; };
  OV.root = root;
  OV.hint = mk('whint');
  OV.texts = Array.from({ length: 16 }, () => mk('wtext'));
  OV.bars = Array.from({ length: 8 }, () => { const d = mk('wbar'); d.innerHTML = '<i></i>'; return d; });
  OV.marks = Array.from({ length: 3 }, () => { const d = mk('wmark'); d.innerHTML = '<b></b><span></span>'; return d; });
  OV.fx = document.createElement('div'); OV.fx.id = 'fx';
  OV.fx.innerHTML = '<i class="danger"></i><i class="cold"></i><i class="flash"></i><i class="dark"></i>';
  root.appendChild(OV.fx);
  OV.danger = OV.fx.children[0]; OV.cold = OV.fx.children[1]; OV.flash = OV.fx.children[2]; OV.dark = OV.fx.children[3];
}

const _p3 = new THREE.Vector3();
function project(x, y, z) {
  _p3.set(x, y, z).project(R3.camera);
  return { x: (_p3.x * 0.5 + 0.5) * window.innerWidth, y: (-_p3.y * 0.5 + 0.5) * window.innerHeight, behind: _p3.z > 1, z: _p3.z };
}

function setOpacity(el, v) { const s = v.toFixed(3); if (el._o !== s) { el.style.opacity = s; el._o = s; } }
function place(el, x, y) { el.style.transform = 'translate(' + (x | 0) + 'px,' + (y | 0) + 'px)'; }

function updateOverlay() {
  const p = Game.player;
  const playing = Game.state === 'play' && !p.dead;
  // interaction hint
  const h = Game.hint;
  if (playing && h) {
    const s = project(p.x * PX, heightAt(p.x, p.y) + 2.55, p.y * PX);
    const label = (Input.touch ? '' : '<kbd>E</kbd>') + h.label;
    if (OV.hint._l !== label) { OV.hint.innerHTML = label; OV.hint._l = label; }
    OV.hint.hidden = false; place(OV.hint, s.x, s.y);
  } else OV.hint.hidden = true;
  // floating numbers
  let ti = 0;
  for (const t of Game.texts) {
    if (ti >= OV.texts.length) break;
    if (t._h === undefined) { t._h = heightAt(t.x, t.y) + 1.6; t._y0 = t.y; }
    const s = project(t.x * PX, t._h + (1.1 - t.life) * 1.2, t._y0 * PX);
    if (s.behind) continue;
    const el = OV.texts[ti++];
    if (el._t !== t.text) { el.textContent = t.text; el._t = t.text; }
    if (el._c !== t.color) { el.style.color = t.color; el._c = t.color; }
    el.hidden = false; place(el, s.x, s.y); setOpacity(el, clamp(t.life * 1.5, 0, 1));
  }
  for (; ti < OV.texts.length; ti++) OV.texts[ti].hidden = true;
  // health bars on hurt creatures
  let bi = 0;
  if (playing) for (const m of Game.mobs) {
    if (bi >= OV.bars.length) break;
    if (m.hp >= m.maxhp || m.def.behav === 'boss' || dist(m.x, m.y, p.x, p.y) > 500) continue;
    const s = project(m.x * PX, heightAt(m.x, m.y) + m.r * PX * 2.6 + 0.8 + (m.def.night ? 1.2 : 0), m.y * PX);
    if (s.behind) continue;
    const el = OV.bars[bi++];
    el.hidden = false; place(el, s.x, s.y);
    el.firstChild.style.width = clamp(m.hp / m.maxhp * 100, 0, 100) + '%';
    el.classList.toggle('prey', m.def.behav === 'flee');
  }
  for (; bi < OV.bars.length; bi++) OV.bars[bi].hidden = true;
  // objective markers
  const targets = [];
  if (playing) {
    const ob = objectiveTarget();
    if (ob) targets.push(ob);
    const grave = World.structs.find((s) => s.type === 'grave');
    if (grave && (!ob || ob.label !== 'Grave')) targets.push({ x: grave.x, y: grave.y, label: 'Grave', col: '#ffe9a8' });
  }
  const W = window.innerWidth, H = window.innerHeight;
  for (let i = 0; i < OV.marks.length; i++) {
    const el = OV.marks[i], tg = targets[i];
    if (!tg) { el.hidden = true; continue; }
    const s = project(tg.x * PX, heightAt(tg.x, tg.y) + 5, tg.y * PX);
    const mx = 34, top = W < 640 ? 190 : 120, bot = W < 640 ? 200 : 170;
    let x = s.x, y = s.y, off = s.behind || x < mx || x > W - mx || y < top || y > H - bot;
    if (off) {
      // point along the direction from the screen centre
      let dx = x - W / 2, dy = y - H / 2;
      if (s.behind) { dx = -dx; dy = -dy; if (Math.abs(dy) < 1) dy = 1; }
      const kx = (W / 2 - mx) / Math.max(1, Math.abs(dx)), ky = ((dy < 0 ? H / 2 - top : H / 2 - bot)) / Math.max(1, Math.abs(dy));
      const k = Math.min(kx, ky);
      x = W / 2 + dx * k; y = H / 2 + dy * k;
      el.firstChild.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
      el.classList.add('edge');
    } else { el.firstChild.style.transform = ''; el.classList.remove('edge'); }
    el.style.setProperty('--c', tg.col);
    const label = tg.label + ' ' + Math.round(dist(p.x, p.y, tg.x, tg.y) / TILE * 2) + 'm';
    if (el._l !== label) { el.lastChild.textContent = label; el._l = label; }
    el.hidden = false; place(el, x, y);
  }
  // screen effects
  const danger = playing ? Math.max(p.hp < 30 ? (30 - p.hp) / 30 : 0, p.hurt > 0 ? p.hurt * 1.5 : 0) : 0;
  const cold = playing && p.warm < 30 ? (30 - p.warm) / 30 : 0;
  setOpacity(OV.danger, Math.min(0.9, danger));
  setOpacity(OV.cold, cold * 0.8);
  setOpacity(OV.flash, Game.weather.flash * 0.45);
  const sf = Game.sleepFade > 0 ? (Game.sleepFade > 0.8 ? (1.6 - Game.sleepFade) / 0.8 : Game.sleepFade / 0.8) : 0;
  setOpacity(OV.dark, clamp(sf, 0, 1));
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

// ------------------------------------------------------------------ per-frame sync
function syncMobs(dt) {
  const seen = new Set();
  const night = darkness(Game.time);
  for (const m of Game.mobs) {
    seen.add(m);
    let rig = R3.mobs.get(m);
    if (!rig) { rig = mobModel(m.type); R3.mobs.set(m, rig); R3.scene.add(rig.g); rig.heading = 0; }
    const speed = Math.hypot(m.vx, m.vy);
    if (speed > 8) rig.heading = Math.atan2(m.vy, m.vx);
    const y = heightAt(m.x, m.y);
    const g = rig.g;
    g.position.set(m.x * PX, y + (rig.float ? rig.float + Math.sin(m.anim * 3) * 0.15 : 0), m.y * PX);
    const d = -rig.heading - g.rotation.y;
    g.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 10);
    const walk = m.anim * (speed / 18 + 2);
    rig.legs.forEach((l, i) => { l.rotation.z = speed > 8 ? Math.sin(walk + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.6 : 0; });
    if (rig.hop) g.position.y += speed > 8 ? Math.abs(Math.sin(m.anim * 12)) * 0.25 : 0;
    if (m.lunge > 0) g.position.x += Math.cos(rig.heading) * m.lunge * 2, g.position.z += Math.sin(rig.heading) * m.lunge * 2;
    if (rig.arms) {
      const sl = m.slam > 0 ? (0.7 - m.slam) / 0.7 : 0;
      rig.arms.forEach((a, i) => { a.rotation.z = sl ? -sl * 2.4 : Math.sin(m.anim * 4 + i * Math.PI) * 0.3; });
      rig.slamRing.material.opacity = m.slam > 0 ? 0.3 + sl * 0.6 : 0;
      rig.core.rotation.y += dt * 2;
    }
    g.scale.setScalar(m.hurt > 0 ? 1.08 : 1);
    for (const p of rig.parts) if (p.material.emissive) p.material.emissive.setRGB(m.hurt > 0 ? 0.9 : rig.shade ? 0.1 : 0, m.hurt > 0 ? 0.9 : rig.shade ? 0.06 : 0, m.hurt > 0 ? 0.9 : rig.shade ? 0.2 : 0);
    if (rig.glowEyes) for (const e of rig.eyes) e.scale.setScalar((night > 0.3 || m.aggro ? 1.4 : 1) * (e.userData.s || (e.userData.s = e.scale.x)));
    if (m.burn > 0) g.scale.multiplyScalar(Math.max(0.1, 1 - m.burn * 0.6));
  }
  for (const [m, rig] of R3.mobs) if (!seen.has(m)) { R3.scene.remove(rig.g); R3.mobs.delete(m); }
}

function syncStructs(lightsWanted) {
  const p = Game.player;
  const seen = new Set();
  const t = View.clock;
  for (const s of World.structs) {
    if (Math.abs(s.x - p.x) > 2600 || Math.abs(s.y - p.y) > 2600) continue;
    seen.add(s);
    let rig = R3.structs.get(s);
    if (!rig) {
      rig = structModel(s);
      rig.g.position.set(s.x * PX, heightAt(s.x, s.y), s.y * PX);
      if (rig.wall) {
        // turn logs to line up with neighbouring walls
        const n = World.structs.some((o) => o.type === 'wall' && (o.tx === s.tx + 1 || o.tx === s.tx - 1) && o.ty === s.ty);
        rig.g.rotation.y = n ? Math.PI / 2 : 0;
      }
      R3.structs.set(s, rig); R3.scene.add(rig.g);
    }
    const lit = s.type === 'brazier' || (s.type === 'campfire' && s.lit);
    if (rig.flame) {
      rig.flame.g.visible = lit;
      if (lit) {
        const k = s.type === 'campfire' ? clamp(s.fuel / 60, 0.45, 1) : 1;
        rig.flame.parts.forEach((f, i) => { f.scale.y = (0.9 - i * 0.22) * k * (1 + Math.sin(t * 13 + i * 2) * 0.15); f.rotation.y = t * (1 + i); });
        if (Math.random() < 0.12) spawnParticle(rig.g.position.x + rand(-0.2, 0.2), rig.g.position.y + (s.type === 'brazier' ? 1.6 : 0.6), rig.g.position.z + rand(-0.2, 0.2), rand(-0.3, 0.3), rand(1, 2), rand(-0.3, 0.3), '#ffb347', 1.0, 0.6);
        lightsWanted.push({ x: rig.g.position.x, y: rig.g.position.y + 1.4, z: rig.g.position.z, i: 1.25 * (0.85 + Math.sin(t * 17 + s.x) * 0.08 + Math.sin(t * 7 + s.y) * 0.07) * (0.6 + k * 0.4), d: 22, c: 0xff9a40 });
      } else if (s.type === 'campfire' && Math.random() < 0.03) spawnParticle(rig.g.position.x, rig.g.position.y + 0.4, rig.g.position.z, 0, 0.6, 0, '#8c8c8c', 2, 0.2);
    }
    if (s.type === 'beacon') {
      rig.beam.material.opacity = s.lit ? 0.22 + Math.sin(t * 4) * 0.05 : 0;
      rig.crystal.rotation.y += 0.02;
      rig.crystal.material.emissive.setHex(s.lit ? 0xa080ff : 0x5a3a9a);
      lightsWanted.push({ x: rig.g.position.x, y: rig.g.position.y + 6, z: rig.g.position.z, i: s.lit ? 1.1 : 0.4, d: s.lit ? 34 : 10, c: 0xb090ff });
    }
    if (rig.glow) rig.glow.scale.setScalar(0.08 + Math.sin(t * 3) * 0.02);
    rig.g.scale.setScalar(s.hurt > 0 ? 1.06 : 1);
  }
  for (const [s, rig] of R3.structs) if (!seen.has(s)) { R3.scene.remove(rig.g); R3.structs.delete(s); }
}

function syncShrines(lightsWanted, night) {
  if (R3.shrineSeed !== World.seed) {
    for (const r of R3.shrines) R3.scene.remove(r.g);
    R3.shrines = World.shrines.map(shrineModel);
    R3.shrineSeed = World.seed;
  }
  for (const r of R3.shrines) {
    r.g.position.y = heightAt(r.sh.x, r.sh.y);
    r.shard.visible = !r.sh.claimed;
    r.shard.position.y = 2.2 + Math.sin(View.clock * 2) * 0.25;
    r.shard.rotation.y += 0.02;
    r.light.intensity = r.sh.claimed ? 0 : 0.6 + night * 1.2;
    if (!r.sh.claimed && Math.random() < 0.15) spawnParticle(r.g.position.x + rand(-1, 1), r.g.position.y + 1, r.g.position.z + rand(-1, 1), 0, 1, 0, '#b48cff', 1.2, 0.3);
  }
}

function syncPickups() {
  const seen = new Set();
  for (const k of Game.pickups) {
    seen.add(k);
    let sp = R3.pickups.get(k);
    if (!sp) { sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex(k.id), depthWrite: false })); sp.scale.set(0.6, 0.6, 1); R3.pickups.set(k, sp); R3.scene.add(sp); }
    const bob = k.z > 0 ? k.z * PX : Math.sin(View.clock * 4 + k.x) * 0.1 + 0.15;
    sp.position.set(k.x * PX, heightAt(k.x, k.y) + 0.4 + bob, k.y * PX);
    sp.visible = !(k.t > 140 && Math.floor(View.clock * 6) % 2);
  }
  for (const [k, sp] of R3.pickups) if (!seen.has(k)) { R3.scene.remove(sp); sp.material.dispose(); R3.pickups.delete(k); }
}

const PROJ_MATS = {};
function syncProjectiles(lightsWanted) {
  const seen = new Set();
  for (const pr of Game.projectiles) {
    seen.add(pr);
    let m = R3.projs.get(pr);
    if (!m) {
      if (pr.kind === 'arrow') { m = new THREE.Group(); part(m, G.box, '#9a7448', [0, 0, 0], [0.9, 0.04, 0.04]); part(m, G.cone6, '#d9d0bf', [0.48, 0, 0], [0.05, 0.14, 0.05], [0, 0, -Math.PI / 2]); part(m, G.box, '#e8e2cf', [-0.42, 0, 0], [0.16, 0.12, 0.02]); }
      else if (pr.kind === 'boulder') m = new THREE.Mesh(G.dodo, lam('#8d8a84')), m.scale.setScalar(0.55);
      else m = new THREE.Mesh(G.sph, PROJ_MATS.wisp || (PROJ_MATS.wisp = new THREE.MeshBasicMaterial({ color: '#e2d6ff' }))), m.scale.setScalar(0.25);
      R3.projs.set(pr, m); R3.scene.add(m);
    }
    const y0 = heightAt(pr.x, pr.y);
    m.position.set(pr.x * PX, y0 + (pr.kind === 'boulder' ? 1.6 + Math.sin(clamp(pr.life / 1.8, 0, 1) * Math.PI) * 1.2 : 1.1), pr.y * PX);
    m.rotation.y = -Math.atan2(pr.vy, pr.vx);
    if (pr.kind === 'boulder') m.rotation.z += 0.2;
    if (pr.kind === 'wisp') lightsWanted.push({ x: m.position.x, y: m.position.y, z: m.position.z, i: 0.8, d: 6, c: 0x9070ff });
  }
  for (const [pr, m] of R3.projs) if (!seen.has(pr)) { R3.scene.remove(m); R3.projs.delete(pr); }
  // ground-slam rings pushed by the simulation
  const ringsSeen = new Set();
  for (const q of Game.particles) {
    if (!q.ring) continue;
    ringsSeen.add(q);
    let r = R3.rings.get(q);
    if (!r) { r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: '#efe6d6', transparent: true, depthWrite: false })); r.rotation.x = -Math.PI / 2; R3.rings.set(q, r); R3.scene.add(r); }
    const a = clamp(q.life / q.max, 0, 1);
    r.position.set(q.x * PX, heightAt(q.x, q.y) + 0.2, q.y * PX);
    r.scale.setScalar(q.size * PX * (1.1 - a));
    r.material.opacity = a;
  }
  for (const [q, r] of R3.rings) if (!ringsSeen.has(q)) { R3.scene.remove(r); r.geometry.dispose(); R3.rings.delete(q); }
}

function syncPlayer(dt) {
  const p = Game.player, P = R3.player;
  const show = Game.state !== 'title' && !p.dead;
  P.g.visible = show;
  if (!show) return;
  const y = heightAt(p.x, p.y);
  P.g.position.set(p.x * PX, Math.max(y, -0.55), p.y * PX);
  const target = -p.face;
  const d = target - P.g.rotation.y;
  P.g.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 16);
  const sw = p.moving ? Math.sin(p.walk) : 0;
  P.legL.rotation.z = sw * 0.7; P.legR.rotation.z = -sw * 0.7;
  P.armL.rotation.z = -sw * 0.5;
  P.armR.rotation.z = p.swing > 0 ? 1.6 - (1 - p.swing) * 3.0 : sw * 0.5 + 0.3;
  P.armR.rotation.x = p.swing > 0 ? -0.4 : 0;
  P.body.position.y = p.moving ? Math.abs(Math.sin(p.walk)) * 0.06 : Math.sin(View.clock * 2) * 0.01;
  const armorCol = Game.armor === 'hide_armor' ? '#9a6b42' : Game.armor === 'iron_armor' ? '#8f98a3' : '#3f6f8a';
  P.torsoMat.color.set(armorCol);
  P.torsoMat.emissive.setRGB(p.hurt > 0 ? 0.6 : 0, 0, 0);
  if (p.inv > 0 && p.hurt <= 0) P.g.visible = Math.floor(View.clock * 12) % 2 === 0;
  const slot = Game.hotbar[Game.sel];
  const hid = slot ? slot.id : bestWeaponId();
  if (hid !== P.heldId) {
    if (P.held) P.hand.remove(P.held);
    P.held = hid ? heldModel(hid) : null;
    if (P.held) P.hand.add(P.held);
    P.heldId = hid;
  }
}

// ------------------------------------------------------------------ sky and lights
const SKY = {
  day: new THREE.Color('#8ec5ea'), dusk: new THREE.Color('#e98a5c'), night: new THREE.Color('#0a0f22'), blood: new THREE.Color('#2a0609'),
  hemiDay: new THREE.Color('#d6ecff'), hemiNight: new THREE.Color('#3a4a80'), groundDay: new THREE.Color('#4a5a3a'), groundNight: new THREE.Color('#10141c'),
};
const _sky = new THREE.Color(), _tmpc = new THREE.Color();

function updateSky(night, center) {
  const t = Game.time;
  const dusk = t > 0.52 && t < 0.74 ? Math.sin((t - 0.52) / 0.22 * Math.PI) : t > 0.9 ? Math.sin((t - 0.9) / 0.1 * Math.PI) * 0.7 : 0;
  const blood = Game.bloodMoon && night > 0.3;
  _sky.copy(SKY.day).lerp(SKY.dusk, dusk * 0.75).lerp(blood ? SKY.blood : SKY.night, night);
  const rain = Game.weather.rain;
  _sky.lerp(_tmpc.set('#5f6b78'), rain * 0.45 * (1 - night));
  const flash = Game.weather.flash;
  if (flash > 0) _sky.lerp(_tmpc.set('#dfe6ff'), flash * 0.6);
  R3.scene.background.copy(_sky);
  R3.scene.fog.color.copy(_sky);
  const far = lerp(lerp(118, 70, night), 60, rain * 0.6);
  R3.scene.fog.far = Math.min(far, View.viewR * 32 - 6);
  R3.scene.fog.near = R3.scene.fog.far * 0.35;

  R3.hemi.color.copy(SKY.hemiDay).lerp(SKY.hemiNight, night);
  R3.hemi.groundColor.copy(SKY.groundDay).lerp(SKY.groundNight, night);
  R3.hemi.intensity = lerp(0.62, 0.15, night) * (1 - rain * 0.25) + flash * 1.5;
  if (blood) R3.hemi.color.lerp(_tmpc.set('#a03040'), 0.6);

  // sun arcs over the day; the moon takes over at night
  const sa = (t / 0.68) * Math.PI;
  const sunUp = t < 0.7;
  const dir = sunUp ? new THREE.Vector3(Math.cos(sa) * 0.8, Math.max(0.12, Math.sin(sa)), 0.45).normalize()
                    : new THREE.Vector3(-0.4, 0.8, -0.45).normalize();
  R3.sun.position.copy(center).addScaledVector(dir, 60);
  R3.sun.target.position.copy(center);
  R3.sun.color.set(sunUp ? (dusk > 0.3 ? '#ffb07a' : '#fff1d6') : blood ? '#ff6060' : '#9fb4ff');
  R3.sun.intensity = sunUp ? lerp(0.62, 0.2, Math.max(dusk * 0.6, night)) * (1 - rain * 0.4) : 0.2;
  R3.amb.intensity = lerp(0.1, 0.05, night);

  const cam = R3.camera.position;
  R3.sunDisc.visible = sunUp && night < 0.6;
  R3.sunDisc.position.copy(cam).addScaledVector(dir, 260);
  R3.sunDisc.material.color.set(dusk > 0.3 ? '#ffc58a' : '#fff6d0');
  R3.moon.visible = night > 0.2;
  R3.moon.position.copy(cam).add(new THREE.Vector3(-0.4, 0.55, -0.7).normalize().multiplyScalar(260));
  R3.moon.material.color.set(blood ? '#ff5050' : '#e8eeff');
  R3.stars.position.copy(cam);
  R3.stars.material.opacity = night * (1 - rain);
  R3.water.material.color.set(night > 0.5 ? '#173a5a' : '#2c7ab0');
}

function updateLights(wanted, night) {
  const p = Game.player;
  const ppos = new THREE.Vector3(p.x * PX, heightAt(p.x, p.y), p.y * PX);
  wanted.sort((a, b) => (a.x - ppos.x) ** 2 + (a.z - ppos.z) ** 2 - ((b.x - ppos.x) ** 2 + (b.z - ppos.z) ** 2));
  for (let i = 0; i < R3.fires.length; i++) {
    const l = R3.fires[i], w = wanted[i];
    if (!w) { l.intensity = 0; continue; }
    l.position.set(w.x, w.y, w.z);
    l.color.setHex(w.c);
    l.distance = w.d;
    l.intensity = w.i * (0.25 + night * 0.75);
  }
  const held = selItem();
  const torch = Game.state === 'play' && !p.dead && held && held.kind === 'torch';
  const cdx = R3.camera.position.x - ppos.x, cdz = R3.camera.position.z - ppos.z, cl = Math.hypot(cdx, cdz) || 1;
  R3.plight.position.set(ppos.x + cdx / cl * 1.2, ppos.y + 2.4, ppos.z + cdz / cl * 1.2);
  R3.plight.intensity = Game.state === 'play' && !p.dead ? (torch ? 1.6 * (0.92 + Math.sin(View.clock * 19) * 0.08) : 0.55) * night : 0;
  R3.plight.distance = torch ? 22 : 9;
  R3.plight.color.set(torch ? '#ffb060' : '#b8c8ff');
  // glowing flora
  for (const t in GLOWY) R3.objMeshes[t].material.emissiveIntensity = night * 0.9;
  if (torch && Math.random() < 0.3) {
    const hp = new THREE.Vector3(); R3.player.hand.getWorldPosition(hp);
    spawnParticle(hp.x + rand(-0.1, 0.1), hp.y + 0.3, hp.z + rand(-0.1, 0.1), rand(-0.2, 0.2), rand(0.8, 1.4), rand(-0.2, 0.2), '#ffb347', 0.5, 0.5);
  }
}

function updateWeather(dt, center) {
  const rain = Game.weather.rain;
  const snowy = TILES[tileAtPx(Game.player.x, Game.player.y)].temp <= -2;
  const n = Math.floor(rain * 700);
  R3.rain.visible = n > 0;
  if (!n) return;
  const arr = R3.rain.geometry.attributes.position.array;
  R3.rain.material.color.set(snowy ? '#ffffff' : '#bfd2ee');
  R3.rain.material.opacity = snowy ? 0.9 : 0.45;
  for (let i = 0; i < 700; i++) {
    const d = R3.rainDrops[i];
    if (i >= n) { arr.fill(0, i * 6, i * 6 + 6); continue; }
    if (snowy) { d[1] -= 2.2 * d[3] * dt; d[0] += Math.sin(View.clock + i) * 0.6 * dt; }
    else { d[1] -= 26 * d[3] * dt; d[0] += 2 * dt; }
    if (d[1] < -2) { d[1] = rand(18, 26); d[0] = rand(-30, 30); d[2] = rand(-30, 30); }
    const x = center.x + d[0], y = center.y + d[1], z = center.z + d[2];
    const len = snowy ? 0.08 : 0.7;
    arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
    arr[i * 6 + 3] = x - (snowy ? 0.05 : 0.05); arr[i * 6 + 4] = y + len; arr[i * 6 + 5] = z;
  }
  R3.rain.geometry.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------------ main render
function resetScene() {
  for (const [, m] of R3.chunkMeshes) { R3.scene.remove(m); m.geometry.dispose(); }
  R3.chunkMeshes.clear();
  for (const map of [R3.mobs, R3.structs, R3.projs]) { for (const [, r] of map) R3.scene.remove(r.g || r); map.clear(); }
  for (const [, sp] of R3.pickups) R3.scene.remove(sp);
  R3.pickups.clear();
  R3.camTarget.set(0, 0, 0);
  R3.objDirty = true; R3.objCenter = null; R3.tall = []; R3.ghosted = []; R3.shaking = [];
  R3.pLife.fill(0); R3.pPos.fill(-9999);
  R3.worldSeed = World.seed;
  View.yaw = -Math.PI / 2; View.pitch = window.innerWidth < window.innerHeight ? 0.72 : 0.6;
}

function render(dt) {
  View.clock += dt;
  if (R3.worldSeed !== World.seed || R3.genStamp !== Game.genStamp) { resetScene(); R3.genStamp = Game.genStamp; }
  const p = Game.player;
  const title = Game.state === 'title';

  // camera
  if (title) View.yaw += dt * 0.06;
  const focusX = title ? Game.cam.x : p.x, focusY = title ? Game.cam.y : p.y;
  const fy = heightAt(focusX, focusY);
  const tgt = R3.camTarget;
  const want = new THREE.Vector3(focusX * PX, Math.max(fy, 0) + 1.3, focusY * PX);
  if (title) want.y += 6;
  if (tgt.lengthSq() === 0 || tgt.distanceTo(want) > 40) tgt.copy(want); else tgt.lerp(want, Math.min(1, dt * 8));
  const dist3 = title ? 34 : View.dist, pitch = title ? 0.42 : View.pitch;
  const cx = tgt.x - Math.cos(View.yaw) * Math.cos(pitch) * dist3;
  const cz = tgt.z - Math.sin(View.yaw) * Math.cos(pitch) * dist3;
  let cy = tgt.y + Math.sin(pitch) * dist3;
  const ground = heightAt(cx / PX, cz / PX);
  cy = Math.max(cy, Math.max(ground, 0) + 1.2);
  R3.camera.position.set(cx, cy, cz);
  if (Game.shake > 0.2) R3.camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(Game.shake * 0.02));
  R3.camera.lookAt(tgt);
  Game.cam.x = title ? Game.cam.x + dt * 30 : p.x; Game.cam.y = title ? Game.cam.y : p.y;

  updateChunks(focusX, focusY);
  if (R3.objDirty || View.clock - R3.lastRebuild > 4) rebuildObjects(focusX, focusY);
  updateShakes(dt);
  updateOccluders();

  R3.water.position.x = Math.round(tgt.x / 2) * 2; R3.water.position.z = Math.round(tgt.z / 2) * 2;
  R3.water.position.y = -0.14 + Math.sin(View.clock * 0.8) * 0.04;

  const night = darkness(Game.time);
  const lightsWanted = [];
  syncMobs(dt);
  syncStructs(lightsWanted);
  syncShrines(lightsWanted, night);
  syncPickups();
  syncProjectiles(lightsWanted);
  syncPlayer(dt);
  updateParticles(dt);

  // placement ghost
  const gh = Game.ghost;
  R3.ghost.visible = !!(gh && Game.state === 'play');
  if (R3.ghost.visible) {
    R3.ghost.position.set(gh.x * PX, heightAt(gh.x, gh.y) + 0.1 + Math.sin(View.clock * 5) * 0.04, gh.y * PX);
    R3.ghost.material.color.set(gh.ok ? '#8cffa0' : '#ff6a6a');
  }

  updateSky(night, tgt);
  updateLights(lightsWanted, night);
  updateWeather(dt, tgt);

  R3.renderer.render(R3.scene, R3.camera);
  updateOverlay();
  adaptQuality(dt);
}

function adaptQuality(dt) {
  if (View.lowQuality || Game.state !== 'play') return;
  View.slowFrames = dt > 0.034 ? View.slowFrames + 1 : Math.max(0, View.slowFrames - 0.5);
  if (View.slowFrames > 90) {
    View.lowQuality = true;
    View.viewR = 3; View.objR = 2;
    resizeView();
    R3.objDirty = true;
  }
}

// ------------------------------------------------------------------ camera input
function orbitCamera(dx, dy) {
  View.yaw += dx * 0.008;
  View.pitch = clamp(View.pitch + dy * 0.005, 0.18, 1.25);
}
