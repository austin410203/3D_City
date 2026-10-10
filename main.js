import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ERAS, MAPS, VALS, GOVS, RES_INFO } from './data.js';

// ═════════════════════════ 常數 ═════════════════════════
const N = 16, T = 30;
const YEAR_SEC = 2.2;            // 1× 速度下每「回合」秒數
const SAVE_KEY = 'civ-observer-v2-';
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W（-Z 為北）
const BIT = [1, 2, 4, 8];
const ROAD_PIECES = [['tile-road-intersection', 15], ['tile-road-intersection-t', 14], ['tile-road-straight', 5], ['tile-road-curve', 6], ['tile-road-end', 4]];
const TERRAIN = new Set(['water', 'mountain', 'hill', 'landmark']);
const ZONES = ['res', 'com', 'ind'];
const SERVICES = [
  { id: 'police', ic: '🛡️', radius: 4, pop: 30, need: 4 },
  { id: 'fire', ic: '🔥', radius: 4, pop: 70, need: 4 },
  { id: 'school', ic: '📚', radius: 5, pop: 130, need: 6 },
  { id: 'hospital', ic: '⚕️', radius: 5, pop: 220, need: 8 },
  { id: 'jail', ic: '⛓️', radius: 0, need: 3, special: true },
  { id: 'army', ic: '🛡️', radius: 5, need: 4, special: true },
];
const SRV = Object.fromEntries(SERVICES.map(s => [s.id, s]));
const POP_MILESTONES = [25, 60, 120, 250, 500, 800, 1200];
const SPEEDS = [0, 1, 2, 5, 10, 20];

// ═════════════════════════ 場景 ═════════════════════════
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY_DAY = new THREE.Color('#9fd3f0'), SKY_NIGHT = new THREE.Color('#1b2440'), SKY_DUSK = new THREE.Color('#f2a36b');
scene.background = SKY_DAY.clone();
scene.fog = new THREE.Fog(scene.background, 700, 1500);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 3000);
camera.position.set(260, 300, 330);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = 1.3; controls.minDistance = 40; controls.maxDistance = 900;
controls.screenSpacePanning = false; controls.autoRotateSpeed = 0.6;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

const hemi = new THREE.HemisphereLight('#dff1ff', '#5b6a3a', 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2dd', 2.2);
sun.position.set(220, 380, 160); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -320, bottom: -320, right: 320, top: 320, near: 10, far: 1200 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6; scene.add(sun);
const sea = new THREE.Mesh(new THREE.CircleGeometry(1600, 48), new THREE.MeshStandardMaterial({ color: '#4fa7c9', roughness: 0.4 }));
sea.rotation.x = -Math.PI / 2; sea.position.y = -9; scene.add(sea);
const world = new THREE.Group(); scene.add(world);
const agentsGroup = new THREE.Group(); scene.add(agentsGroup);
const fxGroup = new THREE.Group(); scene.add(fxGroup);

// ═════════════════════════ 模型工具 ═════════════════════════
const protos = {};
function make(name) {
  const p = protos[name];
  const g = new THREE.Group();
  if (!p) { console.warn('missing model', name); return g; }
  g.add(p.clone(true));
  return g;
}
const sizeOf = name => protos[name]?.userData.size;
function fitScale(name, target = 25, max = 1.6) { const s = sizeOf(name); return s ? Math.min(max, target / Math.max(s.x, s.z)) : 1; }
function shadows(g, cast = true) { g.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; } }); return g; }

const LAYOUTS = {
  1: [[0, 0]], 2: [[-6.5, 0], [6.5, 0]], 3: [[-7, -5], [7, -5], [0, 7]], 4: [[-7, -7], [7, -7], [-7, 7], [7, 7]],
  5: [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, 0]], 6: [[-8, -6], [0, -6], [8, -6], [-8, 6], [0, 6], [8, 6]],
};
// 依建築規格組合出一格的模型
function buildSpec(spec) {
  const [m, n, s, opt = {}] = spec;
  const g = new THREE.Group();
  let pos;
  if (opt.layout === 'field' || opt.layout === 'grid3' || n > 6) { pos = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) pos.push([a * 8, b * 8]); pos = pos.slice(0, n); }
  else pos = LAYOUTS[n];
  const scale = s || fitScale(m, 25, 1.6);
  pos.forEach(([x, z], k) => {
    const o = make(m); o.position.set(x, 0, z); o.scale.setScalar(scale);
    if (n > 1 && opt.layout !== 'grid3') o.rotation.y = opt.layout === 'field' ? (k * 1.7) : 0;
    g.add(o);
  });
  for (const [em, x, z, es] of opt.extra || []) { const o = make(em); o.position.set(x, 0, z); o.scale.setScalar(es); g.add(o); }
  if (opt.ring) { // 圍牆：沿四邊排列
    const [wm, ws] = opt.ring, len = (sizeOf(wm)?.x || 4) * ws, R = 12.5;
    const n = Math.max(1, Math.floor(2 * R / len));
    for (let side = 0; side < 4; side++) for (let k = 0; k < n; k++) {
      const o = make(wm); o.scale.setScalar(ws);
      const t = -R + len * (k + 0.5) + (2 * R - n * len) / 2;
      const rot = side % 2 ? Math.PI / 2 : 0;
      o.rotation.y = rot;
      o.position.set(side === 1 ? R : side === 3 ? -R : t, 0, side === 0 ? -R : side === 2 ? R : t);
      g.add(o);
    }
  }
  return shadows(g);
}

// 材質重新上色（沙地／時代道路）
const tintCache = new Map();
function remap(m, table, key) {
  if (!table) return m;
  let col = null;
  for (const k in table) if (m.name === k || m.name.startsWith(k)) { col = table[k]; break; }
  if (!col) return m;
  const ck = m.uuid + key;
  if (!tintCache.has(ck)) { const c = m.clone(); c.color = new THREE.Color(col); tintCache.set(ck, c); }
  return tintCache.get(ck);
}
function applyTint(obj, table, key) {
  obj.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => remap(m, table, key)) : remap(o.material, table, key); });
}
let groundTable = null;

// ═════════════════════════ 區塊烘焙（合併靜態網格以減少 draw call） ═════════════════════════
const CH = 8; // 每區塊 8×8 格
const chunks = [];
const bakedGroup = new THREE.Group(); scene.add(bakedGroup);
function chunkOf(c) { return chunks[Math.floor(c.j / CH) * (N / CH) + Math.floor(c.i / CH)]; }
function dirty(c) { const ch = chunkOf(c); if (ch) ch.dirty = true; }
function resetChunks() {
  for (const ch of chunks) disposeChunk(ch);
  chunks.length = 0;
  for (let k = 0; k < (N / CH) * (N / CH); k++) chunks.push({ dirty: true, mesh: null, cells: [] });
  for (const c of grid) chunkOf(c).cells.push(c);
}
function disposeChunk(ch) { if (ch.mesh) { bakedGroup.remove(ch.mesh); ch.mesh.traverse(o => o.geometry?.dispose()); ch.mesh = null; } }
const live = g => g && (g.userData.prop || g.userData.live);
const VC_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
// 把一組物件合併：不透明材質→單一頂點色網格；透明／發光材質各自一組
function mergeObjects(srcs, rootInv) {
  const buckets = new Map();
  const v = new THREE.Vector3(), nv = new THREE.Vector3(), mtx = new THREE.Matrix4(), nm = new THREE.Matrix3();
  for (const g of srcs) {
    g.updateMatrixWorld(true);
    g.traverse(o => {
      if (!o.isMesh || !o.visible && o !== g) return;
      const mat = o.material;
      const special = mat.transparent || (mat.emissive && mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0);
      const key = special ? mat.uuid : 'vc';
      let b = buckets.get(key); if (!b) { b = { mat: special ? mat : VC_MAT, pos: [], nor: [], col: [], idx: [], n: 0, cast: !mat.transparent }; buckets.set(key, b); }
      const geo = o.geometry, P = geo.attributes.position, Nn = geo.attributes.normal;
      mtx.copy(o.matrixWorld); if (rootInv) mtx.premultiply(rootInv);
      nm.getNormalMatrix(mtx);
      const c = mat.color || new THREE.Color(1, 1, 1), base = b.n;
      for (let i = 0; i < P.count; i++) {
        v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(mtx); b.pos.push(v.x, v.y, v.z);
        if (Nn) { nv.set(Nn.getX(i), Nn.getY(i), Nn.getZ(i)).applyMatrix3(nm).normalize(); b.nor.push(nv.x, nv.y, nv.z); } else b.nor.push(0, 1, 0);
        if (!special) b.col.push(c.r, c.g, c.b);
      }
      if (geo.index) for (let i = 0; i < geo.index.count; i++) b.idx.push(base + geo.index.getX(i));
      else for (let i = 0; i < P.count; i++) b.idx.push(base + i);
      b.n += P.count;
    });
  }
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    if (b.col.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setIndex(b.n > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
function bakeChunk(ch) {
  const srcs = [];
  for (const c of ch.cells) {
    for (const g of [c.base, c.trees, c.obj]) {
      if (!g) continue;
      const animating = g === c.obj && (c.anim !== undefined && c.anim < 1);
      if (animating || live(g)) { g.visible = true; continue; }
      g.visible = true; srcs.push(g);
    }
  }
  disposeChunk(ch);
  const out = mergeObjects(srcs);
  for (const g of srcs) g.visible = false;
  bakedGroup.add(out); ch.mesh = out; ch.dirty = false;
}
// 角色／車輛：每種模型烘焙一次後共用幾何
const agentCache = {};
function makeAgent(name) {
  if (!agentCache[name]) { const src = make(name); agentCache[name] = mergeObjects([src]); }
  const g = new THREE.Group();
  for (const m of agentCache[name].children) g.add(new THREE.Mesh(m.geometry, m.material));
  return g;
}
function bakeDirty(max = 3) {
  let k = 0;
  for (const ch of chunks) {
    if (!ch.dirty) continue;
    bakeChunk(ch); if (++k >= max) break;
  }
}

// ═════════════════════════ 狀態 ═════════════════════════
let S;                  // 存檔狀態
let M = MAPS[0], E = ERAS[0];
let grid = [];
const cellCenter = (i, j) => new THREE.Vector3((i - N / 2 + 0.5) * T, 0, (j - N / 2 + 0.5) * T);
const inside = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
const C = (i, j) => inside(i, j) ? grid[j * N + i] : null;
const cheb = (a, b) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j));
let stats = { pop: 0, jobs: 0, use: 0, sup: 0, hap: 55, dR: 0, dC: 0, dI: 0, pros: 0 };
let speedIdx = 1, yearAcc = 0;
const speed = () => SPEEDS[speedIdx];

function newState(mapId, eraId) {
  const era = ERAS.find(e => e.id === eraId) || ERAS[0];
  const k = ERAS.indexOf(era);
  return {
    map: mapId, era: era.id, start: era.id, years: 0, year: era.year0, cells: null, seed: Math.floor(Math.random() * 1e9), log: [], firsts: {}, popMs: 0,
    gov: k === 0 ? 'chief' : k >= 5 ? 'democracy' : 'monarchy', govSince: 0, tech: 0, eraStart: 0, stab: 70, crime: 0, prisoners: 0,
    ev: [], hist: [], wars: { won: 0, lost: 0 }, mood: 0, peak: 0, breakthroughs: 0,
  };
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
let rand = Math.random;

// ═════════════════════════ 地圖產生 ═════════════════════════
function buildBoard() {
  world.clear(); grid = []; for (const ch of chunks) disposeChunk(ch); chunks.length = 0;
  const r = rng(S.seed);
  SKY_DAY.set(M.sky); scene.background.set(M.sky); sea.material.color.set(M.sea);
  groundTable = M.sand ? { '36 GREEN': M.sand, '35 GREEN-MEDIUM': M.sand, '34 GREEN-DARK': new THREE.Color(M.sand).multiplyScalar(0.85).getStyle(), '37 GREEN-LIGHT': M.sand } : null;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cell = { i, j, type: 'empty', level: 0, built: 1, obj: null, base: null, trees: null, powered: true, road: false, hap: 55 };
    grid.push(cell);
    const t = M.terrain(i, j);
    if (t === 'water') { cell.type = 'water'; setBase(cell, 'tile-water', 0); continue; }
    setBase(cell, 'tile-plain', 0);
    if (t === 'hill') { cell.type = 'hill'; setBase(cell, 'tile-hill', Math.floor(r() * 4) * Math.PI / 2); cell.base.position.y = 6; }
  }
  for (const f of M.features) {
    const cs = f.cells.map(([i, j]) => C(i, j));
    const cx = cs.reduce((s, c) => s + cellCenter(c.i, c.j).x, 0) / cs.length;
    const cz = cs.reduce((s, c) => s + cellCenter(c.i, c.j).z, 0) / cs.length;
    const w = (Math.max(...f.cells.map(c => c[0])) - Math.min(...f.cells.map(c => c[0])) + 1) * T;
    const d = (Math.max(...f.cells.map(c => c[1])) - Math.min(...f.cells.map(c => c[1])) + 1) * T;
    const g = make(f.model), sz = sizeOf(f.model);
    if (f.scale) g.scale.setScalar(f.scale);
    else if (sz) { const rot = Math.abs(Math.sin(f.rot || 0)) > 0.5; g.scale.setScalar(Math.min(w / (rot ? sz.z : sz.x), d / (rot ? sz.x : sz.z)) * 0.98); }
    g.rotation.y = f.rot || 0; g.position.set(cx, 0, cz);
    shadows(g); if (f.model.startsWith('terrain')) applyTint(g, groundTable, 'g');
    world.add(g);
    for (const c of cs) c.type = f.landmark ? 'landmark' : 'mountain';
  }
  resetChunks();
  for (const c of grid) if (c.type === 'empty' && r() < M.decor.rate) addDecor(c, r);
  computeTerrainDist();
}
function setBase(cell, name, rotY) {
  if (cell.base) world.remove(cell.base);
  const b = make(name);
  b.position.copy(cellCenter(cell.i, cell.j)); b.rotation.y = rotY;
  b.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  if (name !== 'tile-park') applyTint(b, groundTable, 'g');
  if (name.startsWith('tile-road')) applyTint(b, E.road, 'r' + E.id);
  world.add(b); cell.base = b; dirty(cell);
}
function pickW(ws, x) { let s = 0; for (let k = 0; k < ws.length; k++) { s += ws[k]; if (x < s) return k; } return ws.length - 1; }
function addDecor(cell, r = Math.random) {
  const D = M.decor;
  const set = D.sets[D.pick ? D.pick(cell.i, cell.j) : pickW(D.weights, r())];
  const g = new THREE.Group();
  const n = 2 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const t = make(set[Math.floor(r() * set.length)]);
    t.position.set((r() - .5) * 22, 0, (r() - .5) * 22); t.rotation.y = r() * 6.28; t.scale.setScalar(1.3 + r() * 0.9);
    g.add(t);
  }
  shadows(g); g.position.copy(cellCenter(cell.i, cell.j));
  world.add(g); cell.trees = g; dirty(cell);
}
function clearDecor(c) { if (c.trees) { world.remove(c.trees); c.trees = null; dirty(c); } }

