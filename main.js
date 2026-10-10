import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ───────────────────────── 常數與資料 ─────────────────────────
const N = 16;            // 網格大小
const T = 30;            // 每格寬度（Blender tile 為 30m）
const DAY_SEC = 1.6;     // 1x 速度下一天的秒數
const SAVE_KEY = 'tinytown-save-v2-';
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W（-Z 為北）
const BIT = [1, 2, 4, 8];

// 道路 tile 在模型中的連接方向（N=1 E=2 S=4 W=8）
const ROAD_PIECES = [
  ['tile-road-intersection', 15],
  ['tile-road-intersection-t', 2 | 4 | 8],
  ['tile-road-straight', 1 | 4],
  ['tile-road-curve', 4 | 2],
  ['tile-road-end', 4],
];

const ZONE = {
  res: { levels: ['building-house-family-small', 'building-house-middle', 'building-house-big', 'building-house-modern', 'building-house-family-large'], val: [4, 10, 18, 30, 48] },
  com: { levels: ['building-shop-china', 'building-cafe', 'building-restaurant', 'building-mall', 'building-office', 'building-office-tall'], val: [4, 8, 14, 24, 40, 64] },
  ind: { levels: ['industry-building', 'industry-warehouse', 'industry-factory'], val: [10, 20, 36] },
};

const TOOLS = [
  { id: 'select', ic: '👆', nm: '選取', cost: 0 },
  { id: 'road', ic: '🛣️', nm: '道路', cost: 10 },
  { id: 'res', ic: '🏠', nm: '住宅', cost: 100 },
  { id: 'com', ic: '🏪', nm: '商業', cost: 150 },
  { id: 'ind', ic: '🏭', nm: '工業', cost: 200 },
  { sep: true },
  { id: 'power', ic: '🌬️', nm: '風車', cost: 300, power: 40, upkeep: 2, model: 'windmill' },
  { id: 'solar', ic: '☀️', nm: '太陽能', cost: 700, power: 110, upkeep: 3, unlock: 200 },
  { id: 'park', ic: '🌳', nm: '公園', cost: 80, upkeep: 0.5 },
  { id: 'police', ic: '🚓', nm: '警察局', cost: 450, upkeep: 4, radius: 4, model: 'building-policestation', unlock: 40, power: -4 },
  { id: 'fire', ic: '🚒', nm: '消防局', cost: 450, upkeep: 4, radius: 4, model: 'building-firestation', unlock: 40, power: -4 },
  { id: 'school', ic: '🏫', nm: '學校', cost: 700, upkeep: 6, radius: 5, model: 'building-school', unlock: 120, power: -6 },
  { id: 'hospital', ic: '🏥', nm: '醫院', cost: 900, upkeep: 8, radius: 5, model: 'building-hospital', unlock: 250, power: -8 },
  { sep: true },
  { id: 'bulldoze', ic: '🚜', nm: '拆除', cost: 5 },
];
const TOOL = Object.fromEntries(TOOLS.filter(t => t.id).map(t => [t.id, t]));
const NAMES = { road: '道路', res: '住宅區', com: '商業區', ind: '工業區', power: '風力發電', solar: '太陽能電廠', park: '公園', police: '警察局', fire: '消防局', school: '學校', hospital: '醫院', water: '水域', mountain: '山脈', hill: '丘陵', landmark: '金字塔遺跡' };
const GOALS = [40, 120, 250, 500, 1000, 2000];

// ───────────────────────── 地圖關卡 ─────────────────────────
const TERRAIN = new Set(['water', 'mountain', 'hill', 'landmark']);
const dist = (i, j, x, y) => Math.hypot(i - x, j - y);
const MAPS = [
  {
    id: 'grass', ic: '🌾', nm: '綠野平原', diff: '★☆☆', money: 5000,
    desc: '一望無際的草原與農場。地形平坦、空間充足，最適合新手。',
    rules: ['🐄 田園風光：附近有樹林的住宅滿意度更高'],
    sky: '#9fd3f0', sea: '#4fa7c9',
    terrain: () => null,
    features: [],
    decor: { rate: 0.3, sets: [['tree-round', 'tree-lime', 'tree-oak', 'tree-simple', 'tree-lime_red', 'shrub-round', 'shrub-flowers'], ['cow', 'cow', 'horse', 'haystack', 'hay-pile', 'grass-tall'], ['sunflower', 'sunflower', 'sunflower', 'scarecrow', 'grass-tall']], weights: [0.65, 0.2, 0.15] },
    roads: [[2, 8, 13, 8, 'h'], [7, 5, 7, 11, 'v']],
    windmill: [5, 7],
    mod: { treeBonus: 3 },
  },
  {
    id: 'coast', ic: '🌊', nm: '蔚藍海灣', diff: '★★☆', money: 5000,
    desc: '依海而建的港灣小鎮，海岸線切割出不規則的土地，帆船在海上航行。',
    rules: ['🏖️ 海景：距海 2 格內的建築滿意度 +14', '🌬️ 海風強勁：風車發電 +25%'],
    sky: '#8fd0f2', sea: '#3f9fd0',
    terrain(i, j) { const k = i * 0.75 + j + Math.sin(i * 0.9) * 1.3; return k > 18.5 ? 'water' : null; },
    features: [{ model: 'lighthouse', cells: [[12, 7]], scale: 1.6 }],
    decor: { rate: 0.28, sets: [['palm', 'palm-big', 'palm-round', 'palm-angle', 'palm-small'], ['tree-round', 'tree-lime', 'shrub-round', 'shrub-flowers']], weights: [0.5, 0.5] },
    roads: [[1, 5, 11, 5, 'h'], [5, 2, 5, 11, 'v']],
    windmill: [3, 4],
    boats: 5,
    mod: { water: { r: 2, v: 14 }, windMul: 1.25 },
  },
  {
    id: 'mountain', ic: '⛰️', nm: '群山峽谷', diff: '★★☆', money: 5500,
    desc: '高山環繞的峽谷，可用土地被山脈與丘陵切割，森林茂密、野生動物出沒。',
    rules: ['🏔️ 山景：距山 2 格內滿意度 +8', '🌬️ 山谷風口：風車發電 +50%', '🚧 地形破碎，規劃道路要更用心'],
    sky: '#a9d6ea', sea: '#4b8fb0',
    terrain(i, j) { const hills = ['3,3', '11,4', '4,10', '9,11', '13,9', '2,6', '10,2']; return hills.includes(i + ',' + j) ? 'hill' : null; },
    features: [
      { model: 'terrain-mountains', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
      { model: 'terrain-mountains', cells: [[14, 0], [15, 0], [14, 1], [15, 1]], rot: Math.PI / 2 },
      { model: 'mountains', cells: [[5, 14], [6, 14], [7, 14], [5, 15], [6, 15], [7, 15]], rot: Math.PI },
      { model: 'terrain-mountains', cells: [[13, 13], [14, 13], [13, 14], [14, 14]], rot: Math.PI },
      { model: 'terrain-mountains', cells: [[0, 13], [1, 13], [0, 14], [1, 14]], rot: -Math.PI / 2 },
      { model: 'mountains', cells: [[6, 0], [7, 0], [8, 0], [6, 1], [7, 1], [8, 1]] },
    ],
    decor: { rate: 0.45, sets: [['tree-fir', 'tree-conifer', 'tree-spruce', 'tree-forest', 'tree-birch'], ['deer', 'bear', 'wolf', 'rock-sharp', 'stone-round']], weights: [0.85, 0.15] },
    roads: [[0, 7, 15, 7, 'h'], [8, 3, 8, 12, 'v']],
    windmill: [6, 6],
    mod: { mountain: { r: 2, v: 8 }, windMul: 1.5 },
  },
  {
    id: 'desert', ic: '🏜️', nm: '黃沙荒漠', diff: '★★★', money: 6500,
    desc: '炎熱乾燥的沙漠，只有仙人掌與風滾草。金字塔遺跡帶來觀光客。',
    rules: ['🥵 缺水酷熱：所有建築滿意度 -12，公園 3 格內可抵消', '☀️ 日照充足：太陽能發電 +60%，且一開始就能建造', '🔺 金字塔觀光：附近滿意度 +10'],
    sky: '#f3d9a4', sea: '#c9a66b', sand: '#dcb978',
    terrain: () => null,
    features: [
      { model: 'pyramid', cells: [[11, 2], [12, 2], [11, 3], [12, 3]], landmark: 10 },
      { model: 'mountain-desert', cells: [[1, 1], [2, 1], [1, 2], [2, 2]] },
      { model: 'mountain-desert', cells: [[12, 12], [13, 12], [12, 13], [13, 13]], rot: Math.PI },
    ],
    decor: { rate: 0.3, sets: [['cactus-basic', 'cactus-big', 'cactus-medium', 'cactus-basic'], ['rock-pillar', 'rock-sharp', 'stone-flat', 'rocks-small'], ['tree-dry', 'tree-dead', 'tumbleweed']], weights: [0.55, 0.3, 0.15] },
    roads: [[1, 8, 14, 8, 'h'], [6, 4, 6, 12, 'v']],
    windmill: [4, 7],
    tumbleweeds: 8,
    mod: { dry: { v: 12, r: 3 }, solarMul: 1.6, solarFree: true },
  },
  {
    id: 'oasis', ic: '🌴', nm: '沙漠綠洲', diff: '★★☆', money: 5500,
    desc: '沙漠中央的一汪清泉，棕櫚樹環繞。越靠近水源越宜居，越遠越荒涼。',
    rules: ['💧 綠洲水源：距水 3 格內滿意度 +16', '🏜️ 遠離水源（6 格外）滿意度 -10', '☀️ 太陽能發電 +30%'],
    sky: '#f0dcae', sea: '#c9a66b', sand: '#dcb978',
    terrain(i, j) { return dist(i, j, 7.5, 7.2) < 2.1 + Math.sin(i * 2 + j) * 0.35 ? 'water' : null; },
    features: [],
    decor: {
      rate: 0.32, sets: [['palm', 'palm-big', 'palm-round', 'palm-angle'], ['cactus-basic', 'cactus-big', 'cactus-medium', 'tumbleweed', 'rocks-small']], weights: [1, 0],
      pick: (i, j) => dist(i, j, 7.5, 7.2) < 4.5 ? 0 : 1,
    },
    roads: [[3, 3, 12, 3, 'h'], [12, 3, 12, 12, 'v'], [3, 3, 3, 11, 'v']],
    windmill: [4, 2],
    mod: { water: { r: 3, v: 16 }, far: { r: 6, v: 10 }, solarMul: 1.3, solarFree: true },
  },
];
const MAP = id => MAPS.find(m => m.id === id) || MAPS[0];

// ───────────────────────── 場景 ─────────────────────────
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY_DAY = new THREE.Color('#9fd3f0'), SKY_NIGHT = new THREE.Color('#1b2440'), SKY_DUSK = new THREE.Color('#f2a36b');
scene.background = SKY_DAY.clone();
scene.fog = new THREE.Fog(scene.background, 700, 1400);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 3000);
camera.position.set(260, 300, 330);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = 1.25;
controls.minDistance = 60;
controls.maxDistance = 900;
controls.screenSpacePanning = false;

