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
    case 'N': { // warhorse: long head, ears, flowing stone mane
      height = 0.95;
      mesh(lathe([[0, 0.12], [0.22, 0.12], [0.19, 0.22], [0, 0.24]], 12), M.trim, 0, 0, 0, body);
      const neck = mesh(new THREE.BoxGeometry(0.2, 0.5, 0.26), M.stone, 0, 0.44, -0.04, body); neck.rotation.x = -0.32;
      const chest = mesh(new THREE.BoxGeometry(0.22, 0.22, 0.2), M.stone, 0, 0.3, 0.06, body); chest.rotation.x = 0.2;
      head = pivot(body, 0, 0.7, 0.05);
      const skull = mesh(new THREE.BoxGeometry(0.18, 0.17, 0.4), M.stone, 0, 0, 0.12, head); skull.rotation.x = 0.62;
      const muzzle = mesh(new THREE.BoxGeometry(0.15, 0.12, 0.14), M.trim, 0, -0.17, 0.27, head); muzzle.rotation.x = 0.62;
      mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), M.dark, -0.04, -0.2, 0.34, head); mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), M.dark, 0.04, -0.2, 0.34, head);
      for (const sx of [-1, 1]) {
        const ear = mesh(new THREE.ConeGeometry(0.035, 0.14, 5), M.stone, sx * 0.06, 0.15, -0.05, head); ear.rotation.x = -0.25; ear.rotation.z = -sx * 0.15;
        mesh(new THREE.SphereGeometry(0.026, 8, 6), M.rune, sx * 0.095, 0.03, 0.06, head).castShadow = false;
      }
      for (let i = 0; i < 6; i++) { const fin = mesh(new THREE.BoxGeometry(0.05, 0.13, 0.08), M.trim, 0, 0.26 + i * 0.09, -0.2 + i * 0.035, body); fin.rotation.x = -0.45; }
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
  const flameLayers = [[0.46, 1.5, add(0xff5a14, 0.55)], [0.32, 1.1, add(0xff9a30, 0.7)], [0.17, 0.62, add(0xffe6a8, 0.95)]];
  const EMBER_TEX = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 15); gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(0.4, 'rgba(255,140,40,0.9)'); gr.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  for (const [x, z] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 5.3], [5.3, 5.3]]) {
    mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.34, 8), bowlStone, x, -0.2, z, scene);
    const bowl = mesh(new THREE.CylinderGeometry(0.58, 0.32, 0.3, 8, 1, true), bowlStone, x, 0.12, z, scene); bowl.material.side = THREE.DoubleSide;
    mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.04, 8), new THREE.MeshBasicMaterial({ color: 0x5a1e06 }), x, 0.2, z, scene);
    for (const [r, h, mat] of flameLayers) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9, 1, true), mat);
      f.position.set(x, 0.2 + h / 2, z); f.userData.baseY = 0.2 + h / 2; f.userData.h = h; scene.add(f); flames.push(f);
    }
    const t = new THREE.PointLight(0xff9a40, 14, 11, 1.5); t.position.set(x, 1.1, z); scene.add(t); torches.push(t);
    bowls.push(new THREE.Vector3(x, 0.3, z));
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
  mesh(new THREE.BoxGeometry(30, 0.1, 30), new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 1 }), 0, -0.42, 0, boardG);
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
    torches.forEach((t, i) => { t.intensity = 13 + Math.sin(tsec * 9 + i * 2) * 1.6 + Math.sin(tsec * 23 + i) * 1.1 + fireBoost * 22; });
    flames.forEach((f, i) => {
      const k = 1 + Math.sin(tsec * 11 + i * 1.7) * 0.12 + Math.sin(tsec * 27 + i) * 0.07 + fireBoost * 0.7;
      const w = 1 / Math.sqrt(k) + fireBoost * 0.15;
      f.scale.set(w, k, w); f.position.y = 0.2 + (f.userData.h * k) / 2;
      f.rotation.y = tsec * (i % 2 ? 1.3 : -0.9);
      f.rotation.z = Math.sin(tsec * 3 + i) * 0.06;
    });
    if (!reducedMotion() && Math.random() < dt * 14) spawnEmber(bowls[Math.floor(Math.random() * bowls.length)]);
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
      d.sp.scale.setScalar(0.25 + d.life * 0.9);
      d.sp.material.opacity = Math.max(0, 0.7 * (1 - d.life / d.max));
      if (d.life > d.max) { fxG.remove(d.sp); d.sp.material.dispose(); dusts.splice(i, 1); }
    }
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
    flare, get orientation() { return orient; }, get view() { return view; },
  };
}

window.SBRender3D = { create };