const tDist = { water: new Float32Array(N * N), mountain: new Float32Array(N * N), landmark: new Float32Array(N * N), landmarkV: 0 };
function computeTerrainDist() {
  const calc = (arr, pred) => { const src = grid.filter(pred); for (const c of grid) arr[c.j * N + c.i] = src.length ? Math.min(...src.map(o => cheb(o, c))) : 99; };
  calc(tDist.water, c => c.type === 'water');
  calc(tDist.mountain, c => c.type === 'mountain' || c.type === 'hill');
  calc(tDist.landmark, c => c.type === 'landmark');
  tDist.landmarkV = M.features.find(f => f.landmark)?.landmark || 0;
}

// ═════════════════════════ 道路 ═════════════════════════
const isRoad = c => c && c.type === 'road';
function roadMask(i, j) { let m = 0; DIRS.forEach(([dx, dz], k) => { if (isRoad(C(i + dx, j + dz))) m |= BIT[k]; }); return m; }
function rotMask(m, q) { for (let k = 0; k < q; k++) { let r = 0; if (m & 2) r |= 1; if (m & 4) r |= 2; if (m & 8) r |= 4; if (m & 1) r |= 8; m = r; } return m; }
function pickRoad(mask) {
  if (mask === 0) return ['tile-road-straight', 0];
  for (const [name, base] of ROAD_PIECES) for (let q = 0; q < 4; q++) if (rotMask(base, q) === mask) return [name, q * Math.PI / 2];
  return ['tile-road-intersection', 0];
}
function refreshRoad(c, force) {
  const m = roadMask(c.i, c.j);
  if (m === c.mask && !force) return;
  c.mask = m; const [name, rot] = pickRoad(m); setBase(c, name, rot);
}
function refreshAround(i, j) { for (const [dx, dz] of [[0, 0], ...DIRS]) { const c = C(i + dx, j + dz); if (!c) continue; if (isRoad(c)) refreshRoad(c); else if (c.obj && !c.fixedRot) orient(c); } }

// ═════════════════════════ 建築 ═════════════════════════
function roadDir(c) { for (const k of [2, 1, 3, 0]) if (isRoad(C(c.i + DIRS[k][0], c.j + DIRS[k][1]))) return k; return -1; }
const FACE = { 2: 0, 1: Math.PI / 2, 0: Math.PI, 3: -Math.PI / 2 };
function orient(c) { const k = roadDir(c); c.road = k >= 0; if (c.obj && k >= 0 && !c.fixedRot) c.obj.rotation.y = FACE[k]; }
const maxLv = t => E[t].length;
function zoneVal(t, lv) { const v = VALS[t], mx = maxLv(t); const x = mx > 1 ? lv / (mx - 1) * (v.length - 1) : 0; const a = Math.floor(x), b = Math.min(v.length - 1, a + 1); return Math.round(v[a] + (v[b] - v[a]) * (x - a)); }

function resourceFor(c) {
  const list = E.resource;
  if (c.resIdx !== undefined && list[c.resIdx]) return list[c.resIdx];
  return list[0];
}
function resourcePower(c) {
  const r = resourceFor(c);
  let p = r.power * (1 + 0.8 * (c.level || 0));
  if (r.kind === 'wind') p *= M.mod.windMul || 1;
  if (r.kind === 'solar') p *= M.mod.solarMul || 1;
  return Math.round(p);
}

function makePark() {
  const g = new THREE.Group();
  const p = E.park;
  if (p === 'tile') {
    const f = make('fountain'); f.scale.setScalar(1.6); g.add(f);
    [[-9, -9], [9, 9], [-9, 9], [9, -9]].forEach(([x, z], k) => { const t = make(k % 2 ? 'tree-lime' : 'tree-round'); t.position.set(x, 0, z); t.scale.setScalar(1.6); g.add(t); });
    [[0, 9.5, 0], [0, -9.5, Math.PI]].forEach(([x, z, r]) => { const b = make('bench-wood'); b.position.set(x, 0, z); b.rotation.y = r; b.scale.setScalar(1.5); g.add(b); });
  } else {
    const sets = { grove: ['tree-oak', 'tree-lime', 'tree-round', 'shrub-flowers'], palms: ['palm', 'palm-big', 'palm-round'], zen: ['tree-bonsai', 'japan-tree-tall', 'shrub-round'], ranch: ['horse', 'cow', 'haystack', 'tree-oak'] }[p];
    const pts = [[-9, -9], [9, -8], [-8, 9], [9, 9], [0, 0], [0, -11], [-11, 1], [11, 0]];
    pts.forEach(([x, z], k) => { const t = make(sets[k % sets.length]); t.position.set(x, 0, z); t.rotation.y = k; t.scale.setScalar(p === 'zen' ? 1.3 : 1.8); g.add(t); });
    if (p === 'zen') { const l = make('lantern-long'); l.scale.setScalar(3); g.add(l); }
    if (p === 'palms' || p === 'grove') { const w = make('well'); w.scale.setScalar(2.2); w.position.set(0, 0, 0); g.add(w); }
    if (p === 'ranch') { [[-12, 0, Math.PI / 2], [12, 0, Math.PI / 2], [0, -12, 0], [0, 12, 0]].forEach(([x, z, r]) => { for (let k = -2; k <= 2; k++) { const f = make('fence'); f.scale.setScalar(2.4); f.rotation.y = r; f.position.set(x + (r ? 0 : k * 5.4), 0, z + (r ? k * 5.4 : 0)); g.add(f); } }); }
  }
  return shadows(g);
}

function specFor(c) {
  if (ZONES.includes(c.type)) return E[c.type][Math.min(c.level, maxLv(c.type) - 1)];
  if (SRV[c.type]) return E[c.type];
  if (c.type === 'resource') return resourceFor(c).m;
  return null;
}
function placeObject(c, animate = true) {
  if (c.obj) { world.remove(c.obj); dirty(c); }
  let g;
  c.fixedRot = false;
  if (c.type === 'park') { g = makePark(); c.fixedRot = true; }
  else if (c.type === 'wonder') { g = buildWonder(c); c.fixedRot = true; }
  else if (c.type === 'ruin') { g = buildRuin(c); c.fixedRot = true; }
  else {
    const spec = specFor(c);
    g = buildSpec(spec);
    if (spec[3]?.layout === 'grid3' || spec[3]?.layout === 'field') c.fixedRot = true;
    const prop = g.getObjectByName('windmill-propeller'); if (prop) g.userData.prop = prop;
  }
  const ctr = c.wonderCenter || cellCenter(c.i, c.j);
  g.position.copy(ctr);
  g.userData.baseScale = 1;
  world.add(g); c.obj = g; dirty(c);
  if (!c.fixedRot) orient(c);
  if (animate) { c.anim = 0; g.scale.y = 0.001; dust(ctr, c.type === 'wonder' ? 30 : 10); }
}

// 廢墟（戰爭、災害後）
function buildRuin(c) {
  const g = new THREE.Group();
  const r = rng(c.i * 31 + c.j * 7 + (S?.years || 0));
  const cr = make(r() < .5 ? 'crater-big' : 'ground-cracked'); cr.scale.setScalar(2.6); g.add(cr);
  for (let k = 0; k < 7; k++) { const o = make('rubble-stone'); o.position.set((r() - .5) * 20, 0, (r() - .5) * 20); o.rotation.y = r() * 6; o.scale.setScalar(2.5 + r() * 2.5); g.add(o); }
  if (c.burn > 0) { for (let k = 0; k < 4; k++) { const f = make('fire'); f.position.set((r() - .5) * 16, 0, (r() - .5) * 16); f.scale.setScalar(5 + r() * 4); g.add(f); } g.userData.live = true; }
  return shadows(g);
}

// 奇觀
function buildWonder(c) {
  const era = ERAS.find(e => e.id === c.wEra) || E;
  const w = era.wonders[c.wIdx];
  const span = c.wSpan || 1, target = span * T - 4;
  if (w.build === 'stonehenge') {
    const g = new THREE.Group();
    const R = target * 0.4, ps = span > 1 ? 2.4 : 1.3;
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; const p = make('rock-pillar'); p.position.set(Math.cos(a) * R, 0, Math.sin(a) * R); p.rotation.y = -a; p.scale.setScalar(ps); g.add(p); }
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; const p = make('rock-pillar'); p.position.set(Math.cos(a) * R * 0.45, 0, Math.sin(a) * R * 0.45); p.rotation.y = -a; p.scale.setScalar(ps * 1.3); g.add(p); }
    const f = make('fire'); f.scale.setScalar(ps * 1.6); g.add(f);
    return shadows(g);
  }
  const [m, n, s, opt] = w.spec;
  let spec = w.spec;
  if (n === 1) spec = [m, 1, s ? s * span : Math.min(fitScale(m, target, 9), w.tall ? 2.2 : 9), opt];
  else spec = [m, n, s * (span > 1 ? 1.5 : 1), opt];
  const g = buildSpec(spec);
  if (n > 1 && span > 1) g.children.forEach(o => { o.position.x *= 1.8; o.position.z *= 1.8; });
  return g;
}

function addConstruction(c) {
  const g = new THREE.Group();
  const ctr = c.wonderCenter || cellCenter(c.i, c.j);
  if (E.constr === 'crane') {
    const cr = make('crane-crawler'); cr.position.set(-9, 0, 6); cr.rotation.y = 0.6; cr.scale.setScalar(1.3); g.add(cr);
    for (const [x, z] of [[-12, 12], [12, 12], [12, -12], [-12, -12]]) { const k = make('traffic-cone'); k.position.set(x, 0, z); k.scale.setScalar(2); g.add(k); }
  } else {
    const l = make(E.constr); l.position.set(-6, 0, 6); l.scale.setScalar(2.4); l.rotation.y = 0.5; g.add(l);
    const lg = make('logs'); lg.position.set(7, 0, -5); lg.scale.setScalar(2.4); g.add(lg);
    const ld = make('ladder-wood'); ld.position.set(0, 0, 0); ld.scale.setScalar(2.6); g.add(ld);
  }
  shadows(g); g.position.copy(ctr);
  world.add(g); c.crane = g;
}
function removeConstruction(c) { if (c.crane) { world.remove(c.crane); c.crane = null; } }

const dustGeo = new THREE.SphereGeometry(1, 6, 5);
const dusts = [];
function dust(ctr, n = 10) {
  if (dusts.length > 160) return;
  for (let k = 0; k < n; k++) {
    const m = new THREE.Mesh(dustGeo, new THREE.MeshStandardMaterial({ color: '#d9cdb6', transparent: true, opacity: .8 }));
    m.position.set(ctr.x + (Math.random() - .5) * 20, 1, ctr.z + (Math.random() - .5) * 20);
    m.userData = { v: new THREE.Vector3((Math.random() - .5) * 8, 6 + Math.random() * 6, (Math.random() - .5) * 8), life: 1, kind: 'dust' };
    scene.add(m); dusts.push(m);
  }
}
let smokeT = 0;
const smokeMat = new THREE.MeshBasicMaterial({ color: '#4a4440', transparent: true, opacity: 0.6, depthWrite: false });
function smoke(ctr) {
  const m = new THREE.Mesh(dustGeo, smokeMat.clone());
  m.position.set(ctr.x + (Math.random() - .5) * 14, 4, ctr.z + (Math.random() - .5) * 14);
  m.userData = { v: new THREE.Vector3((Math.random() - .5) * 2, 9 + Math.random() * 4, (Math.random() - .5) * 2), life: 1.6, kind: 'smoke' };
  scene.add(m); dusts.push(m);
}
const buildSpeed = () => 0.75 + 0.1 * (RV('wood') + RV('stone'));
function fireworks(ctr, n = 60) {
  if (dusts.length > 200) return;
  const cols = ['#ff5a5a', '#ffd84a', '#5ad1ff', '#9dff7a', '#ff7af0'];
  for (let b = 0; b < 4; b++) {
    const base = new THREE.Vector3(ctr.x + (Math.random() - .5) * 80, 70 + Math.random() * 40, ctr.z + (Math.random() - .5) * 80);
    const col = cols[Math.floor(Math.random() * cols.length)];
    for (let k = 0; k < n / 4; k++) {
      const m = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true }));
      m.position.copy(base);
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(25 + Math.random() * 10);
      m.userData = { v, life: 1 + b * 0.25, kind: 'fw' };
      m.scale.setScalar(1.3); scene.add(m); dusts.push(m);
    }
  }
}

