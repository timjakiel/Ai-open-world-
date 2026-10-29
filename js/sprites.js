'use strict';
// Pre-rendered sprites for world objects and structures, plus item icons.

const SPR = 2; // sprites are rendered at 2x and drawn at half size for crisp scaling
const Sprites = {};

function makeSprite(w, h, ax, ay, fn) {
  const c = makeCanvas(w * SPR, h * SPR);
  const g = c.getContext('2d');
  g.scale(SPR, SPR);
  fn(g, w, h);
  return { c, w, h, ax, ay };
}

function circle(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function ellipse(g, x, y, rx, ry, col) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
function poly(g, pts, col) { g.fillStyle = col; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); }

function buildSprites() {
  const greens = [['#2f6b2c', '#3f8a37', '#5aa84a'], ['#2a5f34', '#3a7d42', '#56a05a'], ['#3b6b25', '#4f8a2f', '#73ad45']];
  Sprites.tree = greens.map((p) => makeSprite(64, 84, 32, 76, (g) => {
    ellipse(g, 32, 76, 20, 7, 'rgba(0,0,0,0.28)');
    g.fillStyle = '#5b3d22'; g.fillRect(28, 46, 8, 30);
    g.fillStyle = '#4a311b'; g.fillRect(28, 46, 3, 30);
    circle(g, 22, 40, 17, p[0]); circle(g, 42, 40, 17, p[0]); circle(g, 32, 26, 20, p[0]);
    circle(g, 24, 36, 14, p[1]); circle(g, 40, 34, 14, p[1]); circle(g, 32, 22, 16, p[1]);
    circle(g, 27, 18, 8, p[2]); circle(g, 38, 27, 6, p[2]); circle(g, 20, 32, 5, p[2]);
  }));
  Sprites.pine = [0, 1, 2].map((v) => makeSprite(56, 88, 28, 80, (g) => {
    ellipse(g, 28, 80, 16, 6, 'rgba(0,0,0,0.28)');
    g.fillStyle = '#4a311b'; g.fillRect(25, 64, 6, 16);
    const cols = ['#1f4d3a', '#28604a', '#327258'];
    for (let i = 0; i < 4; i++) {
      const y = 66 - i * 15, w = 26 - i * 5;
      poly(g, [28, y - 24, 28 + w, y, 28 - w, y], cols[i % 3]);
      poly(g, [28, y - 24, 28 + w * 0.5, y - 10, 28 - w * 0.7, y - 6], 'rgba(255,255,255,' + (v === 2 ? 0.0 : 0.75) + ')');
    }
  }));
  Sprites.palm = [0, 1, 2].map((v) => makeSprite(70, 80, 35, 74, (g) => {
    ellipse(g, 35, 74, 14, 5, 'rgba(0,0,0,0.25)');
    g.strokeStyle = '#8a6a3c'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(35, 74); g.quadraticCurveTo(28 + v * 4, 50, 38, 22); g.stroke();
    g.strokeStyle = '#6f532c'; g.lineWidth = 2;
    for (let y = 70; y > 26; y -= 7) { g.beginPath(); g.moveTo(31, y); g.lineTo(39, y - 1); g.stroke(); }
    const leaf = (a, l, c) => {
      g.save(); g.translate(38, 22); g.rotate(a);
      g.fillStyle = c; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(l * 0.5, -10, l, 6); g.quadraticCurveTo(l * 0.5, -2, 0, 0); g.fill();
      g.restore();
    };
    for (let i = 0; i < 7; i++) leaf(i * 0.9, 28, i % 2 ? '#3f8f3a' : '#57a845');
    circle(g, 36, 25, 3, '#6b4a22'); circle(g, 41, 25, 3, '#6b4a22');
  }));
  Sprites.deadtree = [0, 1, 2].map((v) => makeSprite(56, 72, 28, 66, (g) => {
    ellipse(g, 28, 66, 14, 5, 'rgba(0,0,0,0.25)');
    g.strokeStyle = '#5e5446'; g.lineCap = 'round';
    g.lineWidth = 6; g.beginPath(); g.moveTo(28, 66); g.lineTo(28, 30); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(28, 44); g.lineTo(14 - v * 2, 28); g.moveTo(28, 38); g.lineTo(42, 22 + v * 3); g.moveTo(28, 30); g.lineTo(24, 14); g.moveTo(20, 34); g.lineTo(12, 36); g.stroke();
    g.strokeStyle = '#776b5a'; g.lineWidth = 2; g.beginPath(); g.moveTo(29, 64); g.lineTo(29, 32); g.stroke();
  }));
  const rockBase = (g, tint) => {
    ellipse(g, 24, 34, 18, 6, 'rgba(0,0,0,0.3)');
    poly(g, [6, 32, 9, 16, 20, 8, 34, 10, 42, 20, 42, 32], shade(tint, -0.25));
    poly(g, [9, 26, 11, 16, 20, 10, 32, 12, 38, 20, 34, 26], tint);
    poly(g, [14, 18, 20, 12, 28, 13, 22, 18], shade(tint, 0.3));
  };
  Sprites.rock = ['#8d8a84', '#9a948a', '#7f8288'].map((c) => makeSprite(48, 40, 24, 32, (g) => rockBase(g, c)));
  Sprites.iron = [0, 1, 2].map((v) => makeSprite(48, 40, 24, 32, (g) => {
    rockBase(g, '#6f6a66');
    const spots = [[16, 20], [28, 16], [30, 25], [20, 27], [36, 21]];
    spots.forEach(([x, y], i) => { if ((i + v) % 5 !== 4) { circle(g, x, y, 3, '#c57a3c'); circle(g, x - 1, y - 1, 1.3, '#f0b070'); } });
  }));
  Sprites.crystal = [0, 1, 2].map((v) => makeSprite(48, 52, 24, 44, (g) => {
    ellipse(g, 24, 44, 16, 5, 'rgba(0,0,0,0.3)');
    poly(g, [8, 44, 12, 34, 36, 33, 40, 44], '#55525e');
    const shards = [[24, 4, 6], [14, 14, 5], [34, 16, 5], [19, 22, 4]];
    shards.forEach(([x, y, w], i) => {
      poly(g, [x, y, x + w, 38, x - w, 38], i % 2 ? '#6fd6ef' : '#9ae9fa');
      poly(g, [x, y, x + w * 0.4, 38, x - w * 0.2, 38], 'rgba(255,255,255,0.5)');
    });
  }));
  Sprites.cactus = [0, 1, 2].map((v) => makeSprite(40, 60, 20, 54, (g) => {
    ellipse(g, 20, 54, 11, 4, 'rgba(0,0,0,0.25)');
    const col = '#3f8f4f', dk = '#2f6e3c';
    g.fillStyle = col; roundRect(g, 15, 10, 10, 44, 5);
    roundRect(g, 4, 22 + v * 3, 8, 16, 4); g.fillRect(8, 34 + v * 3, 8, 5);
    roundRect(g, 28, 16, 8, 16, 4); g.fillRect(24, 28, 8, 5);
    g.fillStyle = dk; g.fillRect(19, 12, 2, 40);
    g.fillStyle = '#f7e9b0';
    for (let y = 14; y < 50; y += 7) { g.fillRect(14, y, 1, 1); g.fillRect(25, y + 3, 1, 1); }
    if (v === 1) { circle(g, 20, 10, 3, '#e86aa0'); }
  }));
  Sprites.bush = [0, 1, 2].map((v) => makeSprite(36, 30, 18, 24, (g) => {
    ellipse(g, 18, 25, 13, 4, 'rgba(0,0,0,0.22)');
    g.strokeStyle = ['#6aa84f', '#8cb85a', '#5f9a46'][v]; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      const a = -Math.PI / 2 + (i - 5) * 0.2;
      g.beginPath(); g.moveTo(18, 25); g.quadraticCurveTo(18 + Math.cos(a) * 8, 25 + Math.sin(a) * 10, 18 + Math.cos(a) * 14, 25 + Math.sin(a) * 20); g.stroke();
    }
  }));
  Sprites.berry = [0, 1, 2].map((v) => makeSprite(40, 34, 20, 28, (g) => {
    ellipse(g, 20, 28, 15, 5, 'rgba(0,0,0,0.25)');
    circle(g, 13, 20, 9, '#2f6b33'); circle(g, 27, 20, 9, '#2f6b33'); circle(g, 20, 13, 10, '#3b7d3c');
    circle(g, 17, 11, 4, '#4f9a4c');
    const c = ['#d6304a', '#5a3fc0', '#e0563a'][v];
    [[12, 18], [20, 22], [27, 15], [22, 10], [15, 25], [29, 23]].forEach(([x, y]) => { circle(g, x, y, 2.6, c); circle(g, x - 0.8, y - 0.8, 0.9, 'rgba(255,255,255,0.7)'); });
  }));
  Sprites.reeds = [0, 1, 2].map((v) => makeSprite(30, 44, 15, 40, (g) => {
    ellipse(g, 15, 40, 10, 3, 'rgba(0,0,0,0.2)');
    for (let i = 0; i < 6; i++) {
      const x = 6 + i * 3.5, top = 8 + ((i * 7 + v * 3) % 10);
      g.strokeStyle = i % 2 ? '#6f8f45' : '#87a356'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, 40); g.lineTo(x + (i - 3) * 0.8, top); g.stroke();
      if (i % 2 === 0) { g.fillStyle = '#6b4a2b'; g.fillRect(x + (i - 3) * 0.8 - 1.5, top, 3, 7); }
    }
  }));
  Sprites.mushroom = [0, 1, 2].map((v) => makeSprite(30, 26, 15, 22, (g) => {
    ellipse(g, 15, 22, 10, 3, 'rgba(0,0,0,0.2)');
    const caps = [[9, 16, 5], [19, 14, 6], [14, 20, 3.5]];
    caps.forEach(([x, y, r]) => {
      g.fillStyle = '#e8e2cf'; g.fillRect(x - 1.2, y, 2.4, 22 - y);
      g.fillStyle = ['#43c6c9', '#6fa0ff', '#9be35b'][v];
      g.beginPath(); g.arc(x, y, r, Math.PI, 0); g.fill();
      circle(g, x - r * 0.4, y - r * 0.4, r * 0.25, 'rgba(255,255,255,0.8)');
    });
  }));
  Sprites.flint = [0, 1, 2].map((v) => makeSprite(30, 20, 15, 15, (g) => {
    ellipse(g, 15, 15, 11, 3, 'rgba(0,0,0,0.22)');
    poly(g, [5, 15, 7, 9, 13, 8, 15, 14], '#8c8a86');
    poly(g, [14, 15, 16, 7, 23, 6, 25, 15], '#a3a09a');
    poly(g, [16, 9, 21, 7, 20, 10], '#cfccc4');
  }));

  // ------------------------------------------------ structures
  Sprites.campfire = makeSprite(40, 30, 20, 20, (g) => {
    ellipse(g, 20, 22, 16, 6, 'rgba(0,0,0,0.3)');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      circle(g, 20 + Math.cos(a) * 13, 20 + Math.sin(a) * 6, 3.6, i % 2 ? '#7d7a74' : '#96938c');
    }
    g.strokeStyle = '#5b3d22'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(12, 23); g.lineTo(28, 16); g.moveTo(12, 16); g.lineTo(28, 23); g.stroke();
    ellipse(g, 20, 20, 6, 3, '#2a1a10');
  });
  Sprites.brazier = makeSprite(36, 44, 18, 38, (g) => {
    ellipse(g, 18, 38, 12, 4, 'rgba(0,0,0,0.3)');
    g.fillStyle = '#5f5a52'; g.fillRect(14, 22, 8, 16);
    g.fillStyle = '#77736b'; g.fillRect(10, 34, 16, 4);
    poly(g, [4, 14, 32, 14, 27, 24, 9, 24], '#6d675e');
    poly(g, [4, 14, 32, 14, 30, 17, 6, 17], '#8b857b');
    g.fillStyle = '#c57a3c'; g.fillRect(8, 19, 20, 2);
  });
  Sprites.wall = makeSprite(32, 46, 16, 40, (g) => {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 34, 32, 8);
    for (let i = 0; i < 4; i++) {
      const x = i * 8, top = 4 + ((i * 5) % 6);
      g.fillStyle = i % 2 ? '#7a5631' : '#8a6239'; g.fillRect(x, top, 8, 38 - top);
      poly(g, [x, top, x + 4, top - 5, x + 8, top], i % 2 ? '#7a5631' : '#8a6239');
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 6, top, 2, 38 - top);
    }
    g.fillStyle = '#5b3d22'; g.fillRect(0, 14, 32, 3); g.fillRect(0, 28, 32, 3);
  });
  Sprites.spikes = makeSprite(36, 30, 18, 20, (g) => {
    ellipse(g, 18, 22, 15, 5, 'rgba(0,0,0,0.25)');
    for (let i = 0; i < 5; i++) {
      const x = 6 + i * 6, y = 22 + (i % 2) * 2;
      poly(g, [x - 3, y, x + 3, y, x + 1, y - 14 + (i % 2) * 3], '#9a7448');
      poly(g, [x - 1, y - 6, x + 1, y - 6, x + 1, y - 14 + (i % 2) * 3], '#d9d0bf');
    }
  });
  Sprites.workbench = makeSprite(44, 36, 22, 28, (g) => {
    ellipse(g, 22, 30, 18, 5, 'rgba(0,0,0,0.3)');
    g.fillStyle = '#5b3d22'; g.fillRect(6, 16, 4, 14); g.fillRect(34, 16, 4, 14);
    g.fillStyle = '#9a7041'; g.fillRect(2, 10, 40, 8);
    g.fillStyle = '#b58750'; g.fillRect(2, 10, 40, 3);
    g.fillStyle = '#8d8a84'; g.fillRect(8, 6, 8, 5);
    g.fillStyle = '#6b4a2b'; g.fillRect(24, 4, 2, 7); g.fillStyle = '#a3a09a'; g.fillRect(21, 3, 8, 3);
  });
  Sprites.bed = makeSprite(30, 44, 15, 26, (g) => {
    ellipse(g, 15, 28, 14, 16, 'rgba(0,0,0,0.2)');
    g.fillStyle = '#7d5b3a'; roundRect(g, 3, 8, 24, 34, 5);
    g.fillStyle = '#b08a5c'; roundRect(g, 5, 18, 20, 22, 4);
    g.fillStyle = '#e4dccb'; roundRect(g, 7, 10, 16, 8, 4);
    g.fillStyle = '#8f6d48'; g.fillRect(5, 24, 20, 2);
  });
  Sprites.beacon = makeSprite(48, 96, 24, 86, (g) => {
    ellipse(g, 24, 86, 20, 7, 'rgba(0,0,0,0.35)');
    poly(g, [8, 86, 40, 86, 36, 76, 12, 76], '#5f5a52');
    poly(g, [14, 76, 34, 76, 30, 26, 18, 26], '#77736b');
    poly(g, [14, 76, 20, 76, 20, 26, 18, 26], '#8e897f');
    g.fillStyle = '#4c4842'; g.fillRect(16, 40, 16, 2); g.fillRect(16, 58, 16, 2);
    poly(g, [24, 4, 32, 22, 24, 30, 16, 22], '#b48cff');
    poly(g, [24, 4, 27, 22, 24, 30], 'rgba(255,255,255,0.45)');
  });
  Sprites.grave = makeSprite(28, 36, 14, 28, (g) => {
    ellipse(g, 14, 30, 12, 5, '#5a4632');
    g.fillStyle = '#8a8478'; g.fillRect(11, 4, 6, 24); g.fillRect(5, 10, 18, 5);
    g.fillStyle = '#a49e92'; g.fillRect(11, 4, 2, 24);
  });
  Sprites.pillar = [0, 1, 2].map((v) => makeSprite(30, 70, 15, 64, (g) => {
    ellipse(g, 15, 64, 13, 5, 'rgba(0,0,0,0.3)');
    poly(g, [5, 64, 25, 64, 23, 8 + v * 6, 7, 10 + v * 4], '#6e6a62');
    poly(g, [5, 64, 10, 64, 10, 10 + v * 4, 7, 10 + v * 4], '#88837a');
    g.fillStyle = '#4e7a4a'; g.fillRect(7, 40 + v * 4, 6, 5); g.fillRect(16, 22, 4, 3);
  }));
  Sprites.altar = makeSprite(52, 44, 26, 34, (g) => {
    ellipse(g, 26, 36, 24, 7, 'rgba(0,0,0,0.3)');
    poly(g, [4, 36, 48, 36, 44, 22, 8, 22], '#6e6a62');
    poly(g, [8, 22, 44, 22, 40, 16, 12, 16], '#8e897f');
    g.fillStyle = '#5a5650'; g.fillRect(14, 26, 24, 2);
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
}

function drawSprite(ctx, spr, x, y, alpha) {
  if (alpha !== undefined && alpha < 1) { ctx.globalAlpha = alpha; }
  ctx.drawImage(spr.c, x - spr.ax, y - spr.ay, spr.w, spr.h);
  if (alpha !== undefined && alpha < 1) ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- item icons
const iconCache = {};
function iconURL(id) {
  if (iconCache[id]) return iconCache[id];
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  g.scale(2, 2);
  drawIcon(g, id);
  iconCache[id] = c.toDataURL();
  return iconCache[id];
}

function drawIcon(g, id) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  const handle = (x1, y1, x2, y2) => { g.strokeStyle = '#7a5631'; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  switch (id) {
    case 'wood':
      g.save(); g.translate(16, 16); g.rotate(-0.5);
      g.fillStyle = '#8a6239'; g.fillRect(-12, -5, 22, 10);
      ellipse(g, 10, 0, 4, 5, '#c79a63'); ellipse(g, 10, 0, 2, 2.5, '#9a7041');
      g.fillStyle = '#6b4a2b'; g.fillRect(-10, -2, 14, 1.5);
      g.restore(); break;
    case 'stone':
      poly(g, [5, 24, 7, 12, 15, 7, 25, 10, 28, 22, 20, 27], '#8d8a84');
      poly(g, [9, 14, 15, 9, 21, 11, 14, 15], '#bdb9b0'); break;
    case 'fiber':
      g.strokeStyle = '#7db04a'; g.lineWidth = 2;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(8 + i * 4, 28); g.quadraticCurveTo(4 + i * 6, 14, 12 + i * 3, 4); g.stroke(); }
      g.fillStyle = '#c9a85a'; g.fillRect(9, 18, 16, 3); break;
    case 'iron':
      poly(g, [4, 24, 7, 12, 16, 7, 26, 10, 28, 22, 20, 27], '#6f6a66');
      circle(g, 12, 15, 3, '#c57a3c'); circle(g, 20, 19, 3.5, '#c57a3c'); circle(g, 19, 11, 2, '#f0b070'); break;
    case 'crystal':
      poly(g, [16, 2, 24, 16, 16, 30, 8, 16], '#6fd6ef'); poly(g, [16, 2, 19, 16, 16, 30], '#c8f6ff'); break;
    case 'hide':
      poly(g, [6, 8, 12, 5, 20, 5, 26, 8, 24, 16, 27, 26, 18, 24, 14, 24, 5, 26, 8, 16], '#9a6b42');
      poly(g, [10, 10, 22, 10, 20, 20, 12, 20], '#b5845a'); break;
    case 'shard':
      poly(g, [16, 2, 26, 26, 6, 26], '#9d7bff'); poly(g, [16, 2, 19, 26, 12, 26], '#e2d6ff');
      circle(g, 16, 18, 2, '#ffffff'); break;
    case 'berry':
      circle(g, 11, 18, 6, '#d6304a'); circle(g, 21, 16, 6, '#c42a42'); circle(g, 16, 24, 5, '#e0405a');
      poly(g, [14, 10, 20, 4, 22, 10], '#3f8a37'); circle(g, 9, 16, 1.5, '#ffd0d8'); break;
    case 'mushroom':
      g.fillStyle = '#e8e2cf'; g.fillRect(14, 15, 5, 13);
      g.fillStyle = '#43c6c9'; g.beginPath(); g.arc(16.5, 16, 11, Math.PI, 0); g.fill();
      circle(g, 12, 11, 2, '#dffbfb'); circle(g, 20, 9, 1.5, '#dffbfb'); break;
    case 'cactus':
      g.fillStyle = '#3f8f4f'; roundRect(g, 7, 8, 18, 18, 6);
      g.fillStyle = '#9fd17a'; roundRect(g, 10, 11, 12, 12, 4); g.fillStyle = '#f7e9b0'; g.fillRect(9, 9, 1, 1); g.fillRect(23, 12, 1, 1); break;
    case 'meat':
      ellipse(g, 15, 16, 10, 8, '#d9616a'); ellipse(g, 13, 14, 5, 3, '#f0a3a8');
      g.fillStyle = '#efe6d6'; g.fillRect(22, 18, 7, 3); circle(g, 29, 18, 2.5, '#efe6d6'); circle(g, 29, 22, 2.5, '#efe6d6'); break;
    case 'cooked':
      ellipse(g, 15, 16, 10, 8, '#8a4a25'); ellipse(g, 13, 13, 5, 3, '#b46a37');
      g.fillStyle = '#efe6d6'; g.fillRect(22, 18, 7, 3); circle(g, 29, 18, 2.5, '#efe6d6'); circle(g, 29, 22, 2.5, '#efe6d6'); break;
    case 'stew':
      ellipse(g, 16, 20, 13, 7, '#6b4a2b'); ellipse(g, 16, 17, 11, 4, '#c26a2e');
      circle(g, 12, 17, 2, '#e8c14a'); circle(g, 19, 16, 2, '#9be35b'); circle(g, 16, 18, 1.5, '#7a2c1d');
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(12, 9); g.quadraticCurveTo(14, 5, 12, 2); g.moveTo(20, 9); g.quadraticCurveTo(22, 5, 20, 2); g.stroke(); break;
    case 'bandage':
      g.save(); g.translate(16, 16); g.rotate(-0.6);
      g.fillStyle = '#efe6d6'; roundRect(g, -13, -5, 26, 10, 3);
      g.fillStyle = '#d6304a'; g.fillRect(-2, -4, 4, 8); g.fillRect(-4, -2, 8, 4); g.restore(); break;
    case 'waterskin':
      g.fillStyle = '#9a6b42'; roundRect(g, 7, 9, 18, 20, 8);
      g.fillStyle = '#7a5631'; g.fillRect(13, 4, 6, 7);
      g.fillStyle = '#5ab0e0'; roundRect(g, 10, 17, 12, 8, 4); break;
    case 'torch':
      handle(10, 28, 19, 12);
      g.fillStyle = '#5a3a1e'; g.fillRect(17, 10, 5, 5);
      circle(g, 21, 8, 6, '#ff9a2e'); circle(g, 21, 9, 3.5, '#ffe27a'); break;
    case 'axe1': case 'axe2':
      handle(8, 28, 22, 6);
      poly(g, [17, 6, 28, 4, 28, 16, 21, 13], id === 'axe1' ? '#8d8a84' : '#bfc6cf');
      poly(g, [26, 4, 28, 4, 28, 16, 26, 15], id === 'axe1' ? '#bdb9b0' : '#eef3f7'); break;
    case 'pick1': case 'pick2': {
      handle(8, 28, 22, 8);
      const c = id === 'pick1' ? '#8d8a84' : '#bfc6cf';
      g.strokeStyle = c; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 6); g.quadraticCurveTo(22, 2, 30, 14); g.stroke(); break;
    }
    case 'sword1': case 'sword2': {
      const c = id === 'sword1' ? '#a3a09a' : '#d8e0e8';
      poly(g, [6, 26, 9, 23, 26, 4, 29, 3, 28, 6, 9, 26], c);
      poly(g, [9, 23, 26, 4, 27, 5, 10, 24], 'rgba(255,255,255,0.6)');
      g.strokeStyle = '#6b4a2b'; g.lineWidth = 3; g.beginPath(); g.moveTo(5, 20); g.lineTo(12, 27); g.stroke();
      g.strokeStyle = id === 'sword2' ? '#6fd6ef' : '#6b4a2b'; g.beginPath(); g.moveTo(3, 29); g.lineTo(7, 25); g.stroke(); break;
    }
    case 'bow':
      g.strokeStyle = '#8a6239'; g.lineWidth = 3; g.beginPath(); g.arc(8, 16, 14, -1.1, 1.1); g.stroke();
      g.strokeStyle = '#e8e2cf'; g.lineWidth = 1; g.beginPath(); g.moveTo(14.4, 3.6); g.lineTo(14.4, 28.4); g.stroke(); break;
    case 'arrow':
      g.strokeStyle = '#9a7448'; g.lineWidth = 2; g.beginPath(); g.moveTo(5, 27); g.lineTo(26, 6); g.stroke();
      poly(g, [26, 3, 29, 6, 23, 9], '#bdb9b0'); poly(g, [5, 22, 9, 27, 4, 28], '#e8e2cf'); break;
    case 'hide_armor':
      poly(g, [8, 6, 13, 4, 16, 8, 19, 4, 24, 6, 29, 14, 25, 16, 24, 28, 8, 28, 7, 16, 3, 14], '#9a6b42');
      g.fillStyle = '#e4dccb'; g.fillRect(8, 24, 16, 4); g.fillStyle = '#7a5631'; g.fillRect(15, 9, 2, 15); break;
    case 'iron_armor':
      poly(g, [8, 6, 13, 4, 16, 8, 19, 4, 24, 6, 29, 14, 25, 16, 24, 28, 8, 28, 7, 16, 3, 14], '#8f98a3');
      g.fillStyle = '#c3cbd4';
      for (let y = 10; y < 26; y += 4) for (let x = 10 + (y % 8 ? 2 : 0); x < 23; x += 4) g.fillRect(x, y, 2, 2); break;
    case 'campfire':
      ellipse(g, 16, 24, 13, 5, '#7d7a74');
      g.strokeStyle = '#5b3d22'; g.lineWidth = 3; g.beginPath(); g.moveTo(7, 26); g.lineTo(25, 19); g.moveTo(7, 19); g.lineTo(25, 26); g.stroke();
      poly(g, [16, 3, 23, 18, 16, 22, 9, 18], '#ff8a2e'); poly(g, [16, 10, 19, 18, 16, 21, 13, 18], '#ffe27a'); break;
    case 'brazier':
      g.fillStyle = '#5f5a52'; g.fillRect(13, 18, 6, 10); g.fillRect(8, 26, 16, 3);
      poly(g, [4, 12, 28, 12, 24, 19, 8, 19], '#77736b');
      poly(g, [16, 1, 22, 12, 10, 12], '#ff8a2e'); poly(g, [16, 6, 18, 12, 14, 12], '#ffe27a'); break;
    case 'wall':
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#7a5631' : '#8a6239'; g.fillRect(3 + i * 7, 6 + (i % 2) * 2, 6, 22); poly(g, [3 + i * 7, 6 + (i % 2) * 2, 6 + i * 7, 2 + (i % 2) * 2, 9 + i * 7, 6 + (i % 2) * 2], i % 2 ? '#7a5631' : '#8a6239'); }
      g.fillStyle = '#5b3d22'; g.fillRect(2, 12, 28, 2); g.fillRect(2, 22, 28, 2); break;
    case 'spikes':
      for (let i = 0; i < 4; i++) { const x = 6 + i * 7; poly(g, [x - 3, 28, x + 3, 28, x, 6 + (i % 2) * 5], '#9a7448'); poly(g, [x - 1, 14, x + 1, 14, x, 6 + (i % 2) * 5], '#d9d0bf'); } break;
    case 'workbench':
      g.fillStyle = '#5b3d22'; g.fillRect(6, 16, 3, 12); g.fillRect(23, 16, 3, 12);
      g.fillStyle = '#9a7041'; g.fillRect(2, 12, 28, 6); g.fillStyle = '#8d8a84'; g.fillRect(6, 7, 7, 5);
      g.fillStyle = '#a3a09a'; g.fillRect(17, 6, 9, 3); g.fillStyle = '#6b4a2b'; g.fillRect(20, 8, 2, 4); break;
    case 'bed':
      g.fillStyle = '#7d5b3a'; roundRect(g, 4, 6, 24, 22, 4); g.fillStyle = '#b08a5c'; roundRect(g, 6, 13, 20, 13, 3);
      g.fillStyle = '#e4dccb'; roundRect(g, 8, 7, 16, 6, 3); break;
    case 'beacon':
      poly(g, [10, 30, 22, 30, 20, 12, 12, 12], '#77736b');
      poly(g, [16, 1, 21, 9, 16, 13, 11, 9], '#b48cff'); circle(g, 16, 7, 1.5, '#ffffff'); break;
    // HUD glyphs
    case 'hp': g.fillStyle = '#e5484d'; g.beginPath(); g.moveTo(16, 27); g.bezierCurveTo(2, 18, 3, 6, 10, 6); g.bezierCurveTo(13, 6, 15, 8, 16, 11); g.bezierCurveTo(17, 8, 19, 6, 22, 6); g.bezierCurveTo(29, 6, 30, 18, 16, 27); g.fill(); break;
    case 'food': ellipse(g, 13, 13, 9, 8, '#e0a040'); g.fillStyle = '#efe6d6'; g.fillRect(18, 18, 8, 3); circle(g, 26, 18, 2.5, '#efe6d6'); circle(g, 26, 22, 2.5, '#efe6d6'); break;
    case 'water': g.fillStyle = '#4aa8e8'; g.beginPath(); g.moveTo(16, 3); g.bezierCurveTo(22, 12, 26, 17, 26, 21); g.arc(16, 21, 10, 0, Math.PI); g.bezierCurveTo(6, 17, 10, 12, 16, 3); g.fill(); circle(g, 12, 21, 2, '#bfe4ff'); break;
    case 'warm': poly(g, [16, 2, 25, 17, 22, 28, 10, 28, 7, 17], '#ff8a2e'); poly(g, [16, 12, 20, 21, 18, 27, 14, 27, 12, 21], '#ffe27a'); break;
    case 'cold': g.strokeStyle = '#9fd8ff'; g.lineWidth = 2.5; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(16 + Math.cos(a) * 12, 16 + Math.sin(a) * 12); g.lineTo(16 - Math.cos(a) * 12, 16 - Math.sin(a) * 12); g.stroke(); } break;
    case 'stamina': poly(g, [18, 2, 7, 18, 15, 18, 12, 30, 25, 12, 17, 12], '#9be35b'); break;
  }
}