const hemi = new THREE.HemisphereLight('#dff1ff', '#5b6a3a', 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2dd', 2.2);
sun.position.set(220, 380, 160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = sc.bottom = -320; sc.right = sc.top = 320; sc.near = 10; sc.far = 1200;
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
scene.add(sun);

// 底座下方的海面
const sea = new THREE.Mesh(new THREE.CircleGeometry(1600, 48), new THREE.MeshStandardMaterial({ color: '#4fa7c9', roughness: 0.4 }));
sea.rotation.x = -Math.PI / 2; sea.position.y = -9; sea.receiveShadow = true;
scene.add(sea);

const world = new THREE.Group(); scene.add(world);
const agentsGroup = new THREE.Group(); scene.add(agentsGroup);

// ───────────────────────── 模型 ─────────────────────────
const protos = {};
function getProto(name) { return protos[name]; }
function make(name) {
  const p = protos[name];
  if (!p) { console.warn('missing model', name); return new THREE.Group(); }
  const g = new THREE.Group();
  g.add(p.clone(true));
  return g;
}
function fitScale(name, target = 24, max = 1.7) {
  const s = protos[name]?.userData.size; if (!s) return 1;
  return Math.min(max, target / Math.max(s.x, s.z));
}

// ───────────────────────── 狀態 ─────────────────────────
let S; // 遊戲狀態（可存檔）
let grid = []; // 每格：{type, level, mask, built(0~1), obj, trees}
const cellCenter = (i, j) => new THREE.Vector3((i - N / 2 + 0.5) * T, 0, (j - N / 2 + 0.5) * T);
const inside = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
const C = (i, j) => inside(i, j) ? grid[j * N + i] : null;
let stats = { pop: 0, jobsC: 0, jobsI: 0, powerUse: 0, powerSup: 0, hap: 50, dR: 0, dC: 0, dI: 0, income: 0 };
let hapMap = new Float32Array(N * N);
let speed = 1, tool = 'select', dayAcc = 0;

let M = MAPS[0]; // 目前地圖
function newState(mapId = 'grass') {
  const m = MAP(mapId);
  return { map: m.id, money: m.money, day: 1, tax: 9, goal: 0, cells: [], seed: Math.floor(Math.random() * 1e9) };
}

// ───────────────────────── 建立格子 ─────────────────────────
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const tintCache = new Map();
function tintMat(m) {
  if (!M.sand || !/GREEN/i.test(m.name)) return m;
  const key = m.uuid + M.sand;
  if (!tintCache.has(key)) {
    const c = m.clone();
    const sand = new THREE.Color(M.sand);
    if (/DARK/i.test(m.name)) sand.multiplyScalar(0.85);
    c.color = sand; tintCache.set(key, c);
  }
  return tintCache.get(key);
}

function buildBoard() {
  world.clear();
  grid = [];
  const rand = rng(S.seed);
  scene.background.set(M.sky); SKY_DAY.set(M.sky);
  sea.material.color.set(M.sea);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cell = { i, j, type: 'empty', level: 0, built: 1, obj: null, base: null, trees: null, powered: true, road: false, hap: 50 };
    grid.push(cell);
    const t = M.terrain(i, j);
    if (t === 'water') { cell.type = 'water'; setBase(cell, 'tile-water', 0); continue; }
    setBase(cell, 'tile-plain', 0);
    if (t === 'hill') {
      cell.type = 'hill'; setBase(cell, 'tile-hill', Math.floor(rand() * 4) * Math.PI / 2);
      cell.base.position.y = 6; // tile-hill 比一般地塊高 6m，原點在山頂
      continue;
    }
  }
  // 大型地形／地標（跨多格）
  for (const f of M.features) {
    const cs = f.cells.map(([i, j]) => C(i, j));
    const cx = cs.reduce((s, c) => s + cellCenter(c.i, c.j).x, 0) / cs.length;
    const cz = cs.reduce((s, c) => s + cellCenter(c.i, c.j).z, 0) / cs.length;
    const w = (Math.max(...f.cells.map(c => c[0])) - Math.min(...f.cells.map(c => c[0])) + 1) * T;
    const d = (Math.max(...f.cells.map(c => c[1])) - Math.min(...f.cells.map(c => c[1])) + 1) * T;
    const g = make(f.model);
    const sz = protos[f.model]?.userData.size;
    if (f.scale) g.scale.setScalar(f.scale);
    else if (sz) {
      const rotated = Math.abs(Math.sin(f.rot || 0)) > 0.5;
      const sx = rotated ? sz.z : sz.x, sz2 = rotated ? sz.x : sz.z;
      g.scale.setScalar(Math.min(w / sx, d / sz2) * 0.98);
    }
    g.rotation.y = f.rot || 0;
    g.position.set(cx, 0, cz);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (M.sand && f.model.startsWith('terrain')) o.material = Array.isArray(o.material) ? o.material.map(tintMat) : tintMat(o.material); } });
    world.add(g);
    for (const c of cs) { c.type = f.landmark ? 'landmark' : 'mountain'; c.feature = f; }
  }
  for (const c of grid) if (c.type === 'empty' && rand() < M.decor.rate) addTrees(c, rand);
  computeTerrainDist();
}
const tDist = { water: new Float32Array(N * N), mountain: new Float32Array(N * N), landmark: new Float32Array(N * N), landmarkV: 0 };
function computeTerrainDist() {
  const calc = (arr, pred) => { const src = grid.filter(pred); for (const c of grid) arr[c.j * N + c.i] = src.length ? Math.min(...src.map(o => Math.max(Math.abs(o.i - c.i), Math.abs(o.j - c.j)))) : 99; };
  calc(tDist.water, c => c.type === 'water');
  calc(tDist.mountain, c => c.type === 'mountain' || c.type === 'hill');
  calc(tDist.landmark, c => c.type === 'landmark');
  tDist.landmarkV = M.features.find(f => f.landmark)?.landmark || 0;
}