// ═════════════════════════ 建造（AI 使用） ═════════════════════════
function buildAt(c, type, extra = {}) {
  clearDecor(c);
  c.type = type; c.level = 0; Object.assign(c, extra);
  if (type === 'road') { c.mask = -1; refreshAround(c.i, c.j); return; }
  if (type === 'park' && E.park === 'tile') setBase(c, 'tile-park', 0);
  c.built = 0; addConstruction(c);
  refreshAround(c.i, c.j);
}
function firstOf(key, text) { if (!S.firsts[key]) { S.firsts[key] = 1; log(text); } }

// ═════════════════════════ 模擬 ═════════════════════════
function simulate() {
  const blds = grid.filter(c => c.built >= 1 && !TERRAIN.has(c.type) && c.type !== 'empty' && c.type !== 'road' && c.anchor !== false);
  let sup = 0, use = 0;
  for (const c of blds) { c.road = roadDir(c) >= 0 || c.type === 'wonder' || c.type === 'ruin'; if (c.type === 'resource' && c.road) sup += resourcePower(c); }
  sup = Math.round(sup * (evOn('drought') ? 0.6 : 1) * (evOn('sandstorm') ? 0.75 : 1));
  for (const c of blds) {
    const need = ZONES.includes(c.type) ? (c.level + 1) * (c.type === 'ind' ? 3 : c.type === 'com' ? 2 : 1) : SRV[c.type] ? SRV[c.type].need : 0;
    if (!need) { c.powered = true; continue; }
    if (c.road && use + need <= sup) { use += need; c.powered = true; } else c.powered = false;
  }
  const cover = { park: new Float32Array(N * N), police: new Uint8Array(N * N), fire: new Uint8Array(N * N), school: new Uint8Array(N * N), hospital: new Uint8Array(N * N), poll: new Float32Array(N * N), wonder: new Uint8Array(N * N) };
  const stamp = (c, r, f) => { for (let j = c.j - r; j <= c.j + r; j++) for (let i = c.i - r; i <= c.i + r; i++) if (inside(i, j)) f(j * N + i, Math.max(Math.abs(i - c.i), Math.abs(j - c.j))); };
  for (const c of blds) {
    if (c.type === 'park') stamp(c, 3, (k, d) => cover.park[k] += d <= 1 ? 12 : 6);
    else if (SRV[c.type] && cover[c.type] && c.powered && c.road) stamp(c, SRV[c.type].radius, k => cover[c.type][k] = 1);
    else if (c.type === 'ind' && c.powered) stamp(c, 2, (k, d) => cover.poll[k] += (c.level + 1) * (d <= 1 ? 5 : 2.5));
    else if (c.type === 'wonder') stamp(c, 4, k => cover.wonder[k] = 1);
  }
  let pop = 0, jC = 0, jI = 0; const jm = evOn('depression') ? 0.65 : 1;
  for (const c of blds) if (ZONES.includes(c.type) && c.road && c.powered) {
    const v = zoneVal(c.type, c.level);
    if (c.type === 'res') pop += v; else if (c.type === 'com') jC += v * jm; else jI += v * jm;
  }
  jC = Math.round(jC); jI = Math.round(jI);
  const workers = pop * 0.55, jobs = jC + jI;
  const unemp = S.gov === 'communist' ? 0 : workers > 0 ? Math.max(0, workers - jobs) / workers : 0;
  const G = GOVS[S.gov];
  const plague = evGet('plague');
  const big = Math.min(1, pop / 300);
  let hs = 0, hw = 0;
  for (let k = 0; k < N * N; k++) {
    const c = grid[k];
    let h = 56 + Math.min(24, cover.park[k]) - Math.min(30, cover.poll[k]) - unemp * 22;
    h += cover.police[k] ? 7 : -7 * big; h += cover.fire[k] ? 5 : -5 * big;
    h += cover.school[k] ? 7 : -4 * big; h += cover.hospital[k] ? 7 : -4 * big;
    if (cover.wonder[k]) h += 8;
    const md = M.mod;
    if (md.treeBonus) for (const [dx, dz] of DIRS) { const n = C(c.i + dx, c.j + dz); if (n && n.trees) h += md.treeBonus; }
    if (md.water && tDist.water[k] <= md.water.r) h += md.water.v;
    if (md.far && tDist.water[k] > md.far.r) h -= md.far.v;
    if (md.mountain && tDist.mountain[k] <= md.mountain.r) h += md.mountain.v;
    if (md.dry && !cover.park[k]) h -= md.dry.v;
    if (tDist.landmark[k] <= 3) h += tDist.landmarkV;
    if (ZONES.includes(c.type) && !c.powered) h -= 25;
    h += G.hap + S.mood - S.crime * 0.12;
    if (c.trouble > 0) h -= 15;
    if (evOn('sandstorm')) h -= 10;
    if (evOn('war')) h -= 6;
    if (plague) h -= cover.hospital[k] ? 4 : 12;
    if (evOn('famine')) h -= 10;
    if (evOn('golden')) h += 6;
    c.hap = Math.max(0, Math.min(100, h));
    c.cov = { police: cover.police[k], fire: cover.fire[k], school: cover.school[k], hospital: cover.hospital[k] };
    if (c.type === 'res' && c.built >= 1) { const w = zoneVal('res', c.level); hs += c.hap * w; hw += w; }
  }
  const hap = hw ? hs / hw : 56;
  const cl = v => Math.max(-1, Math.min(1, v));
  const dR = cl((jobs - workers + 14 + (hap - 50) * 0.5) / 36);
  const dC = cl((pop * 0.34 - jC + 6) / 28 + RV('trade') * 0.06);
  const dI = cl((pop * 0.28 - jI + 10) / 28);
  const D = { res: dR, com: dC, ind: dI };

  // 成長／衰退
  for (const c of blds) {
    if (!ZONES.includes(c.type) || !c.road || !c.powered) continue;
    const need = 36 + c.level * 7;
    if ((D[c.type] > -0.1 || (c.hap >= 68 && D[c.type] > -0.6)) && c.hap >= need && c.level < maxLv(c.type) - 1) {
      const gm = G.growth * (0.7 + 0.15 * RV('food')) * (evOn('famine') || plague ? 0.2 : 1) * (evOn('golden') ? 1.6 : 1) * (evOn('depression') ? 0.4 : 1);
      if (rand() < (0.06 + Math.max(0, D[c.type]) * 0.1) * gm) { c.level++; placeObject(c); }
    } else if (c.hap < 20 && c.level > 0 && rand() < 0.03) { c.level--; placeObject(c); }
  }

  // 繁榮度
  const lots = grid.filter(c => !TERRAIN.has(c.type) && !isRoad(c) && (!onLine(c) || c.type !== 'empty'));
  const buildable = lots.length;
  const zoned = blds.filter(c => ZONES.includes(c.type));
  const developed = lots.filter(c => c.type !== 'empty' && c.built >= 1).length;
  const dev = Math.min(1, developed / Math.max(1, buildable * 0.92));
  const lvl = zoned.length ? zoned.reduce((s, c) => s + c.level / Math.max(1, maxLv(c.type) - 1), 0) / zoned.length : 0;
  const hapN = Math.max(0, Math.min(1, (hap - 35) / 40));
  const wonders = Math.min(3, grid.filter(c => c.type === 'wonder' && c.anchor && c.built >= 1 && c.wEra === E.id).length);
  const pros = Math.round(100 * (0.3 * dev + 0.3 * lvl * Math.min(1, dev * 1.5) + 0.2 * hapN * Math.min(1, dev * 2) + 0.1 * wonders / 3 + 0.1 * S.stab / 100));
  const res = blds.filter(c => c.type === 'res');
  stats = { pop, jobs, use, sup, hap, dR, dC, dI, pros, D, dev, lvl, zoned: zoned.length, buildable, wonders, unemp, workers, cover, resN: res.length, indShare: jI / Math.max(1, jobs) };
  while (S.popMs < POP_MILESTONES.length && pop >= POP_MILESTONES[S.popMs]) { log(`👥 人口突破 ${POP_MILESTONES[S.popMs]} 人`); S.popMs++; }
}

// ═════════════════════════ 自動發展 AI ═════════════════════════
const mod3 = x => ((x % 3) + 3) % 3;
const center = () => ({ i: M.center[0], j: M.center[1] });
const free = c => c && c.type === 'empty';
const underConstruction = () => grid.filter(c => c.built < 1 && c.type !== 'empty' && !TERRAIN.has(c.type)).length;
const onLine = c => mod3(c.i - M.center[0]) === 0 || mod3(c.j - M.center[1]) === 0;
// 格線上的格子保留給道路；只有當格線被地形阻斷時才允許蓋在上面
function roadAdjFree() {
  return grid.filter(c => free(c) && roadDir(c) >= 0 && (!onLine(c) || lineBlocked(c)));
}
function lineBlocked(c) {
  // 這格在格線上，但兩端都通不到其他可走的格子（被地形包夾）→ 可以拿來蓋建築
  return DIRS.filter(([dx, dz]) => { const n = C(c.i + dx, c.j + dz); return n && !TERRAIN.has(n.type) && onLine(n) && (free(n) || isRoad(n)); }).length <= 1 && !DIRS.some(([dx, dz]) => free(C(c.i + dx, c.j + dz)) && onLine(C(c.i + dx, c.j + dz)));
}
function nearCenter(c) { const o = center(); return Math.hypot(c.i - o.i, c.j - o.j); }

function extendRoads(n) {
  const o = center();
  let made = 0;
  for (let k = 0; k < n; k++) {
    let cand = grid.filter(c => free(c) && DIRS.some(([dx, dz]) => isRoad(C(c.i + dx, c.j + dz))) && (mod3(c.i - o.i) === 0 || mod3(c.j - o.j) === 0));
    // 不在格線交叉以外的位置形成並排道路
    cand = cand.filter(c => !(mod3(c.i - o.i) !== 0 && mod3(c.j - o.j) !== 0));
    if (!cand.length) cand = grid.filter(c => free(c) && DIRS.some(([dx, dz]) => isRoad(C(c.i + dx, c.j + dz))) && DIRS.filter(([dx, dz]) => free(C(c.i + dx, c.j + dz))).length >= 2 && DIRS.filter(([dx, dz]) => isRoad(C(c.i + dx, c.j + dz))).length === 1);
    if (!cand.length) break;
    cand.sort((a, b) => nearCenter(a) - nearCenter(b) + (rand() - .5) * 1.2);
    buildAt(cand[0], 'road'); made++;
  }
  if (made) firstOf('road', `🛤️ 居民開闢了第一條道路`);
  return made;
}

function bestCell(scoreFn) {
  const cs = roadAdjFree();
  if (!cs.length) return null;
  let best = null, bs = -1e9;
  for (const c of cs) { const s = scoreFn(c) + rand() * 0.8; if (s > bs) { bs = s; best = c; } }
  return best;
}
const countNear = (c, r, pred) => grid.filter(o => cheb(o, c) <= r && pred(o)).length;
// 沒有空地時：徵收一處最低等級的民居／工坊（城市更新）
function cellOrRenew(scoreFn, why) {
  const c = bestCell(scoreFn); if (c) return c;
  const old = grid.filter(o => (o.type === 'res' || o.type === 'ind' || o.type === 'com') && o.built >= 1 && o.road).sort((a, b) => a.level - b.level || scoreFn(b) - scoreFn(a))[0];
  if (!old || old.level > 1) return null;
  if (old.obj) { world.remove(old.obj); old.obj = null; dirty(old); }
  old.type = 'empty'; old.level = 0;
  if (why && rand() < 0.5) log(`🏗️ 徵收舊屋，改建${why}`);
  return old;
}

