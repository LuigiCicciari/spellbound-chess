/* Spellbound Chess — 3D board, original stone warriors, and the battle animation.
   Same interface as render.js (the 2D board), plus personality reactions. */
import * as THREE from 'three';

const FILES = 'abcdefgh';
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const audio = (name, arg) => window.SBAudio && window.SBAudio.play(name, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = {
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  linear: (t) => t,
  back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/* ---------- textures made in code (no image files) ---------- */
function stoneTexture(base, vein, seed) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  g.strokeStyle = vein; g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    g.beginPath(); let x = rnd() * 128, y = rnd() * 128; g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.3) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function textTexture(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = color; g.font = '600 40px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function dustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(215,208,192,0.9)'); gr.addColorStop(1, 'rgba(215,208,192,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ---------- materials ---------- */
function makeMaterials() {
  const moon = new THREE.MeshStandardMaterial({ color: 0xE8E2D4, roughness: 0.82, metalness: 0.02, flatShading: true, map: stoneTexture('#e8e2d4', 'rgba(120,110,95,0.35)', 7) });
  const obsidian = new THREE.MeshStandardMaterial({ color: 0x5a5866, roughness: 0.4, metalness: 0.1, flatShading: true, map: stoneTexture('#c8c6d0', 'rgba(40,40,55,0.4)', 13) });
  return {
    w: { stone: moon, trim: new THREE.MeshStandardMaterial({ color: 0xb0a387, roughness: 0.9, flatShading: true }),
      rune: new THREE.MeshStandardMaterial({ color: 0x7FB8D8, emissive: 0x7FB8D8, emissiveIntensity: 2.2 }), dark: new THREE.MeshBasicMaterial({ color: 0x15151a }) },
    b: { stone: obsidian, trim: new THREE.MeshStandardMaterial({ color: 0x3a3944, roughness: 0.5, metalness: 0.2, flatShading: true }),
      rune: new THREE.MeshStandardMaterial({ color: 0xF28E2B, emissive: 0xF28E2B, emissiveIntensity: 2.2 }), dark: new THREE.MeshBasicMaterial({ color: 0x050507 }) },
  };
}

/* ---------- original piece designs, built from simple shapes (front = +z) ---------- */
const V2 = (r, y) => new THREE.Vector2(r, y);
function lathe(pts, seg) { return new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg || 9); }
function mesh(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true; m.receiveShadow = true; if (parent) parent.add(m); return m;
}
function eyes(M, parent, y, z, spread, size) {
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(size || 0.022, 8, 6), M.rune, sx * (spread || 0.045), y, z, parent).castShadow = false;
}
function pivot(parent, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; }