function setBase(cell, name, rotY) {
  if (cell.base) world.remove(cell.base);
  const b = make(name);
  b.position.copy(cellCenter(cell.i, cell.j));
  b.rotation.y = rotY;
  b.traverse(o => { if (o.isMesh) { o.receiveShadow = true; if (name !== 'tile-park') o.material = Array.isArray(o.material) ? o.material.map(tintMat) : tintMat(o.material); } });
  b.userData.cell = cell;
  world.add(b); cell.base = b;
}

function pickWeighted(ws, r) { let s = 0; for (let k = 0; k < ws.length; k++) { s += ws[k]; if (r < s) return k; } return ws.length - 1; }
function addTrees(cell, rand = Math.random, density = 1) {
  const g = new THREE.Group();
  const D = M.decor;
  const setIdx = D.pick ? D.pick(cell.i, cell.j) : pickWeighted(D.weights, rand());
  const set = D.sets[setIdx];
  const n = Math.max(1, Math.round((2 + Math.floor(rand() * 4)) * density));
  for (let k = 0; k < n; k++) {
    const name = set[Math.floor(rand() * set.length)];
    const t = make(name);
    t.position.set((rand() - .5) * 22, 0, (rand() - .5) * 22);
    t.rotation.y = rand() * 6.28;
    t.scale.setScalar(1.3 + rand() * 0.9);
    t.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.add(t);
  }
  g.position.copy(cellCenter(cell.i, cell.j));
  world.add(g); cell.trees = g;
}
function clearTrees(cell) { if (cell.trees) { world.remove(cell.trees); cell.trees = null; } }

// ───────────────────────── 道路 ─────────────────────────
function roadMask(i, j) {
  let m = 0;
  DIRS.forEach(([dx, dz], k) => { const n = C(i + dx, j + dz); if (n && n.type === 'road') m |= BIT[k]; });
  return m;
}
// 繞 Y 軸 +90°：E→N, S→E, W→S, N→W
function rotMask(m, q) { for (let k = 0; k < q; k++) { let r = 0; if (m & 2) r |= 1; if (m & 4) r |= 2; if (m & 8) r |= 4; if (m & 1) r |= 8; m = r; } return m; }
function pickRoad(mask) {
  if (mask === 0) return ['tile-road-straight', 0];
  if (mask === 1 || mask === 4 || mask === 2 || mask === 8) {
    for (let q = 0; q < 4; q++) if (rotMask(4, q) === mask) return ['tile-road-end', q * Math.PI / 2];
  }
  for (const [name, base] of ROAD_PIECES) for (let q = 0; q < 4; q++) if (rotMask(base, q) === mask) return [name, q * Math.PI / 2];
  return ['tile-road-intersection', 0];
}
function refreshRoad(cell) {
  if (cell.type !== 'road') return;
  const m = roadMask(cell.i, cell.j);
  if (m === cell.mask && cell.base) return;
  cell.mask = m;
  const [name, rot] = pickRoad(m);
  setBase(cell, name, rot);
}
function refreshAround(i, j) {
  for (const [dx, dz] of [[0, 0], ...DIRS]) { const c = C(i + dx, j + dz); if (c) { if (c.type === 'road') refreshRoad(c); else if (c.obj && c.type !== 'empty') orientBuilding(c); } }
}

// ───────────────────────── 建築 ─────────────────────────
function roadDir(cell) { // 回傳鄰接道路的方向 index（優先南、東、西、北）
  for (const k of [2, 1, 3, 0]) { const n = C(cell.i + DIRS[k][0], cell.j + DIRS[k][1]); if (n && n.type === 'road') return k; }
  return -1;
}
// 建築正面朝 +Z（南）；旋轉使正面朝向道路
const FACE_ROT = { 2: 0, 1: Math.PI / 2, 0: Math.PI, 3: -Math.PI / 2 };
function orientBuilding(cell) {
  const k = roadDir(cell);
  cell.road = k >= 0;
  if (cell.obj && k >= 0 && !cell.obj.userData.fixedRot) cell.obj.rotation.y = FACE_ROT[k];
}

function modelFor(cell) {
  const t = cell.type;
  if (ZONE[t]) return ZONE[t].levels[cell.level];
  return TOOL[t]?.model;
}

function placeObject(cell, animate = true) {
  if (cell.obj) { world.remove(cell.obj); cell.obj = null; }
  const t = cell.type;
  let g;
  if (t === 'park') {
    g = new THREE.Group();
    const f = make('fountain'); f.scale.setScalar(1.6); g.add(f);
    const pos = [[-9, -9], [9, 9], [-9, 9], [9, -9]];
    pos.forEach(([x, z], k) => { const tr = make(k % 2 ? 'tree-lime' : 'tree-round'); tr.position.set(x, 0, z); tr.scale.setScalar(1.6); g.add(tr); });
    [[0, 9.5, 0], [0, -9.5, Math.PI]].forEach(([x, z, r]) => { const b = make('bench-wood'); b.position.set(x, 0, z); b.rotation.y = r; b.scale.setScalar(1.5); g.add(b); });
    g.userData.fixedRot = true;
  } else if (t === 'solar') {
    g = new THREE.Group();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const p = make('solar-panel'); p.position.set(a * 8, 0, b * 7.5); p.scale.setScalar(2.2); g.add(p); }
    g.userData.fixedRot = true;
  } else if (t === 'power') {
    g = make('windmill'); g.scale.setScalar(1.5);
    g.userData.prop = g.getObjectByName('windmill-propeller');
  } else {
    const name = modelFor(cell);
    g = make(name);
    g.scale.setScalar(fitScale(name, 25, 1.6));
  }
  g.position.copy(cellCenter(cell.i, cell.j));
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.baseScale = g.scale.x;
  g.userData.cell = cell;
  world.add(g); cell.obj = g;
  orientBuilding(cell);
  if (animate) { cell.anim = 0; g.scale.y = 0.001; spawnDust(cell); }
}