function aiTurn() {
  const pop = stats.pop;
  let actions = 2 + Math.min(4, Math.floor(pop / 200));
  const maxCon = 2 + Math.min(8, Math.floor(pop / 80));
  const nm = E.names;
  const act = () => --actions > 0 && underConstruction() < maxCon;

  // 0. 廢墟：火勢熄滅後清理並重建
  let rebuilt = 0;
  for (const c of grid) {
    if (c.type !== 'ruin') continue;
    if (c.burn > 0 && --c.burn === 0) placeObject(c, false);
    if (--c.ruinT <= 0 && c.burn <= 0 && rebuilt < 3 && rand() < 0.6) {
      const prev = c.prevType;
      if (c.obj) { world.remove(c.obj); c.obj = null; dirty(c); }
      c.type = 'empty'; rebuilt++;
      if (prev && prev !== 'wonder') buildAt(c, prev, prev === 'resource' ? { resIdx: c.prevRes } : {});
    }
  }
  if (rebuilt) firstOf('rebuild' + Math.floor(S.years / 20), `🧱 居民開始在廢墟上重建家園`);

  // 1. 資源（水源／糧倉／電力）：不足時新建，土地不夠或已有多座就升級
  const resCells = grid.filter(c => c.type === 'resource');
  const resBuilding = resCells.some(c => c.built < 1);
  const projected = stats.use + 4 + Math.ceil(stats.zoned * 0.3);
  if (!resBuilding && stats.sup <= projected) {
    const list = E.resource;
    let idx = 0;
    list.forEach((r, k) => { if ((r.minPop || 0) <= pop) idx = k; });
    if (list[idx].kind === 'wind' && M.mod.sunny && list[1] && (list[1].minPop || 0) <= pop) idx = 1;
    // 現代：把舊電廠換成新型電廠；古代：擴建（等級 +1）
    const upg = resCells.filter(c => c.built >= 1 && ((list.length > 1 && (c.resIdx || 0) < idx) || (list.length === 1 && (c.level || 0) < 5) || (list.length > 1 && (c.resIdx || 0) === list.length - 1 && (c.level || 0) < 2 && (c.resIdx || 0) >= idx)))
      .sort((a, b) => resourcePower(a) - resourcePower(b))[0];
    const cell = resCells.length >= 2 + Math.floor(pop / 500) || !roadAdjFree().length ? upg : null;
    if (cell) {
      if (list.length > 1 && (cell.resIdx || 0) < idx) cell.resIdx = idx; else cell.level = (cell.level || 0) + 1;
      cell.built = 0; if (cell.obj) { world.remove(cell.obj); cell.obj = null; dirty(cell); } addConstruction(cell);
      const lvTag = list.length > 1 ? 'i' + cell.resIdx + 'l' + (cell.level || 0) : 'l' + cell.level;
      firstOf(E.id + 'resup' + lvTag, `🔧 ${nm.resource}擴建升級${list.length > 1 && cell.resIdx === idx && !cell.level ? `為「${['風力發電', '太陽能電廠', '核能電廠'][idx]}」` : `（第 ${(cell.level || 0) + 1} 級）`}`);
      if (!act()) return;
    } else {
      const c = bestCell(c => nearCenter(c) * 0.7 - countNear(c, 1, o => o.type === 'res') * 1.5);
      if (c) { buildAt(c, 'resource', { resIdx: idx }); firstOf('resource', `${E.ic} 建立了第一座${nm.resource}`); if (!act()) return; }
    }
  }
  // 2. 公共建設
  for (const s of SERVICES) {
    if (s.special || pop < s.pop) continue;
    if (grid.some(c => c.type === s.id && c.built < 1)) continue;
    const res = grid.filter(c => (c.type === 'res' || c.type === 'com') && c.built >= 1);
    const uncovered = res.filter(c => !c.cov?.[s.id]);
    const have = grid.some(c => c.type === s.id);
    if (have && uncovered.length < Math.max(3, res.length * 0.25)) continue;
    const c = cellOrRenew(c => uncovered.filter(o => cheb(o, c) <= s.radius).length * 2 - nearCenter(c) * 0.2, nm[s.id]);
    if (c) { buildAt(c, s.id); firstOf(s.id, `${s.ic} 建立了第一座${nm[s.id]}`); if (!act()) return; }
  }
  // 2b. 監獄與軍隊
  const jails = grid.filter(c => c.type === 'jail').length, cap = jails * 25;
  if (pop >= 60 && !grid.some(c => c.type === 'jail' && c.built < 1) && ((jails === 0 && S.crime > 18) || (cap && S.prisoners > cap * 0.75))) {
    const c = cellOrRenew(c => nearCenter(c) * 0.6 - countNear(c, 2, o => o.type === 'res') * 1.2, nm.jail);
    if (c) { buildAt(c, 'jail'); firstOf('jail', `⛓️ 建立了第一座${nm.jail}`); if (!act()) return; }
  }
  const armies = grid.filter(c => c.type === 'army').length;
  const wantArmy = (pop >= 50 ? 1 : 0) + Math.floor(pop / 450) + (S.wars.lost > S.wars.won ? 1 : 0) + (S.gov === 'empire' || S.gov === 'dictatorship' ? 1 : 0) + (RV('ore') >= 3 ? 1 : 0);
  if (armies < wantArmy && !grid.some(c => c.type === 'army' && c.built < 1)) {
    const c = cellOrRenew(c => nearCenter(c) * 0.5 - countNear(c, 1, o => o.type === 'army') * 3, nm.army);
    if (c) { buildAt(c, 'army'); firstOf('army', `🛡️ 組建了第一支${nm.army}`); if (!act()) return; }
  }
  // 3. 公園
  const parks = grid.filter(c => c.type === 'park').length;
  if (stats.zoned >= 6 && parks < stats.zoned / 7 + (M.mod.dry ? stats.zoned / 10 : 0)) {
    const c = bestCell(c => countNear(c, 3, o => o.type === 'res') * 1.5 - (c.hap - 50) * 0.08 - countNear(c, 2, o => o.type === 'park') * 3);
    if (c) { buildAt(c, 'park'); firstOf('park', `🌳 開闢了第一座${nm.park}`); if (!act()) return; }
  }
  // 4. 奇觀
  const wb = grid.filter(c => c.type === 'wonder' && c.anchor && c.wEra === E.id).length;
  const wNeed = [18, 42, 66][wb];
  if (wb < 3 && stats.pros >= wNeed && !grid.some(c => c.type === 'wonder' && c.built < 1)) { if (placeWonder(wb) && !act()) return; }
  // 5. 道路擴張
  const avail = roadAdjFree().length;
  if (avail < 4 + Math.floor(pop / 150)) extendRoads(2 + Math.floor(pop / 300));
  // 6. 分區
  const D = stats.D || { res: 1, com: 0, ind: 0 };
  const zonedTotal = stats.zoned;
  for (let k = 0; k < 3 && actions > 0 && underConstruction() < maxCon; k++) {
    let t = 'res';
    if (zonedTotal === 0) t = 'res';
    else {
      const w = { res: D.res + 0.25, com: D.com, ind: D.ind };
      t = ZONES.reduce((a, b) => w[b] > w[a] ? b : a, 'res');
      if (w[t] < -0.2) break;
    }
    const c = bestCell(c => t === 'res' ? -nearCenter(c) + (c.hap - 50) * 0.08 - countNear(c, 2, o => o.type === 'ind') * 2
      : t === 'com' ? -nearCenter(c) * 1.3 + DIRS.filter(([dx, dz]) => isRoad(C(c.i + dx, c.j + dz))).length * 1.5
        : nearCenter(c) * 0.4 - countNear(c, 2, o => o.type === 'res') * 2.5 - (tDist.water[c.j * N + c.i] <= 2 ? 3 : 0));
    if (!c) { extendRoads(2); break; }
    buildAt(c, t);
    firstOf(E.id + t, `${t === 'res' ? '🏠' : t === 'com' ? '🏪' : '🌾'} 出現了第一處${nm[t]}`);
    actions--;
  }
}

function placeWonder(idx) {
  const w = E.wonders[idx];
  // 優先尋找 2×2 空地
  let best = null, bs = -1e9;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const cs = [C(i, j), C(i + 1, j), C(i, j + 1), C(i + 1, j + 1)];
    if (!cs.every(free) || cs.some(onLine)) continue;
    if (!cs.some(c => roadDir(c) >= 0)) continue;
    const s = -Math.hypot(i + 0.5 - M.center[0], j + 0.5 - M.center[1]) * 0.6 + rand();
    if (s > bs) { bs = s; best = cs; }
  }
  let cells = best, span = 2;
  if (!cells) { const c = bestCell(c => -nearCenter(c)); if (c) { cells = [c]; span = 1; } }
  if (!cells) {
    // 城市更新：拆除一處低等級的民居或工坊來興建奇觀
    const old = grid.filter(c => (c.type === 'res' || c.type === 'ind') && c.built >= 1 && c.road).sort((a, b) => a.level - b.level || nearCenter(a) - nearCenter(b))[0];
    if (!old) return false;
    if (old.obj) { world.remove(old.obj); old.obj = null; dirty(old); }
    old.type = 'empty'; cells = [old]; span = 1;
    log(`🏚️ 舊街區拆除，騰出空間興建奇觀`);
  }
  const ctr = cells.reduce((v, c) => v.add(cellCenter(c.i, c.j)), new THREE.Vector3()).multiplyScalar(1 / cells.length);
  cells.forEach((c, k) => { clearDecor(c); c.type = 'wonder'; c.wEra = E.id; c.wIdx = idx; c.wSpan = span; c.wonderCenter = ctr; c.anchor = k === 0; c.level = 0; c.built = k === 0 ? 0 : 1; c.group = cells; });
  addConstruction(cells[0]); cells[0].crane.scale.setScalar(span > 1 ? 1.6 : 1);
  log(`🏗️ 開始建造奇觀「${w.nm}」`);
  return true;
}

function advanceEra() {
  const k = ERAS.indexOf(E);
  const next = ERAS[k + 1];
  const oldE = E;
  E = next; S.era = next.id; S.eraStart = S.years; S.eraTech = S.tech;
  if (S.gov === 'chief') S.gov = 'monarchy';
  S.year = Math.max(S.year, next.year0);
  log(`${next.ic} 科技突破，文明邁入新時代：${next.nm}`, true);
  toast(`${next.ic} 邁入新時代：${next.nm}`, 'good');
  fireworks(new THREE.Vector3(), 60);
  for (const c of grid) {
    if (isRoad(c)) { refreshRoad(c, true); continue; }
    if (ZONES.includes(c.type)) c.level = Math.min(maxLv(c.type) - 1, Math.floor(c.level / Math.max(1, oldE[c.type].length - 1) * (maxLv(c.type) - 1) * 0.5));
    if (c.type === 'resource') c.resIdx = 0;
    if (c.type !== 'empty' && !TERRAIN.has(c.type) && c.type !== 'wonder' && c.type !== 'ruin' && c.built >= 1) placeObject(c);
  }
  resetAgents(); applyEraUI();
}