function buildPiece(type, side, MAT) {
  const M = MAT[side];
  const root = new THREE.Group();     // position on the board + facing
  const bob = new THREE.Group();      // idle breathing only
  const body = new THREE.Group();     // lean, hop, kneel (actions)
  root.add(bob); bob.add(body);
  body.scale.setScalar(1.12);
  // every piece stands on a two-step plinth with a trim band, like a classic chessman
  mesh(new THREE.CylinderGeometry(0.29, 0.33, 0.07, 14), M.trim, 0, 0.035, 0, body);
  mesh(new THREE.CylinderGeometry(0.25, 0.29, 0.05, 14), M.stone, 0, 0.095, 0, body);
  let weapon = pivot(body, 0, 0.5, 0), head = null, height = 0.8;
  const ring = (r, y, t) => { const m = mesh(new THREE.TorusGeometry(r, t || 0.022, 6, 16), M.trim, 0, y, 0, body); m.rotation.x = Math.PI / 2; return m; };
  switch (type) {
    case 'P': { // small foot soldier: classic round head on a collar, cap, little shield and club
      height = 0.62;
      mesh(lathe([[0, 0.12], [0.18, 0.12], [0.15, 0.22], [0.1, 0.34], [0, 0.36]], 12), M.stone, 0, 0, 0, body);
      mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.04, 12), M.trim, 0, 0.36, 0, body);
      head = pivot(body, 0, 0.47, 0);
      mesh(new THREE.SphereGeometry(0.11, 12, 9), M.stone, 0, 0, 0, head);
      mesh(new THREE.SphereGeometry(0.118, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), M.trim, 0, 0.012, 0, head);
      mesh(new THREE.BoxGeometry(0.025, 0.07, 0.03), M.trim, 0, -0.01, 0.105, head);
      eyes(M, head, 0.0, 0.098, 0.042, 0.02);
      const shield = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), M.trim, -0.15, 0.24, 0.1, body); shield.rotation.x = Math.PI / 2;
      weapon = pivot(body, 0.16, 0.32, 0.02);
      mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.24, 6), M.trim, 0, -0.06, 0.08, weapon).rotation.x = 0.9;
      mesh(new THREE.DodecahedronGeometry(0.045), M.stone, 0, 0.0, 0.16, weapon);
      break;
    }
    case 'R': { // a living castle tower: battlements on top, arrow-slit eyes, stone fists and a shield
      height = 0.88;
      mesh(lathe([[0, 0.12], [0.25, 0.12], [0.22, 0.2], [0.2, 0.62], [0.24, 0.66], [0, 0.66]], 12), M.stone, 0, 0, 0, body);
      ring(0.215, 0.3, 0.018);
      mesh(new THREE.CylinderGeometry(0.27, 0.24, 0.12, 12), M.trim, 0, 0.72, 0, body);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; mesh(new THREE.BoxGeometry(0.09, 0.1, 0.09), M.trim, Math.sin(a) * 0.2, 0.83, Math.cos(a) * 0.2, body).rotation.y = a; }
      head = pivot(body, 0, 0.52, 0);
      mesh(new THREE.BoxGeometry(0.2, 0.06, 0.03), M.dark, 0, 0, 0.2, head);
      eyes(M, head, 0, 0.215, 0.055, 0.022);
      mesh(new THREE.BoxGeometry(0.04, 0.1, 0.03), M.dark, 0, -0.18, 0.205, head); // door slit
      mesh(new THREE.DodecahedronGeometry(0.08), M.stone, 0.29, 0.32, 0.05, body);
      weapon = pivot(body, -0.2, 0.42, 0.2);
      mesh(new THREE.BoxGeometry(0.24, 0.32, 0.05), M.trim, 0, 0, 0, weapon);
      mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), M.rune, 0, 0.05, 0.035, weapon).castShadow = false;
      break;
    }
    case 'N': { // warhorse: a carved horse-head profile (classic knight silhouette) with a stone mane
      height = 1.02;
      mesh(lathe([[0, 0.12], [0.22, 0.12], [0.19, 0.2], [0, 0.22]], 12), M.trim, 0, 0, 0, body);
      head = pivot(body, 0, 0, 0);
      const prof = new THREE.Shape();
      // x = forward, y = up
      prof.moveTo(-0.19, 0.2);
      prof.lineTo(0.17, 0.2);
      prof.quadraticCurveTo(0.22, 0.34, 0.11, 0.48);   // chest into throat
      prof.quadraticCurveTo(0.17, 0.57, 0.3, 0.6);     // jaw
      prof.quadraticCurveTo(0.39, 0.62, 0.37, 0.71);   // muzzle
      prof.quadraticCurveTo(0.3, 0.79, 0.16, 0.85);    // nose bridge
      prof.lineTo(0.08, 0.95);                          // forehead
      prof.lineTo(0.05, 1.05);                          // ear tip
      prof.lineTo(-0.02, 0.93);
      prof.quadraticCurveTo(-0.14, 0.9, -0.2, 0.74);    // poll and crest
      prof.quadraticCurveTo(-0.27, 0.5, -0.19, 0.2);    // back of neck
      const depth = 0.2;
      const geo = new THREE.ExtrudeGeometry(prof, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 1, curveSegments: 6 });
      geo.translate(0, 0, -depth / 2); geo.rotateY(-Math.PI / 2);
      mesh(geo, M.stone, 0, 0, 0, head);
      // mane: a ridge of stone fins down the back of the neck
      for (let i = 0; i < 7; i++) {
        const t = i / 6, y = 0.9 - t * 0.6, z = -0.12 - Math.sin(t * Math.PI) * 0.1 - t * 0.02;
        const fin = mesh(new THREE.BoxGeometry(0.06, 0.12, 0.09), M.trim, 0, y, z, head); fin.rotation.x = -0.5 - t * 0.4;
      }
      // bridle band, eyes and nostrils on both sides
      const band = mesh(new THREE.BoxGeometry(0.29, 0.035, 0.05), M.trim, 0, 0.72, 0.24, head); band.rotation.x = -0.6;
      for (const sx of [-1, 1]) {
        mesh(new THREE.SphereGeometry(0.03, 8, 6), M.rune, sx * 0.125, 0.8, 0.12, head).castShadow = false;
        mesh(new THREE.SphereGeometry(0.018, 6, 4), M.dark, sx * 0.1, 0.66, 0.35, head);
      }
      weapon = head;
      break;
    }
    case 'B': { // mystic: classic mitre with a slit, orb staff
      height = 1.12;
      mesh(lathe([[0, 0.12], [0.22, 0.12], [0.17, 0.3], [0.11, 0.62], [0.15, 0.66], [0, 0.68]], 12), M.stone, 0, 0, 0, body);
      ring(0.13, 0.66, 0.025);
      head = pivot(body, 0, 0.7, 0);
      mesh(lathe([[0, 0], [0.1, 0.02], [0.135, 0.11], [0.12, 0.2], [0.07, 0.29], [0.02, 0.34], [0, 0.35]], 12), M.stone, 0, 0, 0, head);
      const slit = mesh(new THREE.BoxGeometry(0.02, 0.16, 0.25), M.dark, 0.03, 0.2, 0.02, head); slit.rotation.z = -0.55;
      mesh(new THREE.SphereGeometry(0.035, 8, 6), M.trim, 0, 0.38, 0, head);
      eyes(M, head, 0.07, 0.115, 0.036, 0.018);
      weapon = pivot(body, 0.22, 0.56, 0.04);
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), M.trim, 0, -0.1, 0, weapon);
      mesh(new THREE.IcosahedronGeometry(0.06), M.rune, 0, 0.38, 0, weapon).castShadow = false;
      break;
    }
    case 'Q': { // sovereign: tall robe, spiked coronet, long blade
      height = 1.3;
      mesh(lathe([[0, 0.12], [0.25, 0.12], [0.2, 0.32], [0.12, 0.72], [0.17, 0.8], [0, 0.82]], 12), M.stone, 0, 0, 0, body);
      ring(0.16, 0.34, 0.02); ring(0.15, 0.8, 0.025);
      head = pivot(body, 0, 0.93, 0);
      mesh(new THREE.SphereGeometry(0.105, 12, 9), M.stone, 0, 0, 0, head);
      mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.06, 14), M.trim, 0, 0.1, 0, head);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const sp = mesh(new THREE.ConeGeometry(0.025, 0.1, 5), M.trim, Math.sin(a) * 0.115, 0.17, Math.cos(a) * 0.115, head); sp.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35); }
      mesh(new THREE.SphereGeometry(0.035, 8, 6), M.rune, 0, 0.2, 0, head).castShadow = false;
      eyes(M, head, 0.0, 0.095, 0.038, 0.019);
      weapon = pivot(body, 0.19, 0.72, 0.02);
      mesh(new THREE.BoxGeometry(0.032, 0.58, 0.012), M.trim, 0, 0.33, 0.06, weapon);
      mesh(new THREE.BoxGeometry(0.15, 0.03, 0.04), M.stone, 0, 0.04, 0.06, weapon);
      mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.09, 6), M.stone, 0, -0.02, 0.06, weapon);
      weapon.rotation.x = -0.35; weapon.rotation.z = -0.25;
      break;
    }
    case 'K': { // king: tallest, broad robe, crown topped with a stone cross, great sword
      height = 1.5;
      mesh(lathe([[0, 0.12], [0.27, 0.12], [0.22, 0.34], [0.14, 0.8], [0.19, 0.88], [0, 0.9]], 12), M.stone, 0, 0, 0, body);
      ring(0.18, 0.36, 0.022); ring(0.17, 0.88, 0.028);
      head = pivot(body, 0, 1.01, 0);
      mesh(new THREE.BoxGeometry(0.19, 0.19, 0.19), M.stone, 0, 0, 0, head);
      mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.08, 4), M.trim, 0, 0.13, 0, head).rotation.y = Math.PI / 4;
      mesh(new THREE.BoxGeometry(0.05, 0.24, 0.05), M.trim, 0, 0.3, 0, head);
      mesh(new THREE.BoxGeometry(0.17, 0.05, 0.05), M.trim, 0, 0.33, 0, head);
      mesh(new THREE.OctahedronGeometry(0.028), M.rune, 0, 0.33, 0.03, head).castShadow = false;
      eyes(M, head, 0.0, 0.097, 0.043, 0.021);
      weapon = pivot(body, 0, 0.58, 0.25);
      mesh(new THREE.BoxGeometry(0.045, 0.58, 0.02), M.trim, 0, -0.25, 0, weapon);
      mesh(new THREE.BoxGeometry(0.22, 0.035, 0.05), M.stone, 0, 0.05, 0, weapon);
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), M.stone, 0, 0.13, 0, weapon);
      break;
    }
  }
  root.userData = { type, side, bob, body, head, weapon, height: height * 1.12, baseWeaponRot: weapon.rotation.clone(), phase: Math.random() * 10, facing: side === 'w' ? Math.PI : 0 };
  root.rotation.y = root.userData.facing;
  return root;
}