function addCrane(cell) {
  const g = new THREE.Group();
  const cr = make('crane-crawler'); cr.position.set(-9, 0, 6); cr.rotation.y = 0.6; cr.scale.setScalar(1.3); g.add(cr);
  for (const [x, z] of [[-12, 12], [12, 12], [12, -12], [-12, -12]]) { const c = make('traffic-cone'); c.position.set(x, 0, z); c.scale.setScalar(2); g.add(c); }
  g.position.copy(cellCenter(cell.i, cell.j));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  world.add(g); cell.crane = g;
}
function removeCrane(cell) { if (cell.crane) { world.remove(cell.crane); cell.crane = null; } }

// 簡單粒子：煙塵
const dustGeo = new THREE.SphereGeometry(1, 6, 5);
const dustMat = new THREE.MeshStandardMaterial({ color: '#d9cdb6', transparent: true, opacity: .8, roughness: 1 });
const dusts = [];
function spawnDust(cell) {
  const c = cellCenter(cell.i, cell.j);
  for (let k = 0; k < 10; k++) {
    const m = new THREE.Mesh(dustGeo, dustMat.clone());
    m.position.set(c.x + (Math.random() - .5) * 20, 1, c.z + (Math.random() - .5) * 20);
    m.userData.v = new THREE.Vector3((Math.random() - .5) * 8, 6 + Math.random() * 6, (Math.random() - .5) * 8);
    m.userData.life = 1;
    scene.add(m); dusts.push(m);
  }
}

// ───────────────────────── 操作 ─────────────────────────
function canAfford(c) { if (S.money >= c) return true; toast('資金不足！', 'bad'); return false; }

function apply(cell, t, silent = false) {
  if (!cell) return false;
  const def = TOOL[t];
  if (t === 'select') { showInfo(cell); return false; }
  if (TERRAIN.has(cell.type)) { if (!silent) toast(cell.type === 'water' ? '🌊 水面上無法建造' : cell.type === 'landmark' ? '🔺 古蹟受保護，無法建造' : '⛰️ 山地無法建造', 'bad'); return false; }
  if (t === 'bulldoze') {
    if (cell.type === 'empty' && !cell.trees) return false;
    if (!canAfford(def.cost)) return false;
    S.money -= def.cost;
    clearCell(cell); refreshAround(cell.i, cell.j);
    spawnDust(cell);
    return true;
  }
  if (def.unlock && stats.pop < def.unlock && !(t === 'solar' && M.mod.solarFree)) { if (!silent) toast(`需要人口 ${def.unlock} 才能解鎖「${def.nm}」`, 'bad'); return false; }
  if (cell.type !== 'empty') { if (!silent && cell.type !== t) toast('這裡已經有東西了，先拆除吧', 'bad'); return false; }
  if (!canAfford(def.cost)) return false;
  S.money -= def.cost;
  clearTrees(cell);
  cell.type = t; cell.level = 0;
  if (t === 'road') {
    cell.mask = -1; refreshAround(cell.i, cell.j);
  } else {
    if (t === 'park') setBase(cell, 'tile-park', 0);
    cell.built = 0;
    addCrane(cell);
    if (roadDir(cell) < 0 && t !== 'park' && !silent) toast('提示：建築需要連接道路才能運作', '');
  }
  return true;
}

function clearCell(cell) {
  if (cell.obj) world.remove(cell.obj);
  removeCrane(cell); clearTrees(cell);
  cell.obj = null; cell.type = 'empty'; cell.level = 0; cell.built = 1; cell.mask = undefined;
  setBase(cell, 'tile-plain', 0);
}

// ───────────────────────── 模擬 ─────────────────────────
function simulateDay() {
  // 電力
  let sup = 0, use = 0;
  const buildings = grid.filter(c => c.type !== 'empty' && c.type !== 'road' && !TERRAIN.has(c.type) && c.built >= 1);
  for (const c of buildings) {
    c.road = roadDir(c) >= 0;
    const d = TOOL[c.type];
    if ((c.type === 'power' || c.type === 'solar') && c.road) sup += Math.round(d.power * ((c.type === 'power' ? M.mod.windMul : M.mod.solarMul) || 1));
  }
  const consumers = buildings.filter(c => ZONE[c.type] || (TOOL[c.type].power < 0));
  for (const c of consumers) {
    const need = ZONE[c.type] ? (c.level + 1) * (c.type === 'ind' ? 3 : c.type === 'com' ? 2 : 1) : -TOOL[c.type].power;
    c.need = need;
    if (c.road && use + need <= sup) { use += need; c.powered = true; } else c.powered = false;
  }

  // 覆蓋範圍與滿意度
  const cover = { park: new Float32Array(N * N), police: new Uint8Array(N * N), fire: new Uint8Array(N * N), school: new Uint8Array(N * N), hospital: new Uint8Array(N * N), poll: new Float32Array(N * N) };
  const stamp = (c, r, f) => { for (let j = c.j - r; j <= c.j + r; j++) for (let i = c.i - r; i <= c.i + r; i++) if (inside(i, j)) f(j * N + i, Math.max(Math.abs(i - c.i), Math.abs(j - c.j))); };
  for (const c of buildings) {
    if (c.type === 'park') stamp(c, 3, (k, d) => cover.park[k] += d <= 1 ? 12 : 6);
    else if (cover[c.type] && c.powered && c.road) stamp(c, TOOL[c.type].radius, k => cover[c.type][k] = 1);
    else if (c.type === 'ind' && c.powered) stamp(c, 3, (k, d) => cover.poll[k] += (c.level + 1) * (d <= 1 ? 6 : 3));
  }
  let pop = 0, jobsC = 0, jobsI = 0;
  for (const c of grid) if (ZONE[c.type] && c.built >= 1 && c.road && c.powered) {
    const v = ZONE[c.type].val[c.level];
    if (c.type === 'res') pop += v; else if (c.type === 'com') jobsC += v; else jobsI += v;
  }
  const workers = pop * 0.55, jobs = jobsC + jobsI;
  const unemp = workers > 0 ? Math.max(0, workers - jobs) / workers : 0;
  const bigCity = Math.min(1, pop / 300); // 城市越大越在意公共服務
  let hapSum = 0, hapW = 0;
  for (let k = 0; k < N * N; k++) {
    const c = grid[k];
    let h = 55 + Math.min(24, cover.park[k]) - Math.min(36, cover.poll[k]) - (S.tax - 9) * 2.5 - unemp * 25;
    h += cover.police[k] ? 8 : -8 * bigCity;
    h += cover.fire[k] ? 6 : -6 * bigCity;
    h += cover.school[k] ? 8 : -5 * bigCity;
    h += cover.hospital[k] ? 8 : -5 * bigCity;
    for (const [dx, dz] of DIRS) { const n = C(c.i + dx, c.j + dz); if (n && n.trees) h += 2; }
    if (ZONE[c.type] && !c.powered) h -= 25;
    const mod = M.mod;
    if (mod.treeBonus) for (const [dx, dz] of DIRS) { const n = C(c.i + dx, c.j + dz); if (n && n.trees) h += mod.treeBonus; }
    if (mod.water && tDist.water[k] <= mod.water.r) h += mod.water.v;
    if (mod.far && tDist.water[k] > mod.far.r) h -= mod.far.v;
    if (mod.mountain && tDist.mountain[k] <= mod.mountain.r) h += mod.mountain.v;
    if (mod.dry && !cover.park[k]) h -= mod.dry.v;
    if (tDist.landmark[k] <= 3) h += tDist.landmarkV;
    h = Math.max(0, Math.min(100, h));
    hapMap[k] = h; c.hap = h;
    if (c.type === 'res' && c.built >= 1) { const w = ZONE.res.val[c.level]; hapSum += h * w; hapW += w; }
  }
  const hap = hapW ? hapSum / hapW : 55;

  const cl = v => Math.max(-1, Math.min(1, v));
  const dR = cl((jobs - workers + 16 + (hap - 50) * 0.6 - (S.tax - 9) * 3) / 40);
  const dC = cl((pop * 0.32 - jobsC + 6) / 30);
  const dI = cl((pop * 0.30 - jobsI + 12) / 30);
  const D = { res: dR, com: dC, ind: dI };

  // 成長／衰退
  for (const c of grid) {
    if (!ZONE[c.type] || c.built < 1 || !c.road || !c.powered) continue;
    const z = ZONE[c.type];
    const need = 38 + c.level * 9;
    if (D[c.type] > 0.05 && c.hap >= need && c.level < z.levels.length - 1) {
      if (c.type === 'com' && c.level === 4 && pop < 500) continue; // 摩天大樓需要人口 500
      if (Math.random() < 0.05 + D[c.type] * 0.08) { c.level++; placeObject(c); }
    } else if ((c.hap < 22 || D[c.type] < -0.6) && c.level > 0 && Math.random() < 0.03) {
      c.level--; placeObject(c);
    }
  }

  // 財政
  const roads = grid.filter(c => c.type === 'road').length;
  let upkeep = roads * 0.15;
  for (const c of buildings) if (TOOL[c.type]?.upkeep) upkeep += TOOL[c.type].upkeep;
  const filledC = Math.min(jobsC, workers), filledI = Math.min(jobsI, Math.max(0, workers - filledC));
  const income = S.tax / 100 * (pop * 4 + filledC * 3.2 + filledI * 2.6) - upkeep;
  S.money += income;
  S.day++;
  stats = { pop, jobsC, jobsI, powerUse: use, powerSup: sup, hap, dR, dC, dI, income };

  // 目標
  if (S.goal < GOALS.length && pop >= GOALS[S.goal]) {
    const g = GOALS[S.goal]; S.goal++;
    const bonus = g * 5; S.money += bonus;
    const unlocked = TOOLS.filter(t => t.unlock && t.unlock <= pop && t.unlock > (GOALS[S.goal - 2] ?? 0)).map(t => t.nm);
    toast(`🎉 人口達到 ${g}！獎勵 $${bonus}${unlocked.length ? '，解鎖：' + unlocked.join('、') : ''}`, 'good');
  }
  if (S.money < -2000) toast('⚠️ 財政赤字嚴重！調整稅率或減少支出', 'bad');
  if (S.day % 30 === 0) save(true);
  updateHUD();
}