// ═════════════════════════ 社會：犯罪、政體、事件、科技 ═════════════════════════
const RV = k => M.res?.[k] ?? 1;
const evGet = t => S?.ev?.find(e => e.type === t);
const evOn = t => !!evGet(t);
const eraIdx = () => ERAS.indexOf(E);
const ERA_TECH = k => 250 + 250 * k;
const govName = () => { const g = GOVS[S.gov]; return g.names?.[E.id] || g.nm; };
const pickR = arr => arr[Math.floor(rand() * arr.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const builtOf = t => grid.filter(c => c.type === t && c.built >= 1);
function armyStrength() {
  return Math.round((builtOf('army').length * 30 + builtOf('police').length * 6 + stats.pop * 0.02) * GOVS[S.gov].mil * (1 + RV('ore') * 0.1) * (1 + eraIdx() * 0.15));
}
const jailCap = () => builtOf('jail').length * 25;
let shakeT = 0;

function ruinCells(cells, burn = 0) {
  let n = 0, lost = 0;
  for (const c of cells) {
    if (!c || c.type === 'empty' || isRoad(c) || TERRAIN.has(c.type) || c.type === 'ruin' || c.type === 'wonder' || c.built < 1) continue;
    if (c.type === 'res') lost += zoneVal('res', c.level);
    c.prevType = c.type; c.prevRes = c.resIdx; c.prevLevel = c.level;
    c.type = 'ruin'; c.level = 0; c.burn = burn; c.ruinT = 4 + Math.floor(rand() * 5);
    placeObject(c, false); dust(cellCenter(c.i, c.j), 5); n++;
  }
  return { n, lost };
}

// ── 犯罪 ──
function crimeTurn() {
  const G = GOVS[S.gov], pop = stats.pop;
  if (pop < 20) { S.crime = 0; return; }
  const blds = grid.filter(c => (c.type === 'res' || c.type === 'com') && c.built >= 1);
  const pc = c => stats.cover.police[c.j * N + c.i];
  const covered = blds.length ? blds.filter(pc).length / blds.length : 0;
  const cap = jailCap();
  const jailEff = cap ? Math.max(0, 1 - S.prisoners / cap) : 0;
  let rate = (6 + Math.min(30, pop / 45)) * (1 + stats.unemp * 2.2 + Math.max(0, 55 - stats.hap) / 35 + RV('trade') * 0.08 + G.crime) * (1 - covered * 0.5) * (1 - jailEff * 0.25);
  if (evOn('war') || evOn('riot') || evOn('famine')) rate *= 1.35;
  S.crime += (Math.max(0, Math.min(100, rate)) - S.crime) * 0.25;
  const n = Math.floor(S.crime / 22 + rand() * 1.3);
  for (let k = 0; k < n && blds.length; k++) {
    const c = pickR(blds);
    spawnThief(c);
    if (pc(c) && rand() < 0.55 + (G.crime < 0 ? 0.2 : 0)) {
      if (S.prisoners < cap) { S.prisoners++; if (rand() < 0.2) log(`👮 ${E.names[c.type]}竊盜案告破，嫌犯被關進${E.names.jail}`); }
      else if (rand() < 0.25) log(`⚠️ ${cap ? E.names.jail + '已經爆滿' : '城裡沒有' + E.names.jail}，嫌犯被釋放`);
    } else {
      c.trouble = 5;
      if (rand() < 0.3) log(`🦹 ${E.names[c.type]}${pickR(c.type === 'com' ? ['遭到搶劫', '被闖空門', '遭幫派勒索'] : ['遭竊', '被闖空門', '遭搶劫'])}`);
    }
  }
  if (S.prisoners > 0 && rand() < 0.35) S.prisoners = Math.max(0, S.prisoners - 1 - Math.floor(S.prisoners * 0.06));
  for (const c of grid) if (c.trouble > 0) c.trouble--;
}

// ── 穩定度 ──
function stabilityTurn() {
  const G = GOVS[S.gov];
  const age = S.years - S.govSince;
  const decline = S.gov === 'democracy' ? Math.min(15, Math.max(0, age - 80) * 0.08) : Math.min(30, Math.max(0, age - 45) * 0.18); // 王朝老化、權力腐敗／政治極化
  const t = 18 + stats.hap * 0.5 + G.stab - S.crime * 0.35 - decline - (evOn('war') ? 8 : 0) - (evOn('plague') ? 8 : 0) - (evOn('famine') ? 10 : 0) - (evOn('riot') ? 6 : 0) - (evOn('depression') ? 10 : 0) + (evOn('golden') ? 8 : 0) + Math.min(8, age * 0.2);
  if (decline > 12 && !S.firsts['decl' + S.govSince]) { S.firsts['decl' + S.govSince] = 1; log(`🍂 ${govName()}日漸腐敗，民間怨聲四起`); }
  if (S.gov === 'democracy' && age > 0 && age % 16 === 0) log(`🗳️ 舉行定期選舉，${rand() < 0.5 ? '執政黨連任' : '政黨輪替'}`);
  S.stab += (Math.max(0, Math.min(100, t)) - S.stab) * 0.12;
  S.mood *= 0.9;
}

// ── 政體 ──
function setGov(g, how) {
  const old = govName();
  S.gov = g; S.govSince = S.years;
  log(`${GOVS[g].ic} ${how}：${old} → ${govName()}`, true);
  toast(`${GOVS[g].ic} ${how}！${govName()}`, g === 'dictatorship' ? 'bad' : 'good');
  applyEraUI();
}
function govTurn() {
  if (S.years - S.govSince < 12) return;
  const k = eraIdx(), h = stats.hap, st = S.stab;
  const armies = grid.filter(c => c.type === 'army').length, schools = grid.filter(c => c.type === 'school').length;
  if (st < 28 && stats.pop > 60 && rand() < 0.12) {
    const w = {
      democracy: k >= 1 ? RV('trade') + schools * 1.2 + k * 0.6 + (S.gov === 'dictatorship' ? 2 : 0) : 0,
      communist: k >= 3 ? stats.unemp * 12 + stats.indShare * 5 + (k >= 4 ? 2 : 0) + (S.crime > 50 ? 1 : 0) : 0,
      dictatorship: S.crime / 15 + armies + S.wars.lost * 1.5,
      monarchy: k < 3 ? 3 : 0.4,
    };
    delete w[S.gov];
    const tot = Object.values(w).reduce((a, b) => a + Math.max(0, b), 0);
    let x = rand() * tot, pick = 'monarchy';
    for (const [g, v] of Object.entries(w)) { x -= Math.max(0, v); if (x <= 0) { pick = g; break; } }
    ruinCells(shuffle(grid.filter(c => (c.type === 'com' || c.type === 'res') && c.built >= 1)).slice(0, 2 + Math.floor(rand() * 3)), 3);
    S.stab = 55;
    return setGov(pick, k <= 1 ? '宮廷政變' : '革命爆發');
  }
  if (S.gov === 'chief' && stats.pop >= 120 && rand() < 0.08) return setGov('monarchy', '王權建立');
  if (S.gov === 'monarchy' && S.wars.won >= 2 && armies >= 2 && RV('ore') >= 2 && rand() < 0.07) return setGov('empire', '稱帝建國');
  if ((S.gov === 'monarchy' || S.gov === 'empire') && k >= 1 && h > 66 && st > 55 && (RV('trade') >= 2 || k >= 4) && schools >= 1 && S.years - S.govSince > 30 && rand() < 0.008 + k * 0.006) return setGov('democracy', '民主改革');
  if (S.gov === 'democracy' && S.wars.lost >= 1 && st < 40 && rand() < 0.08) return setGov('dictatorship', '軍人奪權');
  if (S.gov === 'dictatorship' && S.years - S.govSince > 30 && st > 50 && rand() < 0.06) return setGov(k >= 3 ? 'democracy' : 'monarchy', '還政於民');
  if (S.gov === 'communist' && S.years - S.govSince > 40 && rand() < (h < 55 ? 0.05 : 0.02)) return setGov('democracy', h < 55 ? '和平轉型' : '改革開放');
}

// ── 隨機事件 ──
const EVT = {
  war: { ic: '⚔️', nm: () => E.war, dur: [5, 9] },
  campaign: { ic: '🏹', nm: () => '對外遠征', dur: [5, 8] },
  riot: { ic: '🔥', nm: () => E.riot, dur: [2, 4] },
  fire: { ic: '🔥', nm: () => '城中大火', dur: [2, 3] },
  quake: { ic: '🌋', nm: () => '大地震', dur: [1, 2] },
  flood: { ic: '🌊', nm: () => M.id === 'coast' ? '海嘯來襲' : '洪水氾濫', dur: [2, 3] },
  sandstorm: { ic: '🌪️', nm: () => '沙暴', dur: [4, 7] },
  drought: { ic: '☀️', nm: () => '大旱', dur: [6, 10] },
  famine: { ic: '🥀', nm: () => '饑荒', dur: [5, 8] },
  plague: { ic: '🦠', nm: () => E.id === 'modern' ? '傳染病大流行' : '瘟疫', dur: [6, 12] },
  depression: { ic: '📉', nm: () => E.id === 'modern' || E.id === 'western' ? '經濟大蕭條' : '商路斷絕、百業蕭條', dur: [6, 12] },
  golden: { ic: '✨', nm: () => '黃金時代', dur: [8, 14] },
};
const evFx = new THREE.Group(); scene.add(evFx);
function startEvent(type, extra = {}) {
  const d = EVT[type]; const dur = d.dur[0] + Math.floor(rand() * (d.dur[1] - d.dur[0] + 1));
  const e = { type, left: dur, total: dur, nm: d.nm(), ic: d.ic, dead: 0, ...extra };
  S.ev.push(e);
  const big = ['war', 'plague', 'quake', 'flood', 'famine'].includes(type);
  log(`${d.ic} ${e.nm}${e.msg || ''}`, big);
  toast(`${d.ic} ${e.nm}！`, 'bad');
  EV_START[type]?.(e);
}
const flammable = () => grid.filter(c => c.built >= 1 && (ZONES.includes(c.type) || SRV[c.type] || c.type === 'resource' || c.type === 'park'));
const EV_START = {
  war(e) { e.enemy = Math.round((0.55 + rand() * 0.95) * (0.5 * (25 + stats.pop * 0.06) * (1 + eraIdx() * 0.15) + 0.5 * armyStrength())); e.side = Math.floor(rand() * 4); },
  campaign(e) { e.enemy = Math.round((0.5 + rand() * 0.9) * (25 + stats.pop * 0.05) * (1 + eraIdx() * 0.15)); e.side = Math.floor(rand() * 4); },
  riot() { ruinCells(shuffle(grid.filter(c => (c.type === 'com' || c.type === 'res') && c.built >= 1 && c.hap < 55)).slice(0, 1 + Math.floor(rand() * 3)), 3); for (let k = 0; k < 6; k++) spawnUnit('enemy', null, 6); },
  fire(e) {
    const cs = flammable(); if (!cs.length) return;
    const c = pickR(cs), fc = stats.cover.fire[c.j * N + c.i];
    const area = grid.filter(o => cheb(o, c) <= 1 && rand() < (fc ? 0.15 : 0.55));
    const r = ruinCells([c, ...area], 3); e.msg = `，${r.n} 棟建築付之一炬${fc ? `（${E.names.fire}及時撲滅）` : ''}`; log(`🔥 火勢${fc ? '已控制' : '延燒'}：${r.n} 棟建築燒毀`);
  },
  quake() { shakeT = 3; const r = ruinCells(shuffle(flammable()).filter(c => rand() < 0.3 + c.level * 0.12).slice(0, 2 + Math.floor(rand() * 5))); log(`🏚️ 地震震垮了 ${r.n} 棟建築`); },
  flood() { const r = ruinCells(grid.filter(c => tDist.water[c.j * N + c.i] <= (M.id === 'coast' ? 2 : 1) && rand() < 0.35)); log(`🌊 水淹 ${r.n} 棟建築`); },
  plague() { for (let k = 0; k < 10; k++) { const m = make(rand() < 0.6 ? 'covid' : 'rat'); m.scale.setScalar(m.children[0] && k % 3 ? 40 : 4); m.userData.ph = rand() * 6; evFx.add(m); } },
  famine() { },
};
const EV_TURN = {
  plague(e) {
    for (const c of grid) if (c.type === 'res' && c.level > 0 && c.built >= 1 && rand() < (stats.cover.hospital[c.j * N + c.i] ? 0.03 : 0.12) * (E.id === 'modern' ? 0.6 : 1)) { e.dead += zoneVal('res', c.level) - zoneVal('res', c.level - 1); c.level--; placeObject(c, false); }
  },
  famine(e) { for (const c of grid) if (c.type === 'res' && c.level > 0 && c.built >= 1 && rand() < 0.07) { e.dead += zoneVal('res', c.level) - zoneVal('res', c.level - 1); c.level--; placeObject(c, false); } },
  fire() { for (const c of grid) if (c.type === 'ruin' && c.burn > 1) for (const [dx, dz] of DIRS) { const n = C(c.i + dx, c.j + dz); if (n && n.built >= 1 && !stats.cover.fire[n.j * N + n.i] && rand() < 0.08) ruinCells([n], 3); } },
  war(e) { const n = Math.min(10, 2 + Math.floor(e.enemy / 25)); for (let k = 0; k < n; k++) spawnUnit('enemy', e.side, 12); for (let k = 0; k < Math.min(8, builtOf('army').length * 2 + 1); k++) spawnUnit('soldier', e.side, 12); },
  campaign(e) { for (let k = 0; k < Math.min(8, builtOf('army').length * 2); k++) spawnUnit('soldier', e.side, 10, true); },
};
const EV_END = {
  war(e) {
    const def = armyStrength(), roll = def * (0.75 + rand() * 0.5);
    if (roll >= e.enemy) { S.wars.won++; S.mood = 6; S.stab = Math.min(100, S.stab + 8); log(`🛡️ ${E.names.army}擊退了來犯之敵！（我軍 ${def} vs 敵軍 ${e.enemy}）`, true); toast('🛡️ 保衛戰勝利！', 'good'); fireworks(new THREE.Vector3(), 30); }
    else {
      S.wars.lost++; S.mood = -8; S.stab -= 15;
      const [dx, dz] = DIRS[e.side];
      const edge = c => dx ? (dx > 0 ? N - 1 - c.i : c.i) : (dz > 0 ? N - 1 - c.j : c.j);
      const n = 3 + Math.round(7 * Math.min(1, (e.enemy - roll) / e.enemy));
      const r = ruinCells(flammable().sort((a, b) => edge(a) - edge(b) + (rand() - .5) * 3).slice(0, n), 4);
      log(`💀 城池失守，敵軍燒毀 ${r.n} 棟建築（我軍 ${def} vs 敵軍 ${e.enemy}）`, true); toast('💀 戰敗，城市遭劫掠', 'bad');
    }
    agents.filter(a => a.kind === 'enemy').forEach(a => a.ttl = 0);
  },
  campaign(e) {
    const def = armyStrength() * (0.7 + rand() * 0.6);
    if (def >= e.enemy) { S.wars.won++; S.tech += 25; S.mood = 5; log(`🏆 遠征凱旋，帶回大量戰利品與工匠`, true); }
    else { S.wars.lost++; S.stab -= 12; S.mood = -6; log(`🏳️ 遠征失利，士兵死傷慘重`, true); }
  },
  plague(e) { evFx.clear(); log(`🦠 ${e.nm}結束，約 ${e.dead} 人罹難`, true); },
  famine(e) { log(`🌾 饑荒結束，約 ${e.dead} 人餓死或離開`); },
  drought() { log('🌧️ 終於下雨了，旱災解除'); },
  sandstorm() { log('🌤️ 沙暴平息'); },
  depression() { log('📈 經濟逐漸復甦'); },
  golden() { log('🌅 黃金時代落幕'); },
};
function eventsTurn() {
  for (const e of S.ev) { EV_TURN[e.type]?.(e); e.left--; }
  for (const e of S.ev.filter(e => e.left <= 0)) EV_END[e.type]?.(e);
  S.ev = S.ev.filter(e => e.left > 0);
  const pop = stats.pop;
  if (pop < 30 || S.ev.filter(e => e.type !== 'golden').length >= 2) return;
  const k = eraIdx(), armies = builtOf('army').length;
  const lastWar = S.lastWar ?? -99;
  const woodEra = E.id === 'modern' ? 0.5 : 1.3;
  const fireCov = (() => { const b = flammable(); return b.length ? b.filter(c => stats.cover.fire[c.j * N + c.i]).length / b.length : 0; })();
  const hospCov = (() => { const b = grid.filter(c => c.type === 'res'); return b.length ? b.filter(c => stats.cover.hospital[c.j * N + c.i]).length / b.length : 0; })();
  const P = {
    war: S.years - lastWar > 22 ? 0.01 + Math.min(0.02, (S.years - lastWar) * 0.0002) + RV('ore') * 0.005 + RV('trade') * 0.003 + Math.min(0.01, pop / 150000) : 0,
    campaign: (S.gov === 'empire' || S.gov === 'dictatorship') && armies >= 2 && S.years - lastWar > 15 ? 0.03 : 0,
    riot: S.stab < 45 || stats.hap < 45 ? 0.03 + Math.max(0, 45 - S.stab) / 300 : 0.002,
    fire: (0.006 + 0.004 * RV('wood')) * woodEra * (1 - fireCov * 0.75),
    quake: M.id === 'mountain' ? 0.012 : 0.003,
    flood: M.id === 'coast' ? 0.012 : M.id === 'oasis' ? 0.008 : 0,
    sandstorm: M.id === 'desert' ? 0.035 : M.id === 'oasis' ? 0.02 : 0,
    drought: 0.004 + Math.max(0, 2 - RV('water')) * 0.007,
    famine: (RV('food') <= 1 ? 0.01 : 0.003) + (evOn('drought') ? 0.06 : 0),
    depression: S.years - (S.lastDep ?? -40) > 40 ? 0.012 + RV('trade') * 0.004 : 0,
    golden: S.stab > 65 && stats.hap > 70 ? 0.012 : 0,
    plague: (0.006 + RV('trade') * 0.002 + Math.max(0, 2 - RV('water')) * 0.002 + Math.min(0.006, pop / 300000)) * (1 - hospCov * 0.6) * (E.id === 'modern' ? 0.6 : 1),
  };
  for (const [t, p] of Object.entries(shuffle(Object.entries(P)).reduce((o, [a, b]) => (o[a] = b, o), {}))) {
    if (evOn(t) || rand() >= p) continue;
    if (t === 'war' || t === 'campaign') S.lastWar = S.years;
    if (t === 'depression') S.lastDep = S.years;
    startEvent(t);
    break;
  }
}

// ── 科技與時代 ──
const BREAKS = ['💡 電腦網路普及全城', '🧬 基因醫療突破', '🔋 再生能源革命', '🤖 人工智慧時代來臨', '🚀 太空探索計畫啟動', '⚛️ 核融合發電成功', '🌐 全球貿易網絡成形', '🧠 腦機介面問世'];
function techTurn() {
  const schools = builtOf('school').length;
  const g = GOVS[S.gov].tech * (1 + RV('ore') * 0.05) * (evOn('plague') || evOn('war') ? 0.6 : 1);
  S.tech += (0.8 + schools * 1.0 + Math.sqrt(stats.pop) / 8) * g * (evOn('golden') ? 1.4 : 1);
  const k = eraIdx();
  if (k < ERAS.length - 1) { if (S.tech - (S.eraTech || 0) >= ERA_TECH(k)) advanceEra(); }
  else if (S.tech - (S.eraTech || 0) >= 400 + S.breakthroughs * 120) { S.eraTech = S.tech; log(`${BREAKS[S.breakthroughs % BREAKS.length]}`, true); S.breakthroughs++; S.mood += 4; }
}
function societyTurn() {
  crimeTurn(); stabilityTurn(); eventsTurn(); govTurn(); techTurn();
  S.peak = Math.max(S.peak, stats.pop);
  S.hist.push(stats.pop); if (S.hist.length > 400) S.hist = S.hist.filter((_, i) => i % 2 === 0);
}

// ═════════════════════════ 居民與交通 ═════════════════════════
const agents = [];
function roadNb(i, j) { const r = []; DIRS.forEach(([dx, dz], k) => { if (isRoad(C(i + dx, j + dz))) r.push(k); }); return r; }
function spawnAgent(kind) {
  const roads = grid.filter(c => isRoad(c) && roadNb(c.i, c.j).length);
  if (!roads.length) return;
  const c = roads[Math.floor(Math.random() * roads.length)];
  const ns = roadNb(c.i, c.j); const dir = ns[Math.floor(Math.random() * ns.length)];
  const list = kind === 'car' ? E.vehicles : E.people;
  const mesh = makeAgent(list[Math.floor(Math.random() * list.length)]);
  mesh.scale.setScalar(kind === 'car' ? E.vScale : 1.6);
  shadows(mesh, kind === 'car'); agentsGroup.add(mesh);
  const a = { kind, mesh, i: c.i, j: c.j, inDir: dir, outDir: dir, t: Math.random(), sp: kind === 'car' ? 0.55 + Math.random() * 0.4 : 0.14 + Math.random() * 0.07, lane: kind === 'car' ? 3.4 : 11.5, side: kind === 'car' ? 1 : (Math.random() < .5 ? 1 : -1), pause: 0 };
  if (kind === 'car' && E.id !== 'modern') a.sp *= 0.55;
  chooseNext(a, true); agents.push(a);
}
const markGeo = new THREE.ConeGeometry(0.42, 0.85, 6); markGeo.rotateX(Math.PI);
const MARK = { enemy: new THREE.MeshBasicMaterial({ color: '#ff3b3b' }), thief: new THREE.MeshBasicMaterial({ color: '#b04bff' }), soldier: new THREE.MeshBasicMaterial({ color: '#3b8bff' }) };
function spawnSpecial(kind, cell, dir, opt = {}) {
  const list = kind === 'thief' ? E.thieves : kind === 'soldier' ? E.soldiers : E.enemies;
  const mesh = makeAgent(pickR(list)); mesh.scale.setScalar(2.1);
  const mk = new THREE.Mesh(markGeo, MARK[kind]); mk.position.y = 3.2; mesh.add(mk);
  if (kind !== 'thief') { const fl = makeAgent(kind === 'enemy' ? 'flag-big' : 'flag-medieval'); fl.scale.setScalar(kind === 'enemy' ? 0.9 : 0.45); fl.position.set(0.5, 0, 0); if (rand() < 0.3) mesh.add(fl); }
  agentsGroup.add(mesh);
  const a = { kind, mesh, i: cell.i, j: cell.j, inDir: dir, outDir: dir, t: Math.random(), sp: kind === 'thief' ? 0.55 : 0.3 + Math.random() * 0.1, lane: (Math.random() - .5) * 18, side: 1, pause: 0, ttl: opt.ttl || 10, target: opt.target };
  chooseNext(a); agents.push(a);
}
function spawnThief(c) {
  if (agents.filter(a => a.kind === 'thief').length > 6) return;
  const k = roadDir(c); if (k < 0) return;
  const r = C(c.i + DIRS[k][0], c.j + DIRS[k][1]); const ns = roadNb(r.i, r.j); if (!ns.length) return;
  spawnSpecial('thief', r, pickR(ns), { ttl: 6 });
}
// 戰爭部隊：side＝敵軍來襲的方向（0北 1東 2南 3西）
function spawnUnit(kind, side, ttl = 10, outward = false) {
  if (agents.filter(a => a.kind === kind).length > 24) return;
  const roads = grid.filter(c => isRoad(c) && roadNb(c.i, c.j).length);
  if (!roads.length) return;
  const o = center();
  const edgeScore = c => side === null || side === undefined ? rand() : side === 0 ? c.j : side === 1 ? -c.i : side === 2 ? -c.j : c.i;
  let start;
  if (kind === 'enemy' && side !== null && side !== undefined) start = roads.sort((a, b) => edgeScore(a) - edgeScore(b))[Math.floor(rand() * Math.min(4, roads.length))];
  else if (kind === 'soldier') { const bases = builtOf('army'); const b = bases.length ? pickR(bases) : C(o.i, o.j); start = roads.sort((a, c) => cheb(a, b) - cheb(c, b))[0]; }
  else start = pickR(roads);
  const edgeCell = side === null || side === undefined ? o : roads.sort((a, b) => edgeScore(a) - edgeScore(b))[0];
  const target = kind === 'enemy' ? o : outward || kind === 'soldier' ? edgeCell : o;
  spawnSpecial(kind, start, pickR(roadNb(start.i, start.j)), { ttl, target });
}
function chooseNext(a, first) {
  if (a.target) {
    const ns = roadNb(a.i, a.j);
    if (ns.length) {
      const d = k => Math.hypot(a.i + DIRS[k][0] - a.target.i, a.j + DIRS[k][1] - a.target.j);
      const back = (a.inDir + 2) % 4;
      let opts = ns.filter(k => k !== back); if (!opts.length) opts = ns;
      a.outDir = rand() < 0.75 ? opts.sort((x, y) => d(x) - d(y))[0] : pickR(opts);
      return;
    }
  }
  const ns = roadNb(a.i, a.j), back = (a.inDir + 2) % 4;
  let opts = ns.filter(k => k !== back); if (!opts.length) opts = ns.length ? ns : [back];
  if (first && ns.includes(a.inDir)) { a.outDir = a.inDir; return; }
  a.outDir = opts[Math.floor(Math.random() * opts.length)];
}
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
function lanePt(out, i, j, edge, dir, lane) { const c = cellCenter(i, j); const [ex, ez] = DIRS[edge], [dx, dz] = DIRS[dir]; return out.set(c.x + ex * T / 2 - dz * lane, 0, c.z + ez * T / 2 + dx * lane); }
function updateAgents(dt) {
  const sm = Math.min(speed(), 3);
  for (let n = agents.length - 1; n >= 0; n--) {
    const a = agents[n];
    if (a.ttl !== undefined) { a.ttl -= dt * sm; if (a.ttl <= 0) { agentsGroup.remove(a.mesh); agents.splice(n, 1); continue; } }
    if (!isRoad(C(a.i, a.j))) { agentsGroup.remove(a.mesh); agents.splice(n, 1); continue; }
    if (a.pause > 0) { a.pause -= dt * sm; continue; }
    a.t += dt * a.sp * sm;
    if (a.t >= 1) {
      const [dx, dz] = DIRS[a.outDir];
      if (isRoad(C(a.i + dx, a.j + dz))) { a.i += dx; a.j += dz; }
      a.inDir = a.outDir; a.t -= 1; chooseNext(a);
      if (a.kind === 'man' && Math.random() < 0.15) a.pause = 1 + Math.random() * 3; // 居民停下來逛逛
    }
    const lane = a.lane * a.side, ee = (a.inDir + 2) % 4;
    lanePt(vA, a.i, a.j, ee, a.inDir, lane); lanePt(vB, a.i, a.j, a.outDir, a.outDir, lane);
    const c = cellCenter(a.i, a.j), [ix, iz] = DIRS[a.inDir], [ox, oz] = DIRS[a.outDir];
    vC.set(c.x - iz * lane - oz * lane, 0, c.z + ix * lane + ox * lane);
    if (a.inDir === a.outDir) vC.lerpVectors(vA, vB, .5);
    if (a.outDir === (a.inDir + 2) % 4) vC.set(c.x, 0, c.z);
    const t = a.t, u = 1 - t;
    const px = u * u * vA.x + 2 * u * t * vC.x + t * t * vB.x, pz = u * u * vA.z + 2 * u * t * vC.z + t * t * vB.z;
    const tx = 2 * u * (vC.x - vA.x) + 2 * t * (vB.x - vC.x), tz = 2 * u * (vC.z - vA.z) + 2 * t * (vB.z - vC.z);
    a.mesh.position.set(px, a.kind !== 'car' ? Math.abs(Math.sin(a.t * 40)) * 0.25 : 0, pz);
    if (tx * tx + tz * tz > 1e-6) a.mesh.rotation.y = Math.atan2(tx, tz);
  }
}
function balanceAgents() {
  const roads = grid.filter(isRoad).length;
  const wantCars = E.vehicles.length ? Math.min(40, Math.floor(roads / 3), Math.floor(stats.pop / 16)) : 0;
  const wantPpl = Math.min(55, Math.floor(stats.pop / 7) + (roads ? 2 : 0));
  const cars = agents.filter(a => a.kind === 'car').length, ppl = agents.filter(a => a.kind === 'man').length;
  if (cars < wantCars) spawnAgent('car'); else if (cars > wantCars + 2) dropAgent('car');
  if (ppl < wantPpl) spawnAgent('man'); else if (ppl > wantPpl + 3) dropAgent('man');
}
function dropAgent(kind) { const k = agents.findIndex(a => a.kind === kind); if (k >= 0) { agentsGroup.remove(agents[k].mesh); agents.splice(k, 1); } }
function resetAgents() { agents.forEach(a => agentsGroup.remove(a.mesh)); agents.length = 0; }

// 地圖特效：船、海鷗、風滾草
const fx = [];
function setupFx() {
  fxGroup.clear(); fx.length = 0;
  const water = grid.filter(c => c.type === 'water');
  const nb = M.boats || 0;
  const boatSet = { tribal: ['boat'], egypt: ['boat'], east: ['boat-sail', 'boat'], medieval: ['boat-sail', 'boat'], western: ['boat-sail', 'boat-fishing'], modern: ['boat-sail', 'boat-fishing', 'boat-speed'] }[E.id];
  for (let k = 0; k < nb && water.length > 3; k++) {
    const name = boatSet[k % boatSet.length];
    const m = make(protos[name] ? name : 'boat-sail'); m.scale.setScalar(name === 'boat-speed' ? 1.4 : 0.9); shadows(m);
    const c = water[Math.floor(Math.random() * water.length)];
    m.position.copy(cellCenter(c.i, c.j)); m.position.y = -1.5; fxGroup.add(m);
    fx.push({ kind: 'boat', m, sp: 5 + Math.random() * 6, water });
  }
  if (nb) for (let k = 0; k < 6; k++) {
    const m = make('seagull'); m.scale.setScalar(3); fxGroup.add(m);
    const c = water[Math.floor(Math.random() * water.length)];
    fx.push({ kind: 'gull', m, cx: cellCenter(c.i, c.j).x, cz: cellCenter(c.i, c.j).z, r: 20 + Math.random() * 40, a: Math.random() * 6.28, h: 30 + Math.random() * 25, sp: 0.4 + Math.random() * 0.3 });
  }
  for (let k = 0; k < (M.tumbleweeds || 0); k++) {
    const m = make('tumbleweed'); m.scale.setScalar(2.5); shadows(m); fxGroup.add(m);
    m.position.set((Math.random() - .5) * N * T, 0, (Math.random() - .5) * N * T);
    fx.push({ kind: 'weed', m, sp: 8 + Math.random() * 10, ph: Math.random() * 6 });
  }
}
function updateFx(dt) {
  const half = N * T / 2;
  for (const f of fx) {
    if (f.kind === 'boat') {
      if (!f.target || f.m.position.distanceTo(f.target) < 4) { const c = f.water[Math.floor(Math.random() * f.water.length)]; f.target = cellCenter(c.i, c.j).add(new THREE.Vector3((Math.random() - .5) * 16, -1.5, (Math.random() - .5) * 16)); }
      const d = f.target.clone().sub(f.m.position);
      let diff = Math.atan2(d.x, d.z) - f.m.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      f.m.rotation.y += diff * Math.min(1, dt * 1.2);
      f.m.position.x += Math.sin(f.m.rotation.y) * f.sp * dt; f.m.position.z += Math.cos(f.m.rotation.y) * f.sp * dt;
      f.m.position.y = -1.5 + Math.sin(performance.now() / 600 + f.sp) * 0.3;
    } else if (f.kind === 'gull') {
      f.a += dt * f.sp; f.m.position.set(f.cx + Math.cos(f.a) * f.r, f.h + Math.sin(f.a * 3) * 2, f.cz + Math.sin(f.a) * f.r);
      f.m.rotation.y = -f.a; f.m.rotation.z = Math.sin(f.a * 6) * 0.3;
    } else {
      f.ph += dt; f.m.position.x += f.sp * dt; f.m.position.z += Math.sin(f.ph * 0.7) * 3 * dt;
      f.m.position.y = Math.abs(Math.sin(f.ph * 4)) * 2.5; f.m.rotation.z -= dt * f.sp * 0.4;
      if (f.m.position.x > half) { f.m.position.x = -half; f.m.position.z = (Math.random() - .5) * N * T; }
    }
  }
}

// ═════════════════════════ UI ═════════════════════════
const $ = id => document.getElementById(id);
const fmtYear = y => y < 0 ? `西元前 ${-y} 年` : `西元 ${y} 年`;
function log(text, big) {
  S.log.unshift({ y: S.year, t: text, b: !!big });
  S.log.length = Math.min(S.log.length, 60);
  renderLog();
}
function renderLog() {
  $('log').innerHTML = S.log.map(e => `<div class="ev${e.b ? ' big' : ''}"><span>${fmtYear(e.y)}</span>${e.t}</div>`).join('');
}
function toast(msg, cls = '') {
  const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = msg;
  $('toasts').appendChild(t); setTimeout(() => t.remove(), 3600);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}
function applyEraUI() {
  const k = ERAS.indexOf(E);
  $('era').innerHTML = `${E.ic} ${E.nm} <small>${k + 1}/${ERAS.length}</small>`;
  $('era').style.borderColor = E.color;
  $('gov').innerHTML = `${GOVS[S.gov].ic} ${govName()}`;
  $('gov').title = GOVS[S.gov].desc;
  $('s-resic').textContent = { tribal: '💧', egypt: '💧', east: '🌾', medieval: '💧', western: '💧', modern: '⚡' }[E.id];
  $('s-resic').parentElement.title = E.names.resource + ' 使用/供應';
  $('mapres').innerHTML = Object.entries(RES_INFO).map(([key, r]) => `<span title="${r.nm}：${r.eff}">${r.ic}<i>${'●'.repeat(RV(key))}${'○'.repeat(3 - RV(key))}</i></span>`).join('');
}
function setBar(id, v, cls) { const e = $(id); e.style.width = Math.max(0, Math.min(100, v)) + '%'; if (cls) e.className = cls; }
function updateHUD() {
  $('s-year').textContent = fmtYear(S.year);
  $('s-pop').textContent = stats.pop.toLocaleString();
  $('s-jobs').textContent = stats.jobs.toLocaleString();
  $('s-hap').textContent = Math.round(stats.hap) + '%';
  $('s-hapicon').textContent = stats.hap > 70 ? '😄' : stats.hap > 45 ? '🙂' : stats.hap > 25 ? '😐' : '😠';
  $('s-res').textContent = `${stats.use}/${stats.sup}`;
  const p = Math.max(0, Math.min(100, stats.pros));
  $('pros-fill').style.width = p + '%';
  $('pros-val').textContent = p + '%';
  $('pros-detail').innerHTML = `開發 ${Math.round(stats.dev * 100)}%・建築 ${Math.round(stats.lvl * 100)}%・奇觀 ${stats.wonders}/3・歷史最高人口 ${S.peak.toLocaleString()}`;
  setBar('b-stab', S.stab, S.stab < 30 ? 'bad' : S.stab < 50 ? 'warn' : '');
  setBar('b-crime', S.crime, S.crime > 50 ? 'bad' : S.crime > 25 ? 'warn' : '');
  $('v-stab').textContent = Math.round(S.stab);
  $('v-crime').textContent = Math.round(S.crime);
  $('v-army').textContent = armyStrength();
  $('v-jail').textContent = `${S.prisoners}/${jailCap()}`;
  $('v-wars').textContent = `${S.wars.won}勝 ${S.wars.lost}敗`;
  const k = ERAS.indexOf(E);
  const need = k < ERAS.length - 1 ? ERA_TECH(k) : 400 + S.breakthroughs * 120;
  const got = S.tech - (S.eraTech || 0);
  setBar('b-tech', got / need * 100);
  $('v-tech').textContent = k < ERAS.length - 1 ? `→ ${ERAS[k + 1].ic} ${ERAS[k + 1].nm} ${Math.floor(got / need * 100)}%` : `→ 下一項突破 ${Math.floor(got / need * 100)}%`;
  const bar = (id, v) => { const e = $(id); if (v >= 0) { e.style.bottom = '50%'; e.style.top = ''; e.style.height = v * 50 + '%'; } else { e.style.top = '50%'; e.style.bottom = ''; e.style.height = -v * 50 + '%'; } };
  bar('d-r', stats.dR); bar('d-c', stats.dC); bar('d-i', stats.dI);
  $('events').innerHTML = S.ev.map(e => `<div class="evb ${e.type}"><span>${e.ic}</span>${e.nm}<i style="width:${e.left / e.total * 100}%"></i></div>`).join('');
  drawHist();
  if (infoCell) showInfo(infoCell);
}
function drawHist() {
  const cv = $('hist'), ctx = cv.getContext('2d');
  const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const H = S.hist; if (H.length < 2) return;
  const mx = Math.max(10, ...H);
  ctx.beginPath(); ctx.moveTo(0, h);
  H.forEach((v, i) => ctx.lineTo(i / (H.length - 1) * w, h - v / mx * (h - 4)));
  ctx.lineTo(w, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,207,74,.55)'); g.addColorStop(1, 'rgba(255,207,74,0)');
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); H.forEach((v, i) => { const x = i / (H.length - 1) * w, y = h - v / mx * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 1.5 * devicePixelRatio; ctx.stroke();
}

let infoCell = null;
const NAMES_T = { water: '水域', mountain: '山脈', hill: '丘陵', landmark: '古代遺跡', road: '道路', empty: '荒地' };
function showInfo(c) {
  infoCell = c;
  const box = $('info');
  if (!c || c.type === 'empty') { box.classList.add('hidden'); infoCell = null; return; }
  box.classList.remove('hidden');
  let h;
  if (c.type === 'wonder') {
    const era = ERAS.find(e => e.id === c.wEra);
    h = `<h3>🏛️ ${era.wonders[c.wIdx].nm}</h3><div class="row">時代<b>${era.ic} ${era.nm}</b></div><div class="row">狀態<b>${(c.group?.[0] || c).built < 1 ? '🏗️ 建造中 ' + Math.floor((c.group?.[0] || c).built * 100) + '%' : '✨ 已完工'}</b></div><div class="row">效果<b>周邊 4 格滿意度 +8</b></div>`;
  } else if (TERRAIN.has(c.type) || c.type === 'road') h = `<h3>${NAMES_T[c.type]}</h3>`;
  else if (c.type === 'ruin') h = `<h3>🏚️ 廢墟</h3><div class="row">原本是<b>${E.names[c.prevType] || '建築'}</b></div><div class="row">狀態<b>${c.burn > 0 ? '🔥 燃燒中' : '🧱 等待重建'}</b></div>`;
  else {
    const nm = E.names[c.type];
    const z = ZONES.includes(c.type);
    h = `<h3>${nm}${z ? `<span class="lv">Lv.${c.level + 1}/${maxLv(c.type)}</span>` : ''}</h3>`;
    if (c.built < 1) h += `<div class="row">狀態<b>🏗️ 建造中 ${Math.floor(c.built * 100)}%</b></div>`;
    if (z) h += `<div class="row">${c.type === 'res' ? '居民' : '工作'}<b>${zoneVal(c.type, c.level)}</b></div><div class="row">滿意度<b>${Math.round(c.hap)}%</b></div>`;
    if (c.type === 'resource') h += `<div class="row">供應量<b>${resourcePower(c)}</b></div>`;
    if (z || SRV[c.type]) h += `<div class="row">${E.names.resource}<b>${c.powered ? '✅ 充足' : '❌ 不足'}</b></div>`;
    if (SRV[c.type] && SRV[c.type].radius) h += `<div class="row">服務範圍<b>${SRV[c.type].radius} 格</b></div>`;
    if (c.type === 'jail') h += `<div class="row">容量<b>25 人</b></div><div class="row">全城囚犯<b>${S.prisoners}/${jailCap()}</b></div>`;
    if (c.type === 'army') h += `<div class="row">全城軍力<b>${armyStrength()}</b></div>`;
    if (c.trouble > 0) h += `<div class="row">治安<b>🦹 近期遭竊</b></div>`;
  }
  box.innerHTML = h;
}

// 點擊選取
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hover = new THREE.Mesh(new THREE.BoxGeometry(T, 1.2, T), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .25, depthWrite: false }));
hover.visible = false; scene.add(hover);
function cellAt(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, p)) return null;
  return C(Math.floor(p.x / T + N / 2), Math.floor(p.z / T + N / 2));
}
let down = null;
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointermove', e => { const c = cellAt(e); hover.visible = !!c; if (c) { hover.position.copy(cellCenter(c.i, c.j)); hover.position.y = 0.6; } });
renderer.domElement.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) showInfo(cellAt(e)); down = null; });