/* ---------- renderer ---------- */
export function create(container) {
  const MAT = makeMaterials();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.innerHTML = ''; container.appendChild(renderer.domElement);
  const el = renderer.domElement; el.style.touchAction = 'none'; el.setAttribute('aria-label', 'Chess board');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15161b);
  scene.fog = new THREE.Fog(0x15161b, 17, 30);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);

  // light: cool moonlight + warm torches
  scene.add(new THREE.HemisphereLight(0xc8d2e6, 0x3a332c, 1.35));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
  key.position.set(-5, 10, 4); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd0ee, 1.6); rim.position.set(5, 6, -7); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffd8b0, 0.9); rim2.position.set(-5, 4, 7); scene.add(rim2);
  // four stone fire bowls at the corners of the table, with layered flames and rising embers
  const torches = [], flames = [], embers = [], bowls = [];
  let fireBoost = 0;
  const bowlStone = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.95, flatShading: true });
  const add = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  // flames are camera-facing sprites shaped like real flames, so they stay upright from any angle
  const FLAME_TEX = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
    g.beginPath(); g.moveTo(64, 4);
    g.bezierCurveTo(78, 60, 124, 110, 118, 170); g.bezierCurveTo(112, 230, 84, 252, 64, 252);
    g.bezierCurveTo(44, 252, 16, 230, 10, 170); g.bezierCurveTo(4, 110, 50, 60, 64, 4); g.closePath();
    const gr = g.createLinearGradient(0, 252, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fill();
    g.globalCompositeOperation = 'destination-in'; const rg = g.createRadialGradient(64, 190, 10, 64, 170, 120);
    rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = rg; g.fillRect(0, 0, 128, 256);
    return new THREE.CanvasTexture(c);
  })();
  const flameSprite = (color, opacity) => new THREE.SpriteMaterial({ map: FLAME_TEX, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameLayers = [[2.1, 3.6, 0xff3c0a, 0.55], [1.6, 2.9, 0xff6a1a, 0.7], [1.1, 2.0, 0xffa040, 0.85], [0.6, 1.15, 0xfff0c0, 0.95]];
  const FIRE_BASE = 0.8;
  const EMBER_TEX = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 15); gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(0.4, 'rgba(255,140,40,0.9)'); gr.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  for (const [x, z] of [[-5.5, -1.9], [5.5, -1.9]]) {
    mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.9, 8), bowlStone, x, 0.08, z, scene);
    const bowl = mesh(new THREE.CylinderGeometry(0.62, 0.34, 0.34, 8, 1, true), bowlStone, x, 0.68, z, scene); bowl.material.side = THREE.DoubleSide;
    mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.04, 8), new THREE.MeshBasicMaterial({ color: 0x5a1e06 }), x, 0.78, z, scene);
    for (const [w, h, color, opacity] of flameLayers) {
      const f = new THREE.Sprite(flameSprite(color, opacity));
      f.position.set(x, FIRE_BASE + h / 2 - 0.1, z); f.userData.h = h; f.userData.w = w; f.userData.x = x; scene.add(f); flames.push(f);
    }
    const t = new THREE.PointLight(0xff9a40, 26, 16, 1.3); t.position.set(x, 1.8, z); scene.add(t); torches.push(t);
    bowls.push(new THREE.Vector3(x, FIRE_BASE + 0.1, z));
  }
  function spawnEmber(b, fast) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: EMBER_TEX, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(b.x + (Math.random() - 0.5) * 0.5, b.y + Math.random() * 0.3, b.z + (Math.random() - 0.5) * 0.5);
    sp.scale.setScalar(0.05 + Math.random() * 0.06);
    scene.add(sp);
    embers.push({ sp, v: new THREE.Vector3((Math.random() - 0.5) * 0.3, (fast ? 1.8 : 0.7) + Math.random() * 0.9, (Math.random() - 0.5) * 0.3), life: 0, max: 1.2 + Math.random() * 1.4, ph: Math.random() * 6 });
  }
  /* The fires flare up whenever stone is smashed. */
  function flare(power) { fireBoost = Math.min(1.6, fireBoost + (power || 1)); if (!reducedMotion()) for (const b of bowls) for (let i = 0; i < 6; i++) spawnEmber(b, true); }

  // board
  const boardG = new THREE.Group(); scene.add(boardG);
  mesh(new THREE.BoxGeometry(9.2, 0.34, 9.2), new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.95, map: stoneTexture('#6b665e', 'rgba(0,0,0,0.3)', 3) }), 0, -0.21, 0, boardG);
  const floorTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#3a3733'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#1e1c1a'; g.lineWidth = 4;
    for (let y = 0; y < 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); const off = (y / 64) % 2 ? 0 : 64; for (let x = off; x < 256; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } }
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); return t; })();
  mesh(new THREE.BoxGeometry(40, 0.1, 40), new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.95, map: floorTex }), 0, -0.42, 0, boardG);
  const lightTile = new THREE.MeshStandardMaterial({ color: 0xB9B3A5, roughness: 0.9, map: stoneTexture('#c7c1b3', 'rgba(90,80,70,0.25)', 21) });
  const darkTile = new THREE.MeshStandardMaterial({ color: 0x5E5A55, roughness: 0.85, map: stoneTexture('#8a857e', 'rgba(20,20,20,0.35)', 34) });
  const tileGeo = new THREE.BoxGeometry(0.985, 0.08, 0.985);
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, c = s & 7;
    mesh(tileGeo, (r + c) % 2 === 0 ? lightTile : darkTile, c - 3.5, -0.04, r - 3.5, boardG).castShadow = false;
  }
  // coordinates on the rim
  const labels = [];
  const labelGeo = new THREE.PlaneGeometry(0.34, 0.34);
  for (let i = 0; i < 8; i++) {
    for (const [txt, x, z] of [[FILES[i], i - 3.5, 4.3], [FILES[i], i - 3.5, -4.3], [String(8 - i), -4.3, i - 3.5], [String(8 - i), 4.3, i - 3.5]]) {
      const m = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: textTexture(txt, '#d8d2c4'), transparent: true }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, -0.035, z); boardG.add(m); labels.push(m);
    }
  }

  /* ---------- the great hall: pillars, banners, moonbeams, dust, rune circle ---------- */
  const hall = new THREE.Group(); scene.add(hall);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x6b665e, roughness: 0.95, flatShading: true, map: stoneTexture('#8a857c', 'rgba(0,0,0,0.3)', 51) });
  function pillar(x, z, h) {
    mesh(new THREE.BoxGeometry(1.3, 0.5, 1.3), pillarMat, x, -0.12, z, hall);
    mesh(new THREE.CylinderGeometry(0.42, 0.48, h, 10), pillarMat, x, h / 2, z, hall);
    for (let i = 0; i < 3; i++) mesh(new THREE.TorusGeometry(0.47, 0.05, 5, 10), pillarMat, x, 0.6 + i * (h / 3), z, hall).rotation.x = Math.PI / 2;
  }
  for (const [x, z] of [[-3.4, -7.6], [3.4, -7.6], [-8.2, -6.0], [8.2, -6.0], [-9.4, 0.6], [9.4, 0.6]]) pillar(x, z, 11);
  // banners with original sigils: a crescent for Moonstone, a flame for Obsidian
  function bannerTex(bg, fg, kind) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 320;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 0); g.lineTo(128, 280); g.lineTo(64, 320); g.lineTo(0, 280); g.closePath(); g.fill();
    g.strokeStyle = fg; g.lineWidth = 5; g.strokeRect(10, 10, 108, 255);
    g.fillStyle = fg; g.translate(64, 140);
    if (kind === 'moon') { g.beginPath(); g.arc(0, 0, 36, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(14, -8, 32, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over'; }
    else { g.beginPath(); g.moveTo(0, -46); g.bezierCurveTo(28, -10, 34, 10, 22, 30); g.bezierCurveTo(14, 44, -14, 44, -22, 30); g.bezierCurveTo(-30, 14, -16, -4, -6, -12); g.bezierCurveTo(-2, 2, 6, 4, 8, -6); g.bezierCurveTo(10, -20, 4, -34, 0, -46); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const banners = [];
  for (const [x, tex] of [[-3.4, bannerTex('#1d3550', '#cfe6f5', 'moon')], [3.4, bannerTex('#4a2410', '#ffb35c', 'flame')]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.25), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, side: THREE.DoubleSide }));
    b.position.set(x, 2.6, -7.05); hall.add(b); banners.push(b);
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), pillarMat, x, 4.25, -7.05, hall).rotation.z = Math.PI / 2;
  }
  // moonbeams slanting in from high windows, and the window light they cast on the floor
  const beamTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(170,200,235,0)'); gr.addColorStop(0.3, 'rgba(170,200,235,0.55)'); gr.addColorStop(1, 'rgba(170,200,235,0.05)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); const h = g.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = h; g.fillRect(0, 0, 64, 256); return new THREE.CanvasTexture(c); })();
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.32 });
  const beams = [];
  for (const [x, z, w] of [[-6.5, -3.5, 1.6], [-4.8, 0.5, 1.3], [6.8, -2.0, 1.4]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, 13), beamMat);
    b.position.set(x, 5.6, z); b.rotation.set(0, Math.PI / 5 * Math.sign(x), Math.sign(x) * 0.5); hall.add(b); beams.push(b);
  }
  const windowTex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d'); g.fillStyle = 'rgba(150,190,235,0.55)';
    for (const x0 of [12, 70]) { g.beginPath(); g.moveTo(x0, 250); g.lineTo(x0, 90); g.quadraticCurveTo(x0 + 23, 20, x0 + 46, 90); g.lineTo(x0 + 46, 250); g.closePath(); g.fill(); }
    g.globalCompositeOperation = 'destination-out'; g.fillRect(0, 160, 128, 6); g.fillRect(33, 60, 4, 200); g.fillRect(91, 60, 4, 200); return new THREE.CanvasTexture(c); })();
  for (const [x, z, r] of [[-6.6, -2.4, 0.5], [6.9, -0.6, -0.4]]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.2), new THREE.MeshBasicMaterial({ map: windowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
    w.rotation.set(-Math.PI / 2, 0, r); w.position.set(x, -0.355, z); hall.add(w); beams.push(w);
  }
  // dust motes drifting through the moonlight
  const MOTES = 260, motePos = new Float32Array(MOTES * 3), moteSeed = [];
  for (let i = 0; i < MOTES; i++) { motePos[i * 3] = (Math.random() - 0.5) * 18; motePos[i * 3 + 1] = Math.random() * 6; motePos[i * 3 + 2] = -7 + Math.random() * 12; moteSeed.push(Math.random() * 10); }
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xcfe0f5, size: 0.045, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  hall.add(motes);
  // the rune circle on the floor and a glowing inlay around the board; both follow the turn
  const runeTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
    g.translate(512, 512); g.strokeStyle = '#ffffff'; g.lineCap = 'round';
    g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 500, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 430, 0, Math.PI * 2); g.stroke();
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const N = 40;
    for (let i = 0; i < N; i++) { // original rune-like glyphs, made from a few strokes each
      g.save(); g.rotate((i / N) * Math.PI * 2); g.translate(0, -465); g.lineWidth = 4; g.beginPath();
      g.moveTo(0, -22); g.lineTo(0, 22);
      const k = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) { const y = -18 + rnd() * 36, d = rnd() < 0.5 ? -1 : 1; g.moveTo(0, y); g.lineTo(d * (8 + rnd() * 10), y + (rnd() - 0.5) * 20); }
      if (rnd() < 0.4) { g.moveTo(-8, 22); g.lineTo(8, 22); }
      g.stroke(); g.restore();
    }
    return new THREE.CanvasTexture(c);
  })();
  const runeMat = new THREE.MeshBasicMaterial({ map: runeTex, color: 0x7FB8D8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
  const runeCircle = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 15.5), runeMat);
  runeCircle.rotation.x = -Math.PI / 2; runeCircle.position.y = -0.36; hall.add(runeCircle);
  const runeState = { color: new THREE.Color(0x7FB8D8), target: new THREE.Color(0x7FB8D8), glow: 0.85, targetGlow: 0.85, flash: 0, pulse: 0, side: 'w' };
  const TURN_COLORS = { w: 0x7FB8D8, b: 0xF28E2B };
  function setTurn(side, inCheck) {
    if (side !== runeState.side) { runeState.pulse = 1; runeState.side = side; audio('turn'); } // the circle flares when the turn passes
    runeState.target.setHex(inCheck ? 0xff6a1a : TURN_COLORS[side] || 0x7FB8D8); runeState.targetGlow = inCheck ? 1.0 : 0.85;
  }
  function setAlert(kind, side) { if (kind === 'mate') { runeState.target.setHex(TURN_COLORS[side] || 0xffffff); runeState.targetGlow = 1.4; flare(1.6); } }
  /* Thunder: the moonlight flashes twice and the hall rumbles. */
  const hemiLight = scene.children.find((o) => o.isHemisphereLight);
  async function thunder() {
    if (reducedMotion()) return;
    audio('rumble');
    for (const [on, off] of [[90, 120], [60, 0]]) { runeState.flash = 1; await sleep(on); runeState.flash = 0.2; await sleep(off); }
    runeState.flash = 0;
  }

  const marksG = new THREE.Group(); scene.add(marksG);
  const piecesG = new THREE.Group(); scene.add(piecesG);
  const fxG = new THREE.Group(); scene.add(fxG);
  const hintG = new THREE.Group(); scene.add(hintG);

  /* ---------- state ---------- */
  let orient = 'w', view = 'battle';
  const pieceAt = new Map();
  const sqPos = (sq) => new THREE.Vector3((sq & 7) - 3.5, 0, (sq >> 3) - 3.5);
  // pieces face the enemy; knights stand side-on toward the middle so their horse profile reads from your seat
  const restFacing = (obj) => {
    const u = obj.userData, base = u.side === 'w' ? Math.PI : 0;
    if (u.type !== 'N') return base;
    return base + (obj.position.x < 0 ? 1 : -1) * 1.15 * (u.side === 'w' ? -1 : 1);
  };

  function camTarget() {
    const s = orient === 'w' ? 1 : -1;
    const fit = Math.max(1, 1.25 / (camera.aspect || 1)); // pull back on tall/narrow screens so the whole board fits
    if (view === 'overhead') return { pos: new THREE.Vector3(0, 11.4 * fit, 2.1 * s * fit), look: new THREE.Vector3(0, 0, 0.2 * s) };
    return { pos: new THREE.Vector3(0, 7.5 * fit, 7.7 * s * fit), look: new THREE.Vector3(0, -0.6, 0.55 * s) };
  }
  const camState = { pos: camTarget().pos.clone(), look: camTarget().look.clone() };
  let shakeAmp = 0;

  function resize() {
    const w = container.clientWidth || 600, h = container.clientHeight || w;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();

  /* ---------- tweens and particles ---------- */
  const tasks = new Set();
  function tween(ms, fn, easing) {
    if (reducedMotion()) ms = Math.min(ms, 120);
    return new Promise((res) => tasks.add({ t0: performance.now(), ms: Math.max(1, ms), fn, e: easing || ease.inOut, res }));
  }
  const shards = [], dusts = [];
  const DUST_TEX = dustTexture();

  function puff(pos, n, spread) {
    if (reducedMotion()) return;
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: DUST_TEX, transparent: true, depthWrite: false, opacity: 0.7 }));
      sp.position.set(pos.x + (Math.random() - 0.5) * spread, 0.08 + Math.random() * 0.15, pos.z + (Math.random() - 0.5) * spread);
      sp.scale.setScalar(0.25);
      fxG.add(sp);
      dusts.push({ sp, v: new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.35 + Math.random() * 0.5, (Math.random() - 0.5) * 0.9), life: 0, max: 0.9 + Math.random() * 0.6 });
    }
  }

  /* Break a piece into rubble: chunks of its own stone fly, bounce, settle, then sink away. */
  function shatter(obj, impactDir) {
    const side = obj.userData.side, M = MAT[side];
    const center = obj.position.clone();
    const h = obj.userData.height;
    obj.visible = false;
    if (reducedMotion()) return;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const sz = 0.05 + Math.random() * 0.09;
      const geo = Math.random() < 0.5 ? new THREE.TetrahedronGeometry(sz) : new THREE.BoxGeometry(sz, sz * 0.8, sz * 1.2);
      const m = new THREE.Mesh(geo, i % 5 === 0 ? M.trim : M.stone);
      m.castShadow = true;
      m.position.set(center.x + (Math.random() - 0.5) * 0.4, 0.1 + Math.random() * h, center.z + (Math.random() - 0.5) * 0.4);
      fxG.add(m);
      const out = new THREE.Vector3(m.position.x - center.x, 0, m.position.z - center.z).normalize();
      const v = out.multiplyScalar(0.8 + Math.random() * 1.6).add(impactDir.clone().multiplyScalar(1.4 + Math.random()));
      v.y = 1.5 + Math.random() * 2.4;
      shards.push({ m, v, av: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6), life: 0, sz });
    }
    for (let i = 0; i < 2; i++) { // the glowing eyes wink out last
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: side === 'w' ? 0x7FB8D8 : 0xF28E2B, transparent: true }));
      e.position.set(center.x + (i ? 0.05 : -0.05), h * 0.8, center.z); fxG.add(e);
      shards.push({ m: e, v: new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.2, (Math.random() - 0.5) * 1.5), av: new THREE.Vector3(), life: 0, sz: 0.03, glow: true });
    }
    puff(center, 10, 0.6);
  }

  /* ---------- main loop ---------- */
  const clock = new THREE.Clock();
  let thinking = { w: false, b: false };
  function frame() {
    const dt = Math.min(0.05, clock.getDelta()), now = performance.now(), tsec = now / 1000;
    for (const t of [...tasks]) {
      const p = Math.min(1, (now - t.t0) / t.ms);
      t.fn(t.e(p));
      if (p >= 1) { tasks.delete(t); t.res(); }
    }
    // idle breathing and rune glow
    for (const obj of pieceAt.values()) {
      const u = obj.userData;
      u.bob.position.y = Math.sin(tsec * 1.6 + u.phase) * 0.006;
    }
    const pulse = 1.2 + Math.sin(tsec * 6) * 1.1;
    MAT.w.rune.emissiveIntensity = thinking.w ? pulse : 2.2;
    MAT.b.rune.emissiveIntensity = thinking.b ? pulse : 2.2;
    fireBoost *= Math.pow(0.25, dt);
    torches.forEach((t, i) => { t.intensity = 25 + Math.sin(tsec * 9 + i * 2) * 3 + Math.sin(tsec * 23 + i) * 2 + fireBoost * 40; });
    flames.forEach((f, i) => {
      const k = 1 + Math.sin(tsec * 11 + i * 1.7) * 0.12 + Math.sin(tsec * 27 + i) * 0.07 + fireBoost * 0.7;
      const w = 1 / Math.sqrt(k) + fireBoost * 0.15;
      f.scale.set(f.userData.w * w, f.userData.h * k, 1); f.position.y = FIRE_BASE - 0.1 + (f.userData.h * k) / 2;
      f.position.x = f.userData.x + Math.sin(tsec * 5 + i * 1.3) * 0.04 * (1 + (i % 4));
    });
    if (!reducedMotion() && Math.random() < dt * 22) spawnEmber(bowls[Math.floor(Math.random() * bowls.length)]);
    if (!reducedMotion() && Math.random() < dt * 5) {
      const b = bowls[Math.floor(Math.random() * bowls.length)];
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: DUST_TEX, color: 0x3a3632, transparent: true, depthWrite: false, opacity: 0.35 }));
      sp.position.set(b.x + (Math.random() - 0.5) * 0.3, b.y + 2.0, b.z + (Math.random() - 0.5) * 0.3); sp.scale.setScalar(0.5);
      fxG.add(sp); dusts.push({ sp, v: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.5 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15), life: 0, max: 2.6, smoke: true });
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]; e.life += dt;
      e.sp.position.addScaledVector(e.v, dt); e.sp.position.x += Math.sin(tsec * 3 + e.ph) * dt * 0.15;
      e.sp.material.opacity = Math.max(0, 1 - e.life / e.max);
      if (e.life > e.max) { scene.remove(e.sp); e.sp.material.dispose(); embers.splice(i, 1); }
    }
    // rubble physics
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i]; s.life += dt;
      s.v.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.av.x * dt; s.m.rotation.y += s.av.y * dt; s.m.rotation.z += s.av.z * dt;
      const floor = s.sz * 0.5;
      if (s.m.position.y < floor) { s.m.position.y = floor; s.v.y *= -0.32; s.v.x *= 0.6; s.v.z *= 0.6; s.av.multiplyScalar(0.55); }
      if (Math.abs(s.m.position.x) > 4.6 || Math.abs(s.m.position.z) > 4.6) { if (s.m.position.y <= floor + 0.01) s.v.y = -1; }
      if (s.glow) { s.m.material.opacity = Math.max(0, 1 - s.life / 0.9); }
      if (s.life > 1.6) s.m.position.y -= dt * 0.25; // sink away
      if (s.life > 2.4 || (s.glow && s.life > 0.9)) { fxG.remove(s.m); s.m.geometry.dispose(); shards.splice(i, 1); }
    }
    for (let i = dusts.length - 1; i >= 0; i--) {
      const d = dusts[i]; d.life += dt;
      d.sp.position.addScaledVector(d.v, dt); d.v.multiplyScalar(0.96);
      d.sp.scale.setScalar(d.smoke ? 0.5 + d.life * 0.8 : 0.25 + d.life * 0.9);
      d.sp.material.opacity = Math.max(0, (d.smoke ? 0.35 : 0.7) * (1 - d.life / d.max));
      if (d.life > d.max) { fxG.remove(d.sp); d.sp.material.dispose(); dusts.splice(i, 1); }
    }
    // hall: dust motes drift, banners sway, runes follow the turn, thunder flashes
    const mp = moteGeo.attributes.position.array;
    for (let i = 0; i < MOTES; i++) { mp[i * 3 + 1] += dt * 0.08; mp[i * 3] += Math.sin(tsec * 0.5 + moteSeed[i]) * dt * 0.06; if (mp[i * 3 + 1] > 6) mp[i * 3 + 1] = 0; }
    moteGeo.attributes.position.needsUpdate = true;
    banners.forEach((b, i) => { b.rotation.y = Math.sin(tsec * 0.7 + i * 2) * 0.06; b.rotation.x = Math.sin(tsec * 0.9 + i) * 0.03; });
    runeState.color.lerp(runeState.target, 1 - Math.pow(0.0005, dt));
    runeState.glow += (runeState.targetGlow - runeState.glow) * (1 - Math.pow(0.02, dt));
    const breathe = 0.85 + Math.sin(tsec * 1.4) * 0.15;
    runeState.pulse *= Math.pow(0.12, dt);
    runeMat.color.copy(runeState.color); runeMat.opacity = Math.min(1, runeState.glow * breathe + runeState.pulse * 0.8);
    const sc = 1 + runeState.pulse * 0.04; runeCircle.scale.set(sc, sc, 1);
    runeCircle.rotation.z += dt * (0.03 + runeState.pulse * 0.6);
    beamMat.opacity = 0.32 + runeState.flash * 0.9;
    if (hemiLight) hemiLight.intensity = 1.35 + runeState.flash * 3.5;
    // camera (smooth follow + impact shake)
    const ct = camTarget();
    camState.pos.lerp(ct.pos, 1 - Math.pow(0.002, dt));
    camState.look.lerp(ct.look, 1 - Math.pow(0.002, dt));
    camera.position.copy(camState.pos);
    if (shakeAmp > 0.001) { camera.position.x += (Math.random() - 0.5) * shakeAmp; camera.position.y += (Math.random() - 0.5) * shakeAmp; shakeAmp *= Math.pow(0.004, dt); }
    camera.lookAt(camState.look);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const shake = (a) => { if (!reducedMotion()) shakeAmp = Math.max(shakeAmp, a); };

  /* ---------- position ---------- */
  function clearPieces() {
    for (const o of [...piecesG.children]) piecesG.remove(o); pieceAt.clear();
    for (const o of [...fxG.children]) fxG.remove(o); shards.length = 0; dusts.length = 0; // sweep away old rubble
  }
  function place(p, sq) {
    const side = p === p.toUpperCase() ? 'w' : 'b';
    const obj = buildPiece(p.toUpperCase(), side, MAT);
    obj.position.copy(sqPos(sq)); obj.rotation.y = restFacing(obj); piecesG.add(obj); pieceAt.set(sq, obj);
    return obj;
  }
  function setPosition(board) { clearPieces(); board.forEach((p, sq) => { if (p) place(p, sq); }); }
  function setOrientation(o, board) {
    orient = o;
    for (const l of labels) l.rotation.z = o === 'w' ? 0 : Math.PI;
    if (board) setPosition(board);
  }
  function setView(v) { view = v; }

  /* ---------- marks ---------- */
  const basic = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity === undefined ? 1 : opacity, depthWrite: false });
  const flat = (geo, mat, sq, y) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; const p = sqPos(sq); m.position.set(p.x, y || 0.012, p.z); marksG.add(m); return m; };
  const G = { tile: new THREE.PlaneGeometry(0.98, 0.98), dot: new THREE.CircleGeometry(0.1, 20), halo: new THREE.RingGeometry(0.1, 0.16, 24),
    ringCore: new THREE.RingGeometry(0.4, 0.44, 32), ringHalo: new THREE.RingGeometry(0.37, 0.48, 32), check: new THREE.RingGeometry(0.36, 0.46, 32), checkOut: new THREE.RingGeometry(0.33, 0.49, 32) };
  const MK = { last: basic(0xF28E2B, 0.32), sel: basic(0x7FB8D8, 0.42), core: basic(0x1F4E79), halo: basic(0x8EC5E8), check: basic(0xF28E2B), outL: basic(0x2B2A2F), outD: basic(0xD8D2C4) };
  let checkMesh = null;
  function mark(state) {
    for (const o of [...marksG.children]) marksG.remove(o);
    checkMesh = null;
    const { lastMove, selected, targets, check, captures } = state || {};
    if (lastMove) for (const s of [lastMove.from, lastMove.to]) flat(G.tile, MK.last, s, 0.004);
    if (selected !== undefined && selected !== null) flat(G.tile, MK.sel, selected, 0.006);
    if (check !== undefined && check !== null && check >= 0) {
      const light = ((check >> 3) + (check & 7)) % 2 === 0;
      flat(G.checkOut, light ? MK.outL : MK.outD, check, 0.014);
      checkMesh = flat(G.check, MK.check, check, 0.016);
    }
    for (const s of targets || []) {
      if ((captures || []).includes(s)) { flat(G.ringHalo, MK.halo, s, 0.018); flat(G.ringCore, MK.core, s, 0.02); }
      else { flat(G.halo, MK.halo, s, 0.018); flat(G.dot, MK.core, s, 0.02); }
    }
  }
  function clearMarks() { mark({}); }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function planePoint(ev, y) {
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    plane.constant = -(y || 0);
    return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
  }
  function squareFromEvent(ev) {
    // prefer a piece under the pointer (tall pieces cover the square behind them)
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hits = ray.intersectObjects(piecesG.children, true);
    if (hits.length) {
      let o = hits[0].object; while (o && o.parent !== piecesG) o = o.parent;
      for (const [sq, obj] of pieceAt) if (obj === o) return sq;
    }
    const p = planePoint(ev, 0); if (!p) return -1;
    const c = Math.floor(p.x + 4), rr = Math.floor(p.z + 4);
    return c < 0 || c > 7 || rr < 0 || rr > 7 ? -1 : rr * 8 + c;
  }

  /* ---------- drag ---------- */
  let drag = null;
  function startDrag(sq, ev) { const o = pieceAt.get(sq); if (!o) return; drag = { sq, o }; o.userData.busy = true; moveDrag(ev); }
  function moveDrag(ev) { if (!drag) return; const p = planePoint(ev, 0); if (p) drag.o.position.set(p.x, 0.25, p.z); }
  function endDrag(snapBack) { if (!drag) return; const { sq, o } = drag; drag = null; o.userData.busy = false; if (snapBack) o.position.copy(sqPos(sq)); }
  const dragging = () => !!drag;

  /* ---------- personality ---------- */
  function faceTo(obj, target, ms) {
    const dx = target.x - obj.position.x, dz = target.z - obj.position.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-3) return Promise.resolve();
    const from = obj.rotation.y, to = Math.atan2(dx, dz);
    return tween(ms || 220, (t) => { obj.rotation.y = lerpAngle(from, to, t); });
  }
  function faceRest(obj, ms) { const from = obj.rotation.y, to = restFacing(obj); return tween(ms || 260, (t) => { obj.rotation.y = lerpAngle(from, to, t); }); }

  let attentive = null;
  function lift(sq, on) {
    const o = pieceAt.get(sq); if (!o) return;
    if (on) {
      if (attentive && attentive !== o) relaxObj(attentive);
      attentive = o; o.userData.busy = true;
      const b = o.userData.body;
      // stand to attention: little hop, turn slightly toward you
      faceTo(o, camera.position.clone().setY(0).multiplyScalar(1).add(o.position).multiplyScalar(0.5), 200);
      tween(260, (t) => { b.position.y = Math.sin(t * Math.PI) * 0.12; });
    }
  }
  function relaxObj(o) { if (!o || !o.parent) return; o.userData.busy = false; faceRest(o, 200); }
  function relax() { if (attentive) relaxObj(attentive); attentive = null; }

  async function hesitate(obj) {
    const base = obj.rotation.y, h = obj.userData.head;
    await tween(520, (t) => {
      const w = Math.sin(t * Math.PI * 4) * 0.35 * (1 - t);
      if (h) h.rotation.y = w; else obj.rotation.y = base + w;
    }, ease.linear);
    if (h) h.rotation.y = 0;
    audio('tap');
  }

  async function celebrate(obj) {
    const u = obj.userData, w = u.weapon, r0 = w.rotation.clone();
    await tween(420, (t) => {
      const k = Math.sin(t * Math.PI);
      u.body.position.y = k * 0.14;
      w.rotation.x = r0.x - k * 1.2;
    }, ease.out);
    w.rotation.copy(r0);
  }

  /* ---------- movement styles ---------- */
  async function travel(obj, from, toPos, type) {
    const start = obj.position.clone();
    const dist = start.distanceTo(toPos);
    if (dist < 1e-3) return;
    const u = obj.userData;
    u.busy = true;
    if (type === 'N') { // rear up, then leap
      await tween(240, (t) => { u.body.rotation.x = -0.5 * Math.sin(t * Math.PI / 2); });
      await tween(560, (t) => {
        obj.position.lerpVectors(start, toPos, t);
        obj.position.y = Math.sin(t * Math.PI) * 1.1;
        u.body.rotation.x = lerp(-0.5, 0.3, t);
      }, ease.inOut);
      obj.position.y = 0;
      await tween(140, (t) => { u.body.rotation.x = lerp(0.3, 0, t); u.body.position.y = -Math.sin(t * Math.PI) * 0.06; });
      audio('thud'); shake(0.06); puff(toPos, 4, 0.4);
      return;
    }
    const steps = Math.max(1, Math.round(dist));
    const per = { P: 300, R: 420, B: 280, Q: 260, K: 420 }[type] || 300;
    const lift = { P: 0.08, R: 0.03, B: 0.0, Q: 0.02, K: 0.05 }[type];
    audio('grind', (per * steps) / 1000);
    await tween(per * steps, (t) => {
      obj.position.lerpVectors(start, toPos, t);
      const ph = t * steps;
      const step = Math.abs(Math.sin(ph * Math.PI));
      if (type === 'B' || type === 'Q') { // glide with a sway
        u.body.rotation.z = Math.sin(ph * Math.PI) * 0.06;
        u.body.position.y = 0.04 * Math.sin(t * Math.PI);
      } else {
        u.body.position.y = step * lift;
        u.body.rotation.z = Math.sin(ph * Math.PI) * (type === 'R' ? 0.05 : 0.08);
      }
    }, type === 'R' || type === 'K' ? ease.linear : ease.inOut);
    u.body.rotation.z = 0; u.body.position.y = 0;
    if (type === 'R') { shake(0.05); audio('thud'); }
  }

  /* ---------- attacks (one per piece type) ---------- */
  async function attack(att, victim) {
    const u = att.userData, w = u.weapon, b = u.body, r0 = w.rotation.clone();
    const type = u.type;
    const hitAt = { P: 0.62, R: 0.6, N: 0.6, B: 0.62, Q: 0.6, K: 0.62 }[type];
    let impact = false;
    const strike = (t) => { if (!impact && t >= hitAt) { impact = true; hitReact(victim, att); } };
    switch (type) {
      case 'P': // club overhead, then a shield shove
        await tween(560, (t) => {
          const wind = t < 0.45 ? ease.out(t / 0.45) : 1 - ease.in((t - 0.45) / 0.55);
          w.rotation.x = r0.x - wind * 2.2 + (t > 0.45 ? 1.0 * ease.in((t - 0.45) / 0.55) : 0);
          b.rotation.x = t > 0.45 ? 0.25 * Math.sin(((t - 0.45) / 0.55) * Math.PI) : -0.1 * (t / 0.45);
          strike(t);
        }, ease.linear);
        break;
      case 'R': // raise the tower shield and slam it down
        await tween(700, (t) => {
          const up = t < 0.5 ? ease.out(t / 0.5) : 1 - ease.in((t - 0.5) / 0.5);
          w.position.y = 0.42 + up * 0.35; w.rotation.x = -up * 0.6;
          b.rotation.x = t > 0.5 ? 0.3 * Math.sin(((t - 0.5) / 0.5) * Math.PI) : -0.12 * up;
          strike(t);
        }, ease.linear);
        w.position.y = 0.42;
        break;
      case 'N': // rear up and stamp down
        await tween(680, (t) => {
          const up = t < 0.55 ? Math.sin((t / 0.55) * Math.PI / 2) : 1 - ease.in((t - 0.55) / 0.45);
          b.rotation.x = -0.75 * up; b.position.y = 0.18 * up;
          strike(t);
        }, ease.linear);
        b.position.y = 0;
        break;
      case 'B': // staff sweep
        await tween(640, (t) => {
          const k = t < 0.45 ? ease.out(t / 0.45) : 1 - ease.inOut((t - 0.45) / 0.55);
          w.rotation.z = r0.z + (t < 0.45 ? k * 1.1 : 1.1 - (1 - k) * 2.6);
          b.rotation.y = (t < 0.45 ? 0.35 * k : 0.35 - (1 - k) * 0.8);
          strike(t);
        }, ease.linear);
        break;
      case 'Q': // overhead blade strike
        await tween(620, (t) => {
          const k = t < 0.5 ? ease.out(t / 0.5) : 1 - ease.in((t - 0.5) / 0.5);
          w.rotation.x = r0.x - k * 2.6 + (t > 0.5 ? (1 - k) * 0.8 : 0);
          b.rotation.x = t > 0.5 ? 0.22 * Math.sin(((t - 0.5) / 0.5) * Math.PI) : -0.08 * k;
          strike(t);
        }, ease.linear);
        break;
      case 'K': // great sword sweep
        await tween(700, (t) => {
          const k = t < 0.5 ? ease.out(t / 0.5) : 1 - ease.in((t - 0.5) / 0.5);
          w.rotation.x = r0.x - k * 1.9;
          w.rotation.z = (t < 0.5 ? 0.8 * k : 0.8 - (1 - k) * 1.8);
          strike(t);
        }, ease.linear);
        break;
    }
    if (!impact) hitReact(victim, att);
    await tween(220, (t) => { w.rotation.x = lerp(w.rotation.x, r0.x, t); w.rotation.z = lerp(w.rotation.z, r0.z, t); b.rotation.x = lerp(b.rotation.x, 0, t); b.rotation.y = lerp(b.rotation.y, 0, t); });
    w.rotation.copy(r0);
  }

  function hitReact(victim, att) {
    if (!victim) return;
    audio('crack'); shake(0.12); flare(1);
    const dir = victim.position.clone().sub(att.position).setY(0).normalize();
    victim.userData.hitDir = dir;
    const vb = victim.userData.body;
    tween(140, (t) => { vb.rotation.x = -0.35 * t; victim.position.addScaledVector(dir, 0.01); });
  }

  /* ---------- the full move ---------- */
  async function animateMove(m, opts) {
    opts = opts || {};
    const obj = pieceAt.get(m.from); if (!obj) return;
    relax();
    obj.userData.busy = true;
    const type = obj.userData.type;
    const capSq = m.flags === 'e' ? m.to + (m.piece === 'P' ? 8 : -8) : m.to;
    const victim = m.captured ? pieceAt.get(capSq) : null;
    const dest = sqPos(m.to);

    if (opts.hesitate && !reducedMotion()) await hesitate(obj);
    await faceTo(obj, dest, 200);                                  // 1 anticipation

    if (m.flags === 'k' || m.flags === 'q') {                      // castling: both walk together
      const rf = m.flags === 'k' ? m.to + 1 : m.to - 2, rt = m.flags === 'k' ? m.to - 1 : m.to + 1;
      const rook = pieceAt.get(rf);
      await Promise.all([travel(obj, m.from, dest, 'K'), rook ? (async () => { await faceTo(rook, sqPos(rt), 200); await travel(rook, rf, sqPos(rt), 'R'); await faceRest(rook); })() : null]);
      if (rook) { pieceAt.delete(rf); pieceAt.set(rt, rook); rook.userData.busy = false; }
    } else if (victim && !reducedMotion()) {
      victim.userData.busy = true;
      await faceTo(victim, obj.position, 260);                     // the victim turns to face its attacker
      const vp = sqPos(capSq), from = obj.position.clone();
      const toward = vp.clone().sub(from).setY(0);
      const len = toward.length();
      const stand = type === 'N' ? vp.clone().sub(toward.clone().normalize().multiplyScalar(0.55)) : from.clone().add(toward.clone().normalize().multiplyScalar(Math.max(0, len - 0.62)));
      await travel(obj, m.from, stand, type);                      // 2 movement
      await faceTo(obj, vp, 120);
      await attack(obj, victim);                                   // 3 contact
      shatter(victim, victim.userData.hitDir || toward.clone().normalize()); // 4 defeat
      piecesG.remove(victim); pieceAt.delete(capSq);                // 5 removal
      await sleep(260);
      await travel(obj, m.from, dest, type === 'N' ? 'P' : type);
      if (opts.celebrate !== false) celebrate(obj);
    } else {
      if (victim) { victim.visible = false; piecesG.remove(victim); pieceAt.delete(capSq); }
      await travel(obj, m.from, dest, type);
    }
    obj.position.copy(dest);
    pieceAt.delete(m.from); pieceAt.set(m.to, obj);

    if (m.promotion) {                                             // the pawn sinks; the new piece rises
      await tween(380, (t) => { obj.position.y = -0.8 * ease.in(t); });
      piecesG.remove(obj); pieceAt.delete(m.to);
      const np = place(m.promotion, m.to);
      np.position.y = -0.9; puff(dest, 12, 0.8); audio('grind', 0.6);
      await tween(560, (t) => { np.position.y = -0.9 + 0.9 * ease.back(t); });
      np.position.y = 0;
      celebrate(np);
    }
    await faceRest(obj, 260);                                     // 6 recovery
    obj.userData.busy = false;
  }

  /* ---------- check, surrender, draw ---------- */
  function pulseCheck() {
    audio('thud');
    if (checkMesh) { const m = checkMesh; tween(700, (t) => { const s = 1 - 0.12 * Math.sin(t * Math.PI * 4); m.scale.set(s, s, 1); }, ease.linear); }
  }
  async function checkGuard(kingSq) {
    const k = pieceAt.get(kingSq); if (!k) return;
    const u = k.userData, w = u.weapon, r0 = u.baseWeaponRot;
    // nearby allies turn toward their king
    for (const [sq, o] of pieceAt) {
      if (o === k || o.userData.side !== u.side) continue;
      if (Math.abs((sq & 7) - (kingSq & 7)) <= 1 && Math.abs((sq >> 3) - (kingSq >> 3)) <= 1) faceTo(o, k.position, 260).then(() => sleep(700)).then(() => faceRest(o, 300));
    }
    await tween(320, (t) => { w.rotation.x = r0.x - 1.3 * t; u.body.rotation.x = -0.12 * t; });
    await sleep(600);
    await tween(320, (t) => { w.rotation.x = r0.x - 1.3 * (1 - t); u.body.rotation.x = -0.12 * (1 - t); });
  }
  async function surrender(kingSq) {
    const k = pieceAt.get(kingSq); if (!k) return;
    const u = k.userData, w = u.weapon;
    u.busy = true; audio('rumble'); flare(1.6);
    // the victors raise their weapons
    for (const o of pieceAt.values()) if (o.userData.side !== u.side) { const ow = o.userData.weapon, r0 = ow.rotation.clone(); tween(700, (t) => { ow.rotation.x = r0.x - Math.sin(t * Math.PI) * 1.4; o.userData.body.position.y = Math.sin(t * Math.PI) * 0.1; }); }
    // the king kneels and lays down his sword
    await tween(1100, (t) => {
      u.body.position.y = -0.22 * t; u.body.rotation.x = 0.42 * t;
      w.rotation.x = u.baseWeaponRot.x + 1.25 * t; w.position.z = 0.26 + 0.25 * t; w.position.y = 0.58 - 0.18 * t;
    }, ease.inOut);
    shake(0.05); puff(k.position, 6, 0.5);
    const runes = u.side === 'w' ? MAT.w.rune : MAT.b.rune; void runes;
  }
  async function bow(squares) {
    await Promise.all(squares.map((sq) => { const o = pieceAt.get(sq); if (!o) return null; const b = o.userData.body; return tween(900, (t) => { b.rotation.x = 0.35 * Math.sin(t * Math.PI); }); }));
  }
  async function topple(kingSq) { return surrender(kingSq); }

  /* At the start of a game the armies rise out of the board, shake off the dust and stand ready. */
  async function intro() {
    if (reducedMotion()) return;
    const list = [...pieceAt.entries()];
    for (const [, o] of list) { o.position.y = -2.1; o.userData.busy = true; }
    audio('rumble'); shake(0.05);
    const near = orient === 'w' ? 7 : 0;
    await Promise.all(list.map(([sq, o]) => (async () => {
      const row = sq >> 3, dist = Math.min(Math.abs(row - near), Math.abs(row - (7 - near)));
      await sleep(dist * 140 + (sq & 7) * 35 + Math.random() * 80);
      puff(o.position, 3, 0.4);
      await tween(620, (t) => { o.position.y = -2.1 + 2.1 * t; }, ease.back);
      o.position.y = 0;
      const b = o.userData.body;
      await tween(260, (t) => { b.rotation.z = Math.sin(t * Math.PI * 3) * 0.06 * (1 - t); });
      o.userData.busy = false;
    })()));
    audio('thud'); shake(0.06);
  }

  function setThinking(side, on) { thinking[side] = !!on; }

  function showArrow(from, to) {
    for (const o of [...hintG.children]) hintG.remove(o);
    if (from < 0) return;
    const a = sqPos(from), b = sqPos(to), dir = b.clone().sub(a), len = dir.length();
    const mat = basic(0x8EC5E8, 0.9);
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.14, Math.max(0.01, len - 0.3)), mat);
    shaft.rotation.x = -Math.PI / 2; shaft.rotation.z = -Math.atan2(dir.x, -dir.z) + Math.PI;
    shaft.position.copy(a.clone().add(dir.clone().multiplyScalar((len - 0.3) / 2 / len))).setY(0.03);
    const tipShape = new THREE.Shape(); tipShape.moveTo(-0.22, 0); tipShape.lineTo(0.22, 0); tipShape.lineTo(0, 0.34); tipShape.lineTo(-0.22, 0);
    const tip = new THREE.Mesh(new THREE.ShapeGeometry(tipShape), mat);
    tip.rotation.x = -Math.PI / 2; tip.rotation.z = shaft.rotation.z;
    tip.position.copy(a.clone().add(dir.clone().multiplyScalar((len - 0.34) / len))).setY(0.031);
    hintG.add(shaft, tip);
  }

  return {
    el, is3D: true, setPosition, setOrientation, setView, mark, clearMarks, squareFromEvent, startDrag, moveDrag, endDrag, dragging,
    lift, relax, animateMove, topple, surrender, bow, pulseCheck, checkGuard, setThinking, showArrow,
    flare, intro, setTurn, setAlert, thunder, get orientation() { return orient; }, get view() { return view; },
  };
}

window.SBRender3D = { create };