// ───────────────────────── 交通：車輛與行人 ─────────────────────────
const CARS = ['car-passenger', 'car-taxi', 'car-police', 'car-passenger', 'car-taxi', 'car-truck-dump'];
const PEOPLE = ['man-casual', 'woman-casual', 'woman-casual-pants', 'man-tie'];
const agents = [];
function roadNeighbors(i, j) { const r = []; DIRS.forEach(([dx, dz], k) => { const n = C(i + dx, j + dz); if (n && n.type === 'road') r.push(k); }); return r; }
function spawnAgent(kind) {
  const roads = grid.filter(c => c.type === 'road' && roadNeighbors(c.i, c.j).length);
  if (!roads.length) return;
  const c = roads[Math.floor(Math.random() * roads.length)];
  const ns = roadNeighbors(c.i, c.j);
  const dir = ns[Math.floor(Math.random() * ns.length)];
  const name = kind === 'car' ? CARS[Math.floor(Math.random() * CARS.length)] : PEOPLE[Math.floor(Math.random() * PEOPLE.length)];
  const mesh = make(name);
  if (kind === 'car') mesh.scale.setScalar(1.25); else mesh.scale.setScalar(1.6);
  mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
  agentsGroup.add(mesh);
  const a = { kind, mesh, i: c.i, j: c.j, inDir: dir, outDir: dir, t: Math.random(), speed: kind === 'car' ? 0.9 + Math.random() * 0.5 : 0.18 + Math.random() * 0.08, lane: kind === 'car' ? 3.4 : 11.5, side: kind === 'car' ? 1 : (Math.random() < .5 ? 1 : -1) };
  chooseNext(a, true);
  agents.push(a);
}
function chooseNext(a, first) {
  const ns = roadNeighbors(a.i, a.j);
  const back = (a.inDir + 2) % 4;
  let opts = ns.filter(k => k !== back);
  if (!opts.length) opts = ns.length ? ns : [back];
  if (first && ns.includes(a.inDir)) { a.outDir = a.inDir; return; }
  a.outDir = opts[Math.floor(Math.random() * opts.length)];
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
function lanePoint(out, i, j, edgeDir, travelDir, lane) {
  const c = cellCenter(i, j);
  const [ex, ez] = DIRS[edgeDir]; const [dx, dz] = DIRS[travelDir];
  out.set(c.x + ex * T / 2 + (-dz) * lane, 0, c.z + ez * T / 2 + dx * lane);
  return out;
}
function updateAgents(dt) {
  for (let n = agents.length - 1; n >= 0; n--) {
    const a = agents[n];
    const cell = C(a.i, a.j);
    if (!cell || cell.type !== 'road') { agentsGroup.remove(a.mesh); agents.splice(n, 1); continue; }
    a.t += dt * a.speed * (speed || 0) * (a.kind === 'car' ? 1 : 1);
    if (a.t >= 1) {
      const [dx, dz] = DIRS[a.outDir];
      const nx = C(a.i + dx, a.j + dz);
      if (nx && nx.type === 'road') { a.i += dx; a.j += dz; a.inDir = a.outDir; }
      else { a.inDir = a.outDir; }
      a.t -= 1; chooseNext(a);
    }
    const lane = a.lane * a.side;
    // 入口（來向的相反邊）、出口、控制點
    const entryEdge = (a.inDir + 2) % 4;
    lanePoint(tmpA, a.i, a.j, entryEdge, a.inDir, lane);
    lanePoint(tmpB, a.i, a.j, a.outDir, a.outDir, lane);
    const c = cellCenter(a.i, a.j);
    const [ix, iz] = DIRS[a.inDir], [ox, oz] = DIRS[a.outDir];
    tmpC.set(c.x + (-iz) * lane + (-oz) * lane, 0, c.z + ix * lane + ox * lane);
    if (a.inDir === a.outDir) tmpC.lerpVectors(tmpA, tmpB, .5);
    if (a.outDir === (a.inDir + 2) % 4) tmpC.set(c.x, 0, c.z);
    const t = a.t, u = 1 - t;
    const p = a.mesh.position;
    const px = u * u * tmpA.x + 2 * u * t * tmpC.x + t * t * tmpB.x;
    const pz = u * u * tmpA.z + 2 * u * t * tmpC.z + t * t * tmpB.z;
    const tx = 2 * u * (tmpC.x - tmpA.x) + 2 * t * (tmpB.x - tmpC.x);
    const tz = 2 * u * (tmpC.z - tmpA.z) + 2 * t * (tmpB.z - tmpC.z);
    p.set(px, a.kind === 'man' ? Math.abs(Math.sin(a.t * 40)) * 0.25 : 0, pz);
    if (tx * tx + tz * tz > 1e-6) a.mesh.rotation.y = Math.atan2(tx, tz);
  }
}
function balanceAgents() {
  const roads = grid.filter(c => c.type === 'road').length;
  const wantCars = Math.min(45, Math.floor(roads / 3), Math.floor(stats.pop / 14) + (roads > 3 ? 2 : 0));
  const wantPeople = Math.min(40, Math.floor(stats.pop / 12));
  const cars = agents.filter(a => a.kind === 'car').length, ppl = agents.length - cars;
  if (cars < wantCars) spawnAgent('car');
  else if (cars > wantCars + 2) { const k = agents.findIndex(a => a.kind === 'car'); agentsGroup.remove(agents[k].mesh); agents.splice(k, 1); }
  if (ppl < wantPeople) spawnAgent('man');
  else if (ppl > wantPeople + 2) { const k = agents.findIndex(a => a.kind !== 'car'); agentsGroup.remove(agents[k].mesh); agents.splice(k, 1); }
}

// ───────────────────────── 地圖特效：船、海鷗、風滾草 ─────────────────────────
const fxGroup = new THREE.Group(); scene.add(fxGroup);
const fx = [];
function setupFx() {
  fxGroup.clear(); fx.length = 0;
  const water = grid.filter(c => c.type === 'water');
  const nb = M.boats || 0;
  for (let k = 0; k < nb && water.length > 3; k++) {
    const m = make(['boat-sail', 'boat-fishing', 'boat-speed', 'boat-sail', 'boat-speed'][k % 5]);
    m.scale.setScalar(m.children[0] && k % 5 === 2 ? 1.4 : 0.9);
    m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const c = water[Math.floor(Math.random() * water.length)];
    m.position.copy(cellCenter(c.i, c.j)); m.position.y = -1.5;
    fxGroup.add(m);
    fx.push({ kind: 'boat', m, target: null, sp: 5 + Math.random() * 6, water });
  }
  if (nb) for (let k = 0; k < 6; k++) {
    const m = make('seagull'); m.scale.setScalar(3); fxGroup.add(m);
    const c = water[Math.floor(Math.random() * water.length)];
    fx.push({ kind: 'gull', m, cx: cellCenter(c.i, c.j).x, cz: cellCenter(c.i, c.j).z, r: 20 + Math.random() * 40, a: Math.random() * 6.28, h: 30 + Math.random() * 25, sp: 0.4 + Math.random() * 0.3 });
  }
  for (let k = 0; k < (M.tumbleweeds || 0); k++) {
    const m = make('tumbleweed'); m.scale.setScalar(2.5); fxGroup.add(m);
    m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    m.position.set((Math.random() - .5) * N * T, 0, (Math.random() - .5) * N * T);
    fx.push({ kind: 'weed', m, sp: 8 + Math.random() * 10, ph: Math.random() * 6 });
  }
}
function updateFx(dt) {
  const half = N * T / 2;
  for (const f of fx) {
    if (f.kind === 'boat') {
      if (!f.target || f.m.position.distanceTo(f.target) < 4) { const c = f.water[Math.floor(Math.random() * f.water.length)]; f.target = cellCenter(c.i, c.j).add(new THREE.Vector3((Math.random() - .5) * 16, -1.5, (Math.random() - .5) * 16)); }
      const d = f.target.clone().sub(f.m.position); d.y = 0;
      const want = Math.atan2(d.x, d.z);
      let diff = want - f.m.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      f.m.rotation.y += diff * Math.min(1, dt * 1.2);
      f.m.position.x += Math.sin(f.m.rotation.y) * f.sp * dt;
      f.m.position.z += Math.cos(f.m.rotation.y) * f.sp * dt;
      f.m.position.y = -1.5 + Math.sin(performance.now() / 600 + f.sp) * 0.3;
    } else if (f.kind === 'gull') {
      f.a += dt * f.sp;
      f.m.position.set(f.cx + Math.cos(f.a) * f.r, f.h + Math.sin(f.a * 3) * 2, f.cz + Math.sin(f.a) * f.r);
      f.m.rotation.y = -f.a; f.m.rotation.z = Math.sin(f.a * 6) * 0.3;
    } else if (f.kind === 'weed') {
      f.ph += dt;
      f.m.position.x += f.sp * dt; f.m.position.z += Math.sin(f.ph * 0.7) * 3 * dt;
      f.m.position.y = Math.abs(Math.sin(f.ph * 4)) * 2.5;
      f.m.rotation.z -= dt * f.sp * 0.4;
      if (f.m.position.x > half) { f.m.position.x = -half; f.m.position.z = (Math.random() - .5) * N * T; }
    }
  }
}

// ───────────────────────── 滑鼠／觸控 ─────────────────────────
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hover = new THREE.Mesh(new THREE.BoxGeometry(T, 1.2, T), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .28, depthWrite: false }));
hover.visible = false; scene.add(hover);
const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6; ring.visible = false; scene.add(ring);