// 速度
const spBox = $('speeds');
SPEEDS.forEach((s, k) => { const b = document.createElement('button'); b.textContent = s ? s + '×' : '⏸'; b.onclick = () => setSpeed(k); spBox.appendChild(b); });
function setSpeed(k) { speedIdx = k; [...spBox.children].forEach((b, i) => b.classList.toggle('on', i === k)); }
setSpeed(1);
$('orbit').onclick = () => { controls.autoRotate = !controls.autoRotate; $('orbit').classList.toggle('on', controls.autoRotate); };
addEventListener('keydown', e => {
  if (e.key === ' ') { e.preventDefault(); setSpeed(speedIdx ? 0 : 1); }
  if (e.key >= '1' && e.key <= '5') setSpeed(+e.key);
  if (e.key === 'r' || e.key === 'R') $('orbit').click();
});
$('menuBtn').onclick = () => { save(); showLevels(); };
$('logToggle').onclick = () => $('side').classList.toggle('collapsed');

// 關卡選擇
let pickEra = 'tribal';
function showLevels() {
  const eraBox = $('eraList'); eraBox.innerHTML = '';
  for (const e of ERAS) {
    const b = document.createElement('button'); b.className = 'erachip' + (pickEra === e.id ? ' on' : '');
    b.innerHTML = `<span>${e.ic}</span>${e.nm}`; b.title = e.desc;
    b.onclick = () => { pickEra = e.id; showLevels(); };
    eraBox.appendChild(b);
  }
  const eraDef = ERAS.find(e => e.id === pickEra);
  $('eraDesc').innerHTML = `<b>起始時代：${eraDef.ic} ${eraDef.nm}</b>　${eraDef.desc}<br><small>文明會隨科技累積持續演進到下一個時代，途中會遭遇戰爭、災害、瘟疫與犯罪，政體也可能改變——沒有終點，一直發展下去。</small>`;
  const box = $('levelList'); box.innerHTML = '';
  for (const m of MAPS) {
    const sv = load(m.id, pickEra);
    const card = document.createElement('div'); card.className = 'lvcard'; card.style.setProperty('--sky', m.sky);
    const resRow = Object.entries(RES_INFO).map(([k, r]) => `<span title="${r.nm}：${r.eff}">${r.ic}<i>${'●'.repeat(m.res[k])}${'○'.repeat(3 - m.res[k])}</i></span>`).join('');
    card.innerHTML = `<div class="lvhead"><span class="lvic">${m.ic}</span><div><b>${m.nm}</b><small>難度 ${m.diff}</small></div></div>
      <p>${m.desc}</p><div class="resrow">${resRow}</div><ul>${m.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      <div class="lvbtns">${sv ? `<button data-act="cont">▶ 繼續觀看<small>${fmtYear(sv.year)}・${(ERAS.find(e => e.id === sv.era) || E).ic} ${GOVS[sv.gov]?.ic || ''}</small></button><button data-act="new" class="ghost">重來</button>` : `<button data-act="new">開始觀察文明</button>`}</div>`;
    card.querySelectorAll('button').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'new' && sv && !confirm('重新開始？原本的進度會被覆蓋。')) return;
      $('levels').classList.add('hidden');
      startGame(b.dataset.act === 'cont' ? sv : newState(m.id, pickEra));
    });
    box.appendChild(card);
  }
  $('levels').classList.remove('hidden');
}