function cellFromEvent(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, p)) return null;
  const i = Math.floor(p.x / T + N / 2), j = Math.floor(p.z / T + N / 2);
  return C(i, j);
}
let painting = false, lastCell = null, downPos = null;
const el = renderer.domElement;
el.addEventListener('contextmenu', e => e.preventDefault());
el.addEventListener('pointerdown', e => {
  if (e.button !== 0 || tool === 'select') { downPos = [e.clientX, e.clientY]; return; }
  painting = true; lastCell = null;
  const c = cellFromEvent(e); if (c) { apply(c, tool); lastCell = c; updateHUD(); }
});
el.addEventListener('pointermove', e => {
  const c = cellFromEvent(e);
  updateHover(c);
  if (painting && c && c !== lastCell && (tool === 'road' || tool === 'bulldoze' || ZONE[tool])) {
    // 沿直線補齊中間的格子
    if (lastCell) {
      let { i, j } = lastCell;
      while (i !== c.i || j !== c.j) {
        if (i !== c.i) i += Math.sign(c.i - i); else j += Math.sign(c.j - j);
        apply(C(i, j), tool, true);
      }
    } else apply(c, tool, true);
    lastCell = c; updateHUD();
  }
});
addEventListener('pointerup', e => {
  if (downPos && tool === 'select' && e.target === el && Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) < 6) {
    const c = cellFromEvent(e); if (c) showInfo(c);
  }
  painting = false; downPos = null;
});
function updateHover(c) {
  if (!c) { hover.visible = false; ring.visible = false; return; }
  hover.visible = true;
  hover.position.copy(cellCenter(c.i, c.j)); hover.position.y = 0.6;
  const ok = tool === 'select' || tool === 'bulldoze' ? true : c.type === 'empty';
  hover.material.color.set(tool === 'bulldoze' ? '#ff5a5a' : ok ? '#ffffff' : '#ff5a5a');
  const r = TOOL[tool]?.radius || (tool === 'park' ? 3 : tool === 'ind' ? 3 : 0);
  ring.visible = !!r;
  if (r) { ring.position.x = hover.position.x; ring.position.z = hover.position.z; ring.scale.setScalar((r + 0.5) * T); }
}

function setControls() {
  const pan = tool === 'select';
  controls.mouseButtons = { LEFT: pan ? THREE.MOUSE.PAN : null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: pan ? THREE.TOUCH.PAN : null, TWO: THREE.TOUCH.DOLLY_ROTATE };
}