// ═════════════════════════ 存讀檔 ═════════════════════════
const slot = (mapId, eraId) => SAVE_KEY + mapId + '-' + eraId;
function save() {
  if (!S || !grid.length) return;
  S.cells = grid.map(c => {
    if (c.type === 'empty') return c.trees ? 1 : 0;
    if (TERRAIN.has(c.type)) return 0;
    if (c.type === 'wonder') return ['wonder', 0, +c.built.toFixed(2), c.wEra, c.wIdx, c.wSpan, c.group.map(g => g.j * N + g.i).join(','), c.anchor ? 1 : 0];
    if (c.type === 'ruin') return ['ruin', 0, 1, null, c.prevType || null, c.ruinT || 1, c.prevRes ?? null];
    return [c.type, c.level, +c.built.toFixed(2), c.resIdx ?? null];
  });
  try { localStorage.setItem(slot(S.map, S.start), JSON.stringify(S)); localStorage.setItem(SAVE_KEY + 'last', slot(S.map, S.start)); } catch { }
}
function load(mapId, eraId) { try { return JSON.parse(localStorage.getItem(slot(mapId, eraId))); } catch { return null; } }
addEventListener('beforeunload', save);
setInterval(save, 15000);

function startGame(state) {
  S = state; M = MAPS.find(m => m.id === S.map) || MAPS[0]; E = ERAS.find(e => e.id === S.era) || ERAS[0];
  rand = rng(S.seed + 7);
  resetAgents(); showInfo(null); evFx.clear(); shakeT = 0;
  if (evOn('plague')) EV_START.plague();
  buildBoard(); setupFx();
  if (S.cells) {
    const groups = [];
    grid.forEach((c, k) => {
      const v = S.cells[k];
      if (TERRAIN.has(c.type)) return;
      if (v === 0) clearDecor(c);
      else if (v === 1) { if (!c.trees) addDecor(c); }
      else if (Array.isArray(v)) {
        clearDecor(c); c.type = v[0]; c.level = v[1]; c.built = v[2];
        if (v[0] === 'wonder') { c.wEra = v[3]; c.wIdx = v[4]; c.wSpan = v[5]; c.anchor = !!v[7]; c._g = v[6]; if (c.anchor) groups.push(c); }
        else if (v[0] === 'ruin') { c.prevType = v[4]; c.ruinT = v[5]; c.prevRes = v[6]; c.burn = 0; }
        else if (v[3] !== null && v[3] !== undefined) c.resIdx = v[3];
      }
    });
    for (const a of groups) {
      const cells = a._g.split(',').map(Number).map(k => grid[k]);
      const ctr = cells.reduce((v, c) => v.add(cellCenter(c.i, c.j)), new THREE.Vector3()).multiplyScalar(1 / cells.length);
      cells.forEach(c => { c.group = cells; c.wonderCenter = ctr; });
    }
    grid.forEach(c => { if (isRoad(c)) { c.mask = -1; refreshRoad(c); } });
    grid.forEach(c => {
      if (c.type === 'park' && E.park === 'tile') setBase(c, 'tile-park', 0);
      if (c.type === 'empty' || c.type === 'road' || TERRAIN.has(c.type)) return;
      if (c.type === 'wonder' && !c.anchor) return;
      if (c.built >= 1) placeObject(c, false); else addConstruction(c);
    });
  } else seedSettlement();
  camera.position.set(200, 260, 290); controls.target.copy(cellCenter(...M.center)).multiplyScalar(0.5);
  applyEraUI(); renderLog();
  simulate(); updateHUD();
  yearAcc = 0;
}
function seedSettlement() {
  const o = C(...M.center);
  // 在中心附近找一塊可用的起點
  let start = o;
  if (!start || TERRAIN.has(start.type)) start = grid.filter(c => !TERRAIN.has(c.type)).sort((a, b) => cheb(a, o) - cheb(b, o))[0];
  M.center = [start.i, start.j];
  buildAt(start, 'road');
  extendRoads(4);
  log(`${E.ic} 第一批先民來到${M.nm}，在此定居（${govName()}）`, true);
}