// ───────────────────────── UI ─────────────────────────
const $ = id => document.getElementById(id);
const tb = $('toolbar');
for (const t of TOOLS) {
  if (t.sep) { const s = document.createElement('div'); s.className = 'sep'; tb.appendChild(s); continue; }
  const b = document.createElement('button');
  b.className = 'tool'; b.dataset.tool = t.id;
  b.innerHTML = `<span class="ic">${t.ic}</span><span class="nm">${t.nm}</span><span class="ct">${t.cost ? '$' + t.cost : '&nbsp;'}</span>`;
  b.title = t.unlock ? `人口 ${t.unlock} 解鎖` : t.nm;
  b.onclick = () => selectTool(t.id);
  tb.appendChild(b);
}
function selectTool(id) {
  tool = id;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  setControls();
  if (id !== 'select') $('info').classList.add('hidden');
}
document.querySelectorAll('.speed button').forEach(b => b.onclick = () => {
  speed = +b.dataset.speed;
  document.querySelectorAll('.speed button').forEach(x => x.classList.toggle('on', x === b));
});
$('tax').oninput = e => { S.tax = +e.target.value; $('taxv').textContent = S.tax + '%'; };
addEventListener('keydown', e => {
  if (e.key === ' ') { e.preventDefault(); const b = document.querySelector(`.speed button[data-speed="${speed ? 0 : 1}"]`); b.click(); }
  if (e.key === 'Escape') selectTool('select');
  const idx = '1234567890'.indexOf(e.key); const ids = TOOLS.filter(t => t.id).map(t => t.id);
  if (idx >= 0 && ids[idx]) selectTool(ids[idx]);
});

const fmt = n => Math.round(n).toLocaleString('en-US');
function updateHUD() {
  $('s-money').textContent = '$' + fmt(S.money);
  const d = $('s-delta'); d.textContent = (stats.income >= 0 ? '+' : '') + fmt(stats.income) + '/天'; d.classList.toggle('neg', stats.income < 0);
  $('s-pop').textContent = fmt(stats.pop);
  $('s-jobs').textContent = fmt(stats.jobsC + stats.jobsI);
  $('s-hap').textContent = Math.round(stats.hap) + '%';
  $('s-hapicon').textContent = stats.hap > 70 ? '😄' : stats.hap > 45 ? '🙂' : stats.hap > 25 ? '😐' : '😠';
  $('s-power').textContent = `${stats.powerUse}/${stats.powerSup}`;
  $('s-power').style.color = stats.powerSup - stats.powerUse < 3 && grid.some(c => ZONE[c.type]) ? '#ff9b7b' : '';
  const y = Math.floor((S.day - 1) / 360) + 1, m = Math.floor(((S.day - 1) % 360) / 30) + 1, dd = (S.day - 1) % 30 + 1;
  $('s-date').textContent = `${y}年${m}月${dd}日`;
  const bar = (id, v) => { const e = $(id); if (v >= 0) { e.style.bottom = '50%'; e.style.top = ''; e.style.height = v * 50 + '%'; } else { e.style.top = '50%'; e.style.bottom = ''; e.style.height = -v * 50 + '%'; } };
  bar('d-r', stats.dR); bar('d-c', stats.dC); bar('d-i', stats.dI);
  const g = GOALS[S.goal];
  $('goal').innerHTML = g ? `目標：人口達 <b>${g}</b><br>${stats.pop} / ${g}` : '<b>🏆 大都市完成！</b>';
  document.querySelectorAll('.tool').forEach(b => { const t = TOOL[b.dataset.tool]; b.classList.toggle('locked', !!t.unlock && stats.pop < t.unlock && !(t.id === 'solar' && M.mod.solarFree)); });
  if (infoCell) showInfo(infoCell, true);
}

let infoCell = null;
function showInfo(c, refresh) {
  const box = $('info');
  if (!refresh) infoCell = c;
  if (c.type === 'empty') { box.classList.add('hidden'); infoCell = null; ring.visible = false; return; }
  box.classList.remove('hidden');
  if (TERRAIN.has(c.type)) {
    const tip = { water: M.mod.water ? `距離 ${M.mod.water.r} 格內滿意度 +${M.mod.water.v}` : '無法建造', mountain: M.mod.mountain ? `周邊 ${M.mod.mountain.r} 格滿意度 +${M.mod.mountain.v}` : '無法建造', hill: M.mod.mountain ? `周邊 ${M.mod.mountain.r} 格滿意度 +${M.mod.mountain.v}` : '無法建造', landmark: `觀光地標：3 格內滿意度 +${tDist.landmarkV}` }[c.type];
    box.innerHTML = `<h3>${NAMES[c.type]}</h3><div class="row">效果<b>${tip}</b></div><div class="row">建造<b>❌ 不可建造</b></div>`;
    return;
  }
  const z = ZONE[c.type];
  let h = `<h3>${NAMES[c.type]}${z ? `<span class="lv">Lv.${c.level + 1}</span>` : ''}</h3>`;
  if (c.type === 'road') h += `<div class="row">連接方向<b>${c.mask?.toString(2).padStart(4, '0')}</b></div>`;
  else {
    if (c.built < 1) h += `<div class="row">狀態<b>🏗️ 施工中 ${Math.floor(c.built * 100)}%</b></div>`;
    if (z) h += `<div class="row">${c.type === 'res' ? '居民' : '工作機會'}<b>${z.val[c.level]}</b></div>`;
    if (c.type !== 'park') h += `<div class="row">道路<b>${c.road ? '✅ 已連接' : '❌ 未連接'}</b></div>`;
    if (z || TOOL[c.type].power < 0) h += `<div class="row">電力<b>${c.powered ? '✅ 有電' : '⚡ 停電'}</b></div>`;
    if (TOOL[c.type]?.power > 0) h += `<div class="row">發電量<b>${TOOL[c.type].power}</b></div>`;
    if (TOOL[c.type]?.upkeep) h += `<div class="row">維護費<b>$${TOOL[c.type].upkeep}/天</b></div>`;
    if (z) {
      h += `<div class="row">滿意度<b>${Math.round(c.hap)}%</b></div>`;
      if (c.level < z.levels.length - 1) h += `<div class="row">升級需求<b>滿意度 ${38 + c.level * 9}%</b></div>`;
      else h += `<div class="row">等級<b>⭐ 最高級</b></div>`;
    }
  }
  box.innerHTML = h;
}

function toast(msg, cls = '') {
  const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = msg;
  $('toasts').appendChild(t); setTimeout(() => t.remove(), 3100);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

// 選單
$('menuBtn').onclick = () => $('menu').classList.remove('hidden');
$('btnResume').onclick = () => $('menu').classList.add('hidden');
$('btnSave').onclick = () => { save(); $('menu').classList.add('hidden'); };
$('btnNew').onclick = () => { if (confirm('確定要重新開始這張地圖嗎？目前的城市會被清除。')) { localStorage.removeItem(SAVE_KEY + S.map); startGame(newState(S.map)); $('menu').classList.add('hidden'); } };
$('btnMaps').onclick = () => { save(true); $('menu').classList.add('hidden'); showLevels(); };
function showLevels() {
  const box = $('levelList'); box.innerHTML = '';
  for (const m of MAPS) {
    const sv = load(m.id);
    const card = document.createElement('div'); card.className = 'lvcard'; card.style.setProperty('--sky', m.sky);
    card.innerHTML = `<div class="lvhead"><span class="lvic">${m.ic}</span><div><b>${m.nm}</b><small>難度 ${m.diff}・起始資金 $${m.money.toLocaleString()}</small></div></div>
      <p>${m.desc}</p><ul>${m.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      <div class="lvbtns">${sv ? `<button data-act="cont">▶ 繼續（第${sv.day}天・人口 ${sv.pop || 0}）</button><button data-act="new" class="ghost">重新開始</button>` : `<button data-act="new">開始建設</button>`}</div>`;
    card.querySelectorAll('button').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'new' && sv && !confirm(`重新開始「${m.nm}」？原本的存檔會被覆蓋。`)) return;
      $('levels').classList.add('hidden');
      startGame(b.dataset.act === 'cont' ? sv : newState(m.id));
      if (b.dataset.act === 'new') toast(`${m.ic} ${m.nm}：${m.rules[0]}`, '');
    });
    box.appendChild(card);
  }
  $('levels').classList.remove('hidden');
}