// ═════════════════════════ 主迴圈 ═════════════════════════
const clock = new THREE.Clock();
let agentTimer = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const sp = speed(), sdt = dt * sp;
  if (S && sp > 0) {
    yearAcc += sdt;
    let guard = 0;
    while (yearAcc >= YEAR_SEC && guard++ < 4) {
      yearAcc -= YEAR_SEC;
      S.years++; S.year += E.step;
      if (S.year === 0) S.year = 1;
      simulate(); societyTurn(); aiTurn();
    }
    if (guard) updateHUD();
  }
  for (const c of grid) {
    if (c.built < 1 && c.type !== 'empty' && !TERRAIN.has(c.type) && !(c.type === 'wonder' && !c.anchor)) {
      c.built = Math.min(1, c.built + sdt * buildSpeed() / (c.type === 'wonder' ? 12 : 3));
      if (c.built >= 1) {
        removeConstruction(c); placeObject(c);
        if (c.type === 'wonder') { const w = ERAS.find(e => e.id === c.wEra).wonders[c.wIdx]; log(`🏛️ 奇觀「${w.nm}」落成！`, true); toast(`🏛️ 奇觀「${w.nm}」落成！`, 'good'); fireworks(c.wonderCenter, 60); }
      }
    }
    if (c.obj && c.anim !== undefined && c.anim < 1) {
      c.anim = Math.min(1, c.anim + dt * 2.2);
      if (c.anim >= 1) dirty(c); // 動畫結束後併入區塊
      const k = c.anim, e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      c.obj.scale.y = Math.max(0.001, e);
    }
    if (c.obj?.userData.prop && sp > 0) c.obj.userData.prop.rotation.z += dt * 2.5;
  }
  for (let k = dusts.length - 1; k >= 0; k--) {
    const d = dusts[k], u = d.userData;
    u.life -= dt * (u.kind === 'fw' ? 0.7 : 1.2);
    d.position.addScaledVector(u.v, dt);
    if (u.kind === 'fw') { u.v.y -= 12 * dt; u.v.multiplyScalar(0.98); d.material.opacity = Math.max(0, Math.min(1, u.life)); }
    else if (u.kind === 'smoke') { d.scale.setScalar(2.5 + (1.6 - u.life) * 5); d.material.opacity = Math.max(0, u.life * .35); }
    else { u.v.multiplyScalar(0.94); d.scale.setScalar(2 + (1 - u.life) * 4); d.material.opacity = Math.max(0, u.life * .7); }
    if (u.life <= 0) { scene.remove(d); d.material.dispose(); dusts.splice(k, 1); }
  }
  bakeDirty(4);
  // 災害特效：煙霧、地震、沙暴、瘟疫
  smokeT += dt;
  if (smokeT > 0.25) { smokeT = 0; for (const c of grid) if (c.type === 'ruin' && c.burn > 0 && dusts.length < 220) smoke(cellCenter(c.i, c.j)); }
  if (shakeT > 0) { shakeT -= dt; scene.position.set((Math.random() - .5) * 3, 0, (Math.random() - .5) * 3); } else scene.position.set(0, 0, 0);
  const storm = S && evOn('sandstorm');
  scene.fog.near += ((storm ? 60 : 700) - scene.fog.near) * Math.min(1, dt); scene.fog.far += ((storm ? 520 : 1500) - scene.fog.far) * Math.min(1, dt);
  evFx.children.forEach((m, k) => { m.userData.ph += dt; const c = grid.filter(c => c.type === 'res')[k * 7 % Math.max(1, stats.resN)] ; if (c && !m.userData.home) m.userData.home = cellCenter(c.i, c.j); const h = m.userData.home; if (h) m.position.set(h.x + Math.sin(m.userData.ph) * 6, 14 + Math.sin(m.userData.ph * 2) * 3, h.z + Math.cos(m.userData.ph) * 6); m.rotation.y += dt; });
  agentTimer += dt; if (agentTimer > 0.3) { agentTimer = 0; balanceAgents(); }
  updateAgents(dt); updateFx(dt);

  // 晝夜：每 12 回合一個循環
  const cyc = S ? ((S.years + yearAcc / YEAR_SEC) % 12) / 12 : 0.25;
  const a = cyc * Math.PI * 2, day = Math.max(0, Math.sin(a));
  const lk = 0.4 + 0.6 * Math.min(1, day * 2.2);
  sun.intensity = 2.4 * lk; hemi.intensity = 0.55 + 0.65 * lk;
  sun.position.set(Math.cos(a) * 300, 120 + 300 * day, 160);
  const sky = scene.background;
  if (day > 0.25) sky.copy(SKY_DAY); else if (day > 0) sky.copy(SKY_DUSK).lerp(SKY_DAY, day / 0.25); else sky.copy(SKY_NIGHT).lerp(SKY_DUSK, Math.max(0, 1 + Math.sin(a) * 4));
  if (S && evOn('sandstorm')) sky.lerp(new THREE.Color('#d9a35a'), 0.75);
  scene.fog.color.copy(sky);

  controls.update();
  const lim = N * T / 2;
  controls.target.x = Math.max(-lim, Math.min(lim, controls.target.x));
  controls.target.z = Math.max(-lim, Math.min(lim, controls.target.z));
  controls.target.y = 0;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ═════════════════════════ 載入 ═════════════════════════
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
loader.load('models/town.glb', gltf => {
  const root = gltf.scene; root.updateMatrixWorld(true);
  for (const o of [...root.children]) { const b = new THREE.Box3().setFromObject(o); const s = new THREE.Vector3(); b.getSize(s); o.userData.size = s; protos[o.name] = o; }
  root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.transparent) m.depthWrite = false; }); });
  $('loading').classList.add('hidden');
  let last = null; try { last = localStorage.getItem(SAVE_KEY + 'last'); } catch { }
  let st = null; try { st = last && JSON.parse(localStorage.getItem(last)); } catch { }
  startGame(st || newState('grass', 'tribal'));
  showLevels();
  tick();
}, p => { if (p.total) $('loadbar').style.width = (p.loaded / p.total * 100) + '%'; }, err => { $('loadtxt').textContent = '模型載入失敗：' + err.message; });

window.__game = {
  start: (m, e) => { $('levels').classList.add('hidden'); startGame(newState(m, e)); },
  event: t => startEvent(t),
  run: n => { for (let k = 0; k < n; k++) { S.years++; S.year += E.step; simulate(); societyTurn(); aiTurn(); grid.forEach(c => { if (c.built < 1 && c.type !== 'empty') c.built = Math.min(1, c.built + 0.34); if (c.built >= 1 && c.crane) { removeConstruction(c); placeObject(c, false); } }); } grid.forEach(c => { if (c.obj && c.anim < 1) { c.anim = 1; c.obj.scale.y = 1; } }); bakeDirty(99); updateHUD(); },
  get info() { let n = 0; scene.traverse(o => { if (o.isMesh) n++; }); const vis = g => { let k = 0; g.traverseVisible(o => { if (o.isMesh) k++; }); return k; }; return { meshes: n, calls: renderer.info.render.calls, world: vis(world), baked: vis(bakedGroup), agents: vis(agentsGroup), fx: vis(fxGroup), dirty: chunks.filter(c => c.dirty).length, other: scene.children.length }; }, get S() { return S; }, get stats() { return stats; }, get grid() { return grid; }, camera, controls, setSpeed,
};