// ───────────────────────── 存讀檔 ─────────────────────────
function save(quiet) {
  if (!S) return;
  S.pop = stats.pop;
  S.cells = grid.map(c => c.type === 'empty' ? (c.trees ? 1 : 0) : TERRAIN.has(c.type) ? 0 : [c.type, c.level, +c.built.toFixed(2)]);
  try { localStorage.setItem(SAVE_KEY + S.map, JSON.stringify(S)); localStorage.setItem(SAVE_KEY + 'last', S.map); if (!quiet) toast('💾 已存檔', 'good'); } catch { }
}
function load(id) { try { return JSON.parse(localStorage.getItem(SAVE_KEY + id)); } catch { return null; } }
addEventListener('beforeunload', () => save(true));

function startGame(state) {
  S = state; S.map = S.map || 'grass'; M = MAP(S.map);
  infoCell = null; $('info').classList.add('hidden');
  stats.pop = 0;
  agents.forEach(a => agentsGroup.remove(a.mesh)); agents.length = 0;
  buildBoard();
  setupFx();
  if (S.cells?.length === N * N) {
    grid.forEach((c, k) => {
      const v = S.cells[k];
      if (TERRAIN.has(c.type)) return;
      if (v === 0) clearTrees(c);
      else if (v === 1) { if (!c.trees) addTrees(c); }
      else if (Array.isArray(v)) { clearTrees(c); c.type = v[0]; c.level = v[1]; c.built = v[2]; }
    });
    grid.forEach(c => { if (c.type === 'road') { c.mask = -1; refreshRoad(c); } });
    grid.forEach(c => {
      if (c.type === 'park') setBase(c, 'tile-park', 0);
      if (c.type !== 'empty' && c.type !== 'road' && !TERRAIN.has(c.type)) { if (c.built >= 1) placeObject(c, false); else addCrane(c); }
    });
  } else {
    seedStarter();
  }
  $('tax').value = S.tax; $('taxv').textContent = S.tax + '%';
  simulateDay(); S.day--;
  updateHUD();
}
// 新遊戲：預先鋪一條主幹道
function seedStarter() {
  for (const [i0, j0, i1, j1] of M.roads) {
    let i = i0, j = j0;
    while (true) {
      const c = C(i, j);
      if (c && (c.type === 'empty' || c.type === 'road')) { clearTrees(c); c.type = 'road'; }
      if (i === i1 && j === j1) break;
      i += Math.sign(i1 - i); j += Math.sign(j1 - j);
    }
  }
  grid.forEach(c => { if (c.type === 'road') { c.mask = -1; refreshRoad(c); } });
  const w = C(...M.windmill); if (w && w.type === 'empty') { clearTrees(w); w.type = 'power'; w.built = 1; placeObject(w, false); }
  // 鏡頭重設
  camera.position.set(260, 300, 330); controls.target.set(0, 0, 0);
}

// ───────────────────────── 主迴圈 ─────────────────────────
const clock = new THREE.Clock();
let agentTimer = 0, cycle = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const sdt = dt * speed;
  if (speed > 0) {
    dayAcc += sdt;
    while (dayAcc >= DAY_SEC) { dayAcc -= DAY_SEC; simulateDay(); }
  }
  // 施工
  for (const c of grid) {
    if (c.built < 1 && c.type !== 'empty') {
      c.built = Math.min(1, c.built + sdt / 3.5);
      if (c.built >= 1) { removeCrane(c); placeObject(c); }
    }
    if (c.obj && c.anim !== undefined && c.anim < 1) {
      c.anim = Math.min(1, c.anim + dt * 2.2);
      const k = c.anim, e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      c.obj.scale.y = c.obj.userData.baseScale * Math.max(0.001, e);
    }
    if (c.obj?.userData.prop && speed > 0) c.obj.userData.prop.rotation.z += dt * 2.5 * speed;
  }
  for (let k = dusts.length - 1; k >= 0; k--) {
    const d = dusts[k]; d.userData.life -= dt * 1.2;
    d.position.addScaledVector(d.userData.v, dt); d.userData.v.multiplyScalar(0.94);
    d.scale.setScalar(2 + (1 - d.userData.life) * 4); d.material.opacity = Math.max(0, d.userData.life * .7);
    if (d.userData.life <= 0) { scene.remove(d); dusts.splice(k, 1); }
  }
  agentTimer += dt; if (agentTimer > 0.4) { agentTimer = 0; balanceAgents(); }
  updateAgents(dt);
  updateFx(dt);

  // 晝夜（一年＝4個晝夜循環太快，改為每 24 天一輪）
  cycle = ((S.day + dayAcc / DAY_SEC) % 24) / 24;
  const sunA = cycle * Math.PI * 2;
  const daylight = Math.max(0, Math.sin(sunA)) ;
  const lightK = 0.35 + 0.65 * Math.min(1, daylight * 2.2);
  sun.intensity = 2.4 * lightK; hemi.intensity = 0.5 + 0.7 * lightK;
  sun.position.set(Math.cos(sunA) * 300, 120 + 300 * daylight, 160);
  const sky = scene.background;
  if (daylight > 0.25) sky.copy(SKY_DAY); else if (daylight > 0) sky.copy(SKY_DUSK).lerp(SKY_DAY, daylight / 0.25); else sky.copy(SKY_NIGHT).lerp(SKY_DUSK, Math.max(0, 1 + Math.sin(sunA) * 4));
  scene.fog.color.copy(sky);

  controls.update();
  // 限制鏡頭目標在地圖內
  const lim = N * T / 2;
  controls.target.x = Math.max(-lim, Math.min(lim, controls.target.x));
  controls.target.z = Math.max(-lim, Math.min(lim, controls.target.z));
  controls.target.y = 0;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ───────────────────────── 載入 ─────────────────────────
new GLTFLoader().load('models/town.glb', gltf => {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  for (const o of [...root.children]) {
    const box = new THREE.Box3().setFromObject(o);
    const size = new THREE.Vector3(); box.getSize(size);
    o.userData.size = size;
    protos[o.name] = o;
  }
  root.traverse(o => {
    if (o.isMesh) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => { if (m.transparent) { m.depthWrite = false; } m.envMapIntensity = 0; });
    }
  });
  $('loading').classList.add('hidden');
  setControls(); selectTool('select');
  let last = null; try { last = localStorage.getItem(SAVE_KEY + 'last'); } catch { }
  startGame((last && load(last)) || newState('grass'));
  showLevels();
  tick();
}, p => { if (p.total) $('loadbar').style.width = (p.loaded / p.total * 100) + '%'; }, err => { $('loadtxt').textContent = '模型載入失敗：' + err.message; });

window.__game = { start: id => { document.getElementById('levels').classList.add('hidden'); startGame(newState(id)); }, get S() { return S; }, get grid() { return grid; }, apply: (i, j, t) => apply(C(i, j), t), simulateDay, protos, camera, controls, setSpeed: s => speed = s };
