import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initParts, catalog, thumbnail, renderThumb, loadPart, partInfo, loader, LDU, LINE_LAYER } from './parts.js';
import { partSnaps, transformSnap, findConnections, autoConnect, clashChecker, isConnector, pinSpots } from './snaps.js';
import { createRunner, EXAMPLE_PROGRAM } from './code.js';
import { createAssistant } from './assistant.js';
import { listModels, saveModel, deleteModel, readUpload, registerPart, meshGeometry } from './library.js';
import { parseLdr } from './ldr.js';
import { createEditor } from './build.js';
import { createArena, FLL_MAT_MM } from './arena.js';
import { createSim } from './sim.js';
import { massGrams, weightSource, setWeightOverride } from './data/weights.js';
import { tween, easeInOutCubic, easeOutBack } from './motion.js';
import exampleRobot from '../examples/spike-drive-base.ldr?raw';
import { auth } from './auth.js';

// The studio is for signed-in people: anyone else signs up first, then comes back here.
const user = await auth.currentUser().catch(() => null);
if (!user) {
  location.replace(`/account.html?mode=signup&next=${encodeURIComponent('/studio.html')}`);
  await new Promise(() => {}); // stop here while the browser leaves
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 4500);
}

// ---------------------------------------------------------------- renderer, scene, camera
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; // keeps LEGO colours true instead of shifting them
renderer.toneMappingExposure = 1.05;
view.prepend(renderer.domElement);

// A light studio: the floor fades into a backdrop of the same colour, like a product photo.
const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0, 5, 14);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;

const camera = new THREE.PerspectiveCamera(40, 1, 0.002, 60);
camera.position.set(0.32, 0.26, 0.42);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.03, 0);
controls.enableDamping = true;
// calm camera: slower orbit, stops soon after you let go (no long drift), zoom goes where the cursor points
controls.dampingFactor = 0.16;
controls.rotateSpeed = 0.7;
controls.panSpeed = 0.8;
controls.zoomSpeed = 0.9;
controls.zoomToCursor = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 0.03;
controls.maxDistance = 8;

const sky = new THREE.HemisphereLight(0xffffff, 0x9aa3ae, 0.9);
scene.add(sky);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.001;
const SUN_OFFSET = new THREE.Vector3(0.6, 1.2, 0.45);
function setShadowArea(halfM) {
  const c = sun.shadow.camera;
  c.left = c.bottom = -halfM; c.right = c.top = halfM; c.near = 0.05; c.far = 4;
  c.updateProjectionMatrix();
}
setShadowArea(0.4);
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// Build grid: 8 mm (1 stud) cells, heavier line every 5 studs
const studGrid = new THREE.GridHelper(0.96, 120, 0xc9d0d8, 0xc9d0d8);
const bigGrid = new THREE.GridHelper(0.96, 24, 0xb3bcc7, 0xb3bcc7);
studGrid.position.y = 0.0001; bigGrid.position.y = 0.00015;
// Test floor grid: 10 cm cells
const floorGrid = new THREE.GridHelper(6, 60, 0xbfc7d1, 0xc9d0d8);
floorGrid.position.y = 0.0001;
floorGrid.visible = false;
scene.add(studGrid, bigGrid, floorGrid);

// Dark or light: the page's colours come from CSS; the 3D floor, backdrop and grids follow here.
const SCENE_COLOURS = {
  light: { backdrop: 0xdde3e9, ground: 0xcdd4dc, stud: 0xbdc5ce, big: 0xa7b1bd, floor: 0xb9c1cb, skyGround: 0x9aa3ae },
  dark: { backdrop: 0x1a1d22, ground: 0x23272d, stud: 0x2f353c, big: 0x3c434c, floor: 0x343a42, skyGround: 0x40464f },
};
const THEME_KEY = 'studio.theme';
let blocks = null; // the block editor, once the Code tab has opened it
let theme = 'dark';
try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch { /* dark to start with */ }
function setTheme(t) {
  theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  document.documentElement.dataset.theme = t;
  const c = SCENE_COLOURS[t];
  scene.background.set(c.backdrop);
  scene.fog.color.set(c.backdrop);
  ground.material.color.set(c.ground);
  sky.groundColor.set(c.skyGround);
  for (const [grid, colour] of [[studGrid, c.stud], [bigGrid, c.big], [floorGrid, c.floor]]) {
    grid.material.vertexColors = false;
    grid.material.color.set(colour);
    grid.material.needsUpdate = true;
  }
  $('#theme use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  $('#theme').title = t === 'dark' ? 'Switch to light' : 'Switch to dark';
  blocks?.setDark(t === 'dark');
}
setTheme(theme);
$('#theme').addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));

// Ambient occlusion darkens the gaps between parts the way real light does; it's what makes a model read as solid.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, 1, 1);
ao.blendIntensity = 0.9;
composer.addPass(ao);
composer.addPass(new OutputPass());
const setAoScale = metres => ao.updateGtaoMaterial({ radius: metres, distanceExponent: 1.5, thickness: metres, scale: 1, samples: 16 });
setAoScale(0.012);

new ResizeObserver(() => {
  const { clientWidth: w, clientHeight: h } = view;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(view);

// Outline style: off = realistic, on = instruction-book edges
const LINES_KEY = 'studio.lines';
let showLines = false;
try { showLines = localStorage.getItem(LINES_KEY) === '1'; } catch { /* default */ }
const applyLines = () => {
  camera.layers[showLines ? 'enable' : 'disable'](LINE_LAYER);
  $('#lines')?.setAttribute('aria-pressed', showLines);
};

// Smooth camera move: both the eye and the orbit point travel together.
function flyTo(pos, target, ms = 700) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  return tween(ms, k => {
    camera.position.lerpVectors(p0, pos, k);
    controls.target.lerpVectors(t0, target, k);
  }, easeInOutCubic);
}

// ---------------------------------------------------------------- editor + arena
const editor = createEditor({ scene, toast });
const arena = createArena(scene, toast);
arena.group.visible = false;

// ---------------------------------------------------------------- gizmo + selection
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.8);
scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });

const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const makeOutline = (color, opacity) => {
  const o = new THREE.LineSegments(outlineGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
  o.matrixAutoUpdate = false;
  o.visible = false;
  o.renderOrder = 10;
  scene.add(o);
  return o;
};
const SELECT_BLUE = 0x2563eb;
const selOutlines = [];
const hoverOutline = makeOutline(SELECT_BLUE, 0.35);
// The motor or sensor you point at in the Drive tab glows, so you can see which part a card means.
const glowMat = new THREE.MeshBasicMaterial({ color: SELECT_BLUE, transparent: true, opacity: 0.5, depthTest: false });
let glow = null;
function glowOn(obj) {
  glow?.removeFromParent();
  glow = null;
  if (!obj) return;
  glow = obj.clone();
  glow.matrix.identity(); // sits exactly on the part, as its child
  glow.traverse(o => { if (o.isMesh) { o.material = glowMat; o.renderOrder = 9; } else if (o.isLineSegments) o.visible = false; });
  obj.add(glow);
}
const localBoxes = new WeakMap(); // object -> Box3 in its own frame

function localBox(obj) {
  if (localBoxes.has(obj)) return localBoxes.get(obj);
  let box = null;
  if (obj.userData.part) partInfo(obj.userData.file).then(i => localBoxes.set(obj, i.box));
  else if (obj.geometry) { obj.geometry.computeBoundingBox(); box = obj.geometry.boundingBox; }
  else if (obj.userData.obstacle) { // a LEGO model in the arena
    obj.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj).applyMatrix4(obj.matrixWorld.clone().invert());
  }
  else if (obj === robotStart) {
    obj.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(robotModel).applyMatrix4(obj.matrixWorld.clone().invert());
  }
  if (box) localBoxes.set(obj, box);
  return box;
}

const _m = new THREE.Matrix4(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
function fitOutline(outline, obj) {
  const box = obj && obj.parent && localBox(obj);
  outline.visible = !!box;
  if (!box) return;
  box.getCenter(_c);
  box.getSize(_s).addScalar(obj.userData.part ? 2 : 0);
  outline.matrix.copy(obj.matrixWorld).multiply(_m.compose(_c, new THREE.Quaternion(), _s));
}

// Build mode can select many parts; the gizmo then holds an invisible "pivot" that carries them all.
const selection = new Set();
let selected = null, hovered = null;
const pivot = new THREE.Object3D();
editor.model.add(pivot);
let gizmoStarts = null;

function select(obj, { add = false } = {}) {
  if (!add) selection.clear();
  if (obj) {
    if (add && selection.has(obj)) selection.delete(obj);
    else selection.add(obj);
  }
  selected = obj && selection.has(obj) ? obj : [...selection].pop() || null;
  attachGizmo();
  refreshPanel();
}
function selectMany(objs) {
  selection.clear();
  objs.forEach(o => selection.add(o));
  selected = objs[0] || null;
  attachGizmo();
  refreshPanel();
}
// Big buttons for the selected part, so nobody needs the keyboard shortcuts.
const refreshPartBar = () => { $('#part-bar').hidden = mode !== 'build' || !selection.size || !!placing; };
function attachGizmo() {
  refreshPartBar();
  if (!selected) return gizmo.detach();
  if (mode === 'build') {
    pivot.position.copy(selected.position);
    pivot.quaternion.copy(selected.quaternion);
    pivot.updateMatrix();
    gizmo.attach(pivot);
  } else gizmo.attach(selected);
  configureGizmo();
}

// What the gizmo may do depends on what it holds.
let gizmoMode = 'translate';
function configureGizmo() {
  const obj = gizmo.object;
  if (!obj) return;
  const isRobot = obj === robotStart, inModel = obj === pivot || obj.userData.part;
  const lego = obj.userData.obstacle && arena.defOf(obj)?.type === 'ldraw'; // LEGO is its real size: no resizing
  const mode = (isRobot || inModel || lego) && gizmoMode === 'scale' ? 'translate' : gizmoMode;
  gizmo.setMode(mode);
  gizmo.showY = !(isRobot && mode === 'translate');
  gizmo.showX = gizmo.showZ = !(isRobot && mode === 'rotate');
  const grid = +$('#snap').value;
  // parts live inside the LDU-scaled model, so their snap is in LDU; arena things are in metres
  gizmo.setTranslationSnap(grid ? (inModel ? grid : grid * LDU) : null);
  gizmo.setRotationSnap(+$('#rsnap').value ? THREE.MathUtils.degToRad(+$('#rsnap').value) : null);
  gizmo.setScaleSnap(0.005);
  gizmo.setSpace(inModel ? 'local' : 'world');
  $$('[data-gizmo]').forEach(b => b.setAttribute('aria-pressed', b.dataset.gizmo === mode));
}
function setGizmoMode(m) {
  gizmoMode = m;
  configureGizmo();
  $$('[data-gizmo]').forEach(b => b.setAttribute('aria-pressed', b.dataset.gizmo === m));
}
$$('[data-gizmo]').forEach(b => b.addEventListener('click', () => setGizmoMode(b.dataset.gizmo)));
$('#lines').addEventListener('click', () => {
  showLines = !showLines;
  try { localStorage.setItem(LINES_KEY, showLines ? '1' : '0'); } catch { /* ignore */ }
  applyLines();
});
applyLines();
$('#snap').addEventListener('change', configureGizmo);
$('#rsnap').addEventListener('change', configureGizmo);

const setMatrix = (o, m) => { m.decompose(o.position, o.quaternion, o.scale); o.updateMatrix(); };
const startsOf = parts => new Map(parts.map(p => { p.updateMatrix(); return [p, p.matrix.clone()]; }));
function moveSelection(T, starts) {
  for (const [p, start] of starts) setMatrix(p, T.clone().multiply(start));
}

// Live position readout while dragging: the "snap tick" you can read.
const readout = $('#readout');
const showReadout = text => { readout.textContent = text; readout.classList.add('on'); };
const positionText = obj => {
  const p = obj.getWorldPosition(new THREE.Vector3()).multiplyScalar(1000);
  return `x ${fmt(p.x, 1)}  y ${fmt(p.y, 1)}  z ${fmt(p.z, 1)} mm`;
};
gizmo.addEventListener('mouseDown', () => {
  if (gizmo.object === pivot) { pivot.updateMatrix(); gizmoStarts = { pivot: pivot.matrix.clone(), parts: startsOf([...selection]) }; }
});
gizmo.addEventListener('objectChange', () => {
  const obj = gizmo.object;
  if (!obj) return;
  if (obj === pivot && gizmoStarts) {
    pivot.updateMatrix();
    moveSelection(pivot.matrix.clone().multiply(gizmoStarts.pivot.clone().invert()), gizmoStarts.parts);
  }
  if (gizmo.mode === 'rotate') {
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion);
    showReadout(['x', 'y', 'z'].map(a => `${a} ${fmt(THREE.MathUtils.radToDeg(e[a]))}°`).join('  '));
  } else if (gizmo.mode === 'scale') {
    showReadout(obj.scale.toArray().map(v => fmt(v * 1000)).join(' × ') + ' mm');
  } else showReadout(positionText(obj === pivot ? selected : obj));
  if (obj === robotStart) Object.assign(arena.robotStart, { x: obj.position.x, z: obj.position.z, yaw: obj.rotation.y });
  if (obj.userData.obstacle) refreshObstacle();
});
gizmo.addEventListener('mouseUp', () => {
  readout.classList.remove('on');
  gizmoStarts = null;
  if (mode === 'build') editor.commit();
  else arena.autosave();
  refreshPanel();
});

// ---------------------------------------------------------------- picking
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
function pickTargets() {
  if (mode === 'build') return editor.parts();
  if (sim) return [];
  return [...arena.items.map(i => i.obj), robotStart];
}
function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function pickHit(e, targets = pickTargets()) {
  setPointer(e);
  const hit = raycaster.intersectObjects(targets, true).find(h => h.object.isMesh && h.object.visible);
  if (!hit) return null;
  let o = hit.object;
  while (o && !targets.includes(o)) o = o.parent;
  return o && { obj: o, point: hit.point, normal: hit.face?.normal };
}
const pick = e => pickHit(e)?.obj ?? null;

// ---------------------------------------------------------------- click-together building
// Snap data for every part type in the model, loaded in the background so dragging never waits.
const snapCache = new Map();
const snapsOf = file => {
  if (!snapCache.has(file)) { snapCache.set(file, null); partSnaps(file).then(s => snapCache.set(file, s)).catch(() => snapCache.set(file, [])); }
  return snapCache.get(file);
};
// ...and every part's box, which auto-connect needs to keep parts from overlapping
editor.onChange(() => editor.parts().forEach(p => {
  snapsOf(p.userData.file);
  if (!localBoxes.has(p)) partInfo(p.userData.file).then(i => localBoxes.set(p, i.box)).catch(() => {});
}));
const modelEntries = exclude => editor.parts().filter(p => !exclude.has(p)).map(p => {
  p.updateMatrix();
  return { obj: p, name: catalog.get(p.userData.file)?.name, snaps: (snapsOf(p.userData.file) || []).map(s => transformSnap(s, p.matrix)) };
});

// A ring shows where a part is about to click in.
const snapRing = new THREE.Mesh(new THREE.TorusGeometry(8, 1.4, 8, 32), new THREE.MeshBasicMaterial({ color: 0x16a34a, depthTest: false, transparent: true }));
snapRing.renderOrder = 11;
snapRing.visible = false;
editor.model.add(snapRing);
function showRing(hit) {
  snapRing.visible = !!hit;
  if (!hit) return;
  snapRing.position.copy(hit.point);
  snapRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.to.d);
  snapRing.material.opacity = 1;
  snapRing.scale.setScalar(1);
}

const toModel = v => v.clone().applyMatrix4(editor.model.matrixWorld.clone().invert());
const gridStep = () => +$('#snap').value || 0;
const snapTo = (v, step) => (step ? Math.round(v / step) * step : v);

// Auto-connect (default): whatever you drag or place jumps onto the pins, holes and axles near the cursor.
// Manual: it goes exactly where you put it (on the grid, if one is set). Alt switches to manual for one drag.
const AUTO_KEY = 'studio.autoConnect';
let autoConnectOn = true;
try { autoConnectOn = localStorage.getItem(AUTO_KEY) !== '0'; } catch { /* default on */ }
const showAutoConnect = () => {
  $('#auto-connect').setAttribute('aria-pressed', autoConnectOn);
  $('#auto-connect span').textContent = autoConnectOn ? 'Auto-connect' : 'Manual';
};
function setAutoConnect(on) {
  autoConnectOn = on;
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  showAutoConnect();
  toast(on ? 'Auto-connect: parts click onto the nearest pin, hole or axle.' : 'Manual: parts go exactly where you put them.');
}
$('#auto-connect').addEventListener('click', () => setAutoConnect(!autoConnectOn));
showAutoConnect();

let drag = null; // { grabbed, starts, origin, x0, y0, started, placing, prep, lastHit, lastKey }
function beginDrag(grabbed, point, e, placing = false) {
  drag = { grabbed, starts: startsOf([...selection]), origin: point.clone(), x0: e?.clientX ?? 0, y0: e?.clientY ?? 0, started: placing, placing, prep: null };
  if (placing) drag.prep = prepareDrag();
}

// Everything auto-connect needs, worked out once per drag.
function prepareDrag() {
  const startGrab = drag.starts.get(drag.grabbed), inv = startGrab.clone().invert();
  const grabLocal = toModel(drag.origin).applyMatrix4(inv);
  const moving = [], movingBoxes = [], groupBox = new THREE.Box3();
  for (const [p, start] of drag.starts) {
    const offset = inv.clone().multiply(start), box = localBoxes.get(p);
    for (const sn of snapsOf(p.userData.file) || []) moving.push(transformSnap(sn, offset));
    if (box) {
      movingBoxes.push({ box, offset, connector: isConnector(catalog.get(p.userData.file)?.name) });
      groupBox.union(box.clone().applyMatrix4(offset));
    }
  }
  // the pins and holes nearest where you grabbed it are the ones you mean to connect
  moving.sort((x, y) => x.p.distanceTo(grabLocal) - y.p.distanceTo(grabLocal));
  const others = editor.parts().filter(p => !selection.has(p));
  const statics = [], staticBoxes = [];
  for (const p of others) {
    p.updateMatrix();
    for (const sn of snapsOf(p.userData.file) || []) statics.push({ ...transformSnap(sn, p.matrix), owner: p });
    const box = localBoxes.get(p);
    if (box) staticBoxes.push({ box: box.clone().applyMatrix4(p.matrix), connector: isConnector(catalog.get(p.userData.file)?.name) });
  }
  return { moving: moving.slice(0, 48), statics, clash: clashChecker(staticBoxes, movingBoxes), groupBox, centre: groupBox.isEmpty() ? new THREE.Vector3() : groupBox.getCenter(new THREE.Vector3()) };
}

function screenOf(v) {
  const w = v.clone().applyMatrix4(editor.model.matrixWorld).project(camera);
  if (w.z > 1) return null;
  const r = renderer.domElement.getBoundingClientRect();
  return { x: (w.x * 0.5 + 0.5) * r.width, y: (-w.y * 0.5 + 0.5) * r.height };
}

function updateDrag(e) {
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.started = true;
    drag.prep = prepareDrag();
  }
  setPointer(e);
  const step = gridStep();
  const startGrab = drag.starts.get(drag.grabbed);
  let T;
  if (drag.placing) {
    // follow whatever surface is under the cursor, resting the part (or group) on it
    const others = editor.parts().filter(p => !selection.has(p));
    const hit = raycaster.intersectObjects(others, true).find(h => h.object.isMesh);
    const ground = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    const at = hit?.point || ground;
    if (!at || drag.prep.groupBox.isEmpty()) return;
    const p = toModel(at);
    const box = drag.prep.groupBox.clone().applyMatrix4(new THREE.Matrix4().extractRotation(startGrab));
    const c = box.getCenter(new THREE.Vector3());
    const target = new THREE.Vector3(snapTo(p.x - c.x, step), p.y - box.max.y, snapTo(p.z - c.z, step));
    T = new THREE.Matrix4().makeTranslation(target.x - startGrab.elements[12], target.y - startGrab.elements[13], target.z - startGrab.elements[14]);
  } else {
    // slide on a level plane through the grab point; hold Shift to lift straight up and down
    const normal = e.shiftKey ? camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate() : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, drag.origin);
    const at = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return;
    const d = toModel(at).sub(toModel(drag.origin));
    if (e.shiftKey) { d.x = 0; d.z = 0; } else d.y = 0;
    T = new THREE.Matrix4().makeTranslation(snapTo(d.x, step), snapTo(d.y, step), snapTo(d.z, step));
  }
  // auto-connect: let the nearest pin, hole or axle under the cursor pull it into place
  let hit = null;
  // a small nudge of the mouse just slides the part; only a real move goes looking for a connection
  const travelled = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
  if (autoConnectOn && !e.altKey && drag.prep?.moving.length && (drag.placing || travelled > 16)) {
    const inv = editor.model.matrixWorld.clone().invert();
    const ray = raycaster.ray.clone().applyMatrix4(inv);
    ray.direction.normalize();
    const r = renderer.domElement.getBoundingClientRect();
    hit = autoConnect({
      moving: drag.prep.moving, statics: drag.prep.statics, clash: drag.prep.clash, centre: drag.prep.centre,
      rotation: new THREE.Matrix4().extractRotation(startGrab), project: screenOf, ray,
      cursor: { x: e.clientX - r.left, y: e.clientY - r.top }, previous: drag.lastKey,
      height: e.shiftKey ? null : T.clone().multiply(startGrab).elements[13], // lifting with Shift: any height is fine
    });
    if (hit) T = hit.matrix.clone().multiply(startGrab.clone().invert());
  }
  showRing(hit);
  drag.lastHit = hit;
  drag.lastKey = hit?.key;
  drag.target = T; // the frame loop glides the part there
  showReadout(hit ? `Connects · ${positionText(drag.grabbed)}` : `${autoConnectOn && !e.altKey ? 'Move over a hole or pin to connect' : 'Manual'} · ${positionText(drag.grabbed)}`);
}
// The dragged part catches up with the cursor over a few frames instead of teleporting: it feels held, and a
// connection it jumps to slides into place. Keyboard moves stay instant.
const glidePos = [new THREE.Vector3(), new THREE.Vector3()], glideRot = [new THREE.Quaternion(), new THREE.Quaternion()], glideScale = new THREE.Vector3();
function glideDrag(dt) {
  if (!drag.shown) drag.shown = drag.target.clone();
  const k = 1 - Math.exp(-dt * 30); // about 35 ms to close most of the gap
  drag.shown.decompose(glidePos[0], glideRot[0], glideScale);
  drag.target.decompose(glidePos[1], glideRot[1], glideScale);
  glidePos[0].lerp(glidePos[1], k);
  glideRot[0].slerp(glideRot[1], k);
  drag.shown.compose(glidePos[0], glideRot[0], glideScale);
  moveSelection(drag.shown, drag.starts);
  if (selected) { pivot.position.copy(selected.position); pivot.quaternion.copy(selected.quaternion); }
}
// After a hole-to-hole connection, put friction pins in like a builder would: at the hole you aimed for
// and at the lined-up hole farthest from it (two pins hold a beam firmly; one if that's all there is).
const PIN = '2780.dat';
async function addPinsFor(objs, hit) {
  if (!hit?.pin) return;
  const snapsIn = list => list.flatMap(o => { o.updateMatrix(); return (snapsOf(o.userData.file) || []).map(sn => transformSnap(sn, o.matrix)); });
  const others = editor.parts().filter(p => !objs.includes(p));
  const statics = snapsIn(others), mine = snapsIn(objs);
  const filled = [...statics, ...mine].filter(sn => sn.gender === 'M'); // pins and axles already in place, ours included
  const occupied = sp => filled.some(m => {
    if (Math.abs(m.d.dot(sp.d)) < 0.99) return false;
    const rel = sp.point.clone().sub(m.p), t = rel.dot(m.d);
    return t > m.a - 1 && t < m.b + 1 && rel.addScaledVector(m.d, -t).length() < 2;
  });
  const spots = pinSpots(mine, statics)
    .filter((sp, i, all) => !occupied(sp) && all.findIndex(o => o.point.distanceTo(sp.point) < 1) === i)
    .sort((x, y) => x.point.distanceTo(hit.point) - y.point.distanceTo(hit.point));
  if (!spots.length) return;
  const far = spots.reduce((f, sp) => (sp.point.distanceTo(spots[0].point) > f.point.distanceTo(spots[0].point) ? sp : f), spots[0]);
  const chosen = far.point.distanceTo(spots[0].point) > 15 ? [spots[0], far] : [spots[0]];
  const records = chosen.map(sp => {
    const e = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), sp.d)).elements;
    return { file: PIN, color: '0', m: [sp.point.x, sp.point.y, sp.point.z, e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] };
  });
  const pins = await editor.insert(records);
  for (const pn of pins) partInfo(PIN).then(i => localBoxes.set(pn, i.box));
  toast(`Added ${pins.length} friction pin${pins.length > 1 ? 's' : ''} to hold it on.`);
}

function endDrag(commit = true) {
  if (drag?.target) moveSelection(drag.target, drag.starts); // land exactly where it was going
  const wasSnapped = snapRing.visible, hit = drag?.lastHit, moved = drag && [...drag.starts.keys()];
  drag = null;
  readout.classList.remove('on');
  controls.enabled = true;
  if (wasSnapped) tween(260, k => { snapRing.scale.setScalar(1 + k * 0.8); snapRing.material.opacity = 1 - k; }).then(() => { snapRing.visible = false; });
  else snapRing.visible = false;
  if (commit) { editor.commit(); if (moved) addPinsFor(moved, hit); }
  attachGizmo();
}

// New parts follow the cursor until you click to put them down.
let placing = null; // the new part(s) following the cursor
function cancelPlacing() {
  if (!placing) return;
  const objs = placing;
  placing = null;
  drag = null;
  snapRing.visible = false;
  readout.classList.remove('on');
  editor.remove(objs);
  select(null);
}
// Hands freshly added parts to the cursor: they follow it, auto-connect, and land on click.
async function startPlacing(objs) {
  await Promise.all(objs.map(async o => {
    const f = o.userData.file;
    localBoxes.set(o, (await partInfo(f)).box);
    snapCache.set(f, await partSnaps(f).catch(() => []));
  }));
  selectMany(objs);
  gizmo.detach(); // handles would only get in the way while the part follows the cursor
  placing = objs;
  refreshEmpty();
  refreshPartBar();
  // grab the group by the part nearest its middle
  const mid = objs.reduce((b, o) => b.expandByObject(o), new THREE.Box3()).getCenter(new THREE.Vector3());
  const grabbed = objs.reduce((best, o) => (o.getWorldPosition(new THREE.Vector3()).distanceTo(mid) < best.getWorldPosition(new THREE.Vector3()).distanceTo(mid) ? o : best));
  beginDrag(grabbed, mid, null, true);
  showReadout('Move into the view and click to place · R turns it · Esc cancels');
}

renderer.domElement.addEventListener('pointerdown', e => {
  downAt = [e.clientX, e.clientY];
  if (e.button !== 0) return;
  if (placing) {
    const objs = placing, hit = drag?.lastHit;
    placing = null;
    endDrag(false); // committed (and pinned) once it has landed
    // a little settle as it lands: slide in along the pin/axle when it connected, else drop onto the surface
    const ends = objs.map(o => o.position.clone());
    const from = hit ? hit.to.d.clone().multiplyScalar(-8) : new THREE.Vector3(0, -12, 0);
    tween(220, k => objs.forEach((o, i) => { o.position.copy(ends[i]).addScaledVector(from, 1 - k); o.updateMatrix(); }), easeOutBack)
      .then(() => { editor.commit(); refreshPanel(); return addPinsFor(objs, hit); });
    return;
  }
  if (mode !== 'build' || gizmo.axis) return;
  const hit = pickHit(e);
  if (!hit) return;
  if (e.shiftKey) { select(hit.obj, { add: true }); downAt = null; return; }
  if (!selection.has(hit.obj)) select(hit.obj);
  else { selected = hit.obj; attachGizmo(); refreshPanel(); }
  controls.enabled = false; // dragging a part moves it; dragging empty space orbits
  renderer.domElement.setPointerCapture(e.pointerId); // keep the drag even if the mouse leaves the view
  beginDrag(hit.obj, hit.point, e);
});
renderer.domElement.addEventListener('pointerup', e => {
  if (drag && !placing) {
    const moved = drag.started;
    endDrag(moved);
    if (moved) { downAt = null; return; }
  }
  if (!downAt || gizmo.dragging || gizmo.axis) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5 && !e.shiftKey) {
    const obj = pick(e);
    if (mode !== 'build' || !obj) select(obj);
  }
  downAt = null;
});
renderer.domElement.addEventListener('dblclick', async e => {
  if (mode !== 'build') return;
  const obj = pick(e);
  if (obj) selectMany(connectedTo(obj));
});
let hoverQueued = false;
renderer.domElement.addEventListener('pointermove', e => {
  if (drag && (e.buttons || drag.placing)) { updateDrag(e); return; }
  if (hoverQueued || e.buttons) return;
  hoverQueued = true;
  requestAnimationFrame(() => { hoverQueued = false; hovered = gizmo.axis ? null : pick(e); });
});
renderer.domElement.addEventListener('pointerleave', () => { hovered = null; });

// Everything joined to a part by pins, axles or studs.
function connectedTo(obj) {
  const entries = modelEntries(new Set());
  const conns = findConnections(entries);
  const seen = new Set([entries.findIndex(en => en.obj === obj)]);
  for (let grow = true; grow;) {
    grow = false;
    for (const c of conns) if (seen.has(c.a) !== seen.has(c.b)) { seen.add(c.a); seen.add(c.b); grow = true; }
  }
  return [obj, ...[...seen].map(i => entries[i].obj).filter(o => o !== obj)];
}

// Arrow keys nudge by one grid step relative to the camera; R turns 90°.
function nudge(key, vertical) {
  if (!selection.size) return;
  const step = gridStep() || 20;
  const d = new THREE.Vector3();
  if (vertical) d.y = key === 'arrowup' || key === 'pageup' ? -step : step; // LDraw -Y is up
  else {
    const fwd = toModel(camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize())).sub(toModel(camera.position));
    const ax = Math.abs(fwd.x) > Math.abs(fwd.z) ? new THREE.Vector3(Math.sign(fwd.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(fwd.z));
    const side = new THREE.Vector3(-ax.z, 0, ax.x); // LDraw's flipped Y makes this "right" on screen
    ({ arrowup: () => d.copy(ax), arrowdown: () => d.copy(ax).negate(), arrowright: () => d.copy(side).negate(), arrowleft: () => d.copy(side) })[key]();
    d.multiplyScalar(step);
  }
  moveSelection(new THREE.Matrix4().makeTranslation(d.x, d.y, d.z), startsOf([...selection]));
  editor.commit();
  attachGizmo();
}
function turn90(tilt) {
  if (!selection.size) return;
  let axis = new THREE.Vector3(0, 1, 0);
  if (tilt) {
    const right = toModel(camera.position.clone().add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0))).sub(toModel(camera.position));
    axis = Math.abs(right.x) > Math.abs(right.z) ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  }
  const p = selected.position.clone();
  const T = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationAxis(axis, Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  if (drag?.placing) { for (const [o, m] of drag.starts) drag.starts.set(o, T.clone().multiply(m)); moveSelection(new THREE.Matrix4(), drag.starts); return; }
  moveSelection(T, startsOf([...selection]));
  editor.commit();
  attachGizmo();
}

// ---------------------------------------------------------------- parts library
const TECHNIC_CATS = new Set(['Technic', 'Electric', 'Wheel', 'Tyre']);
let filter = 'technic';
const FILTERS = {
  technic: p => (TECHNIC_CATS.has(p.cat) || p.name.startsWith('Technic')) && !/^Duplo|^Battery/.test(p.name) && !p.cat.startsWith('Sticker'),
  electric: p => p.cat === 'Electric',
  wheels: p => p.cat === 'Wheel' || p.cat === 'Tyre',
  all: () => true,
};
// Robotics staples first: beams, then pins/axles/gears, other Technic, current hubs/motors, wheels.
const RANKS = [/^Technic (Beam|Liftarm)/, /^Technic (Pin|Axle|Bush|Gear|Connector|Angle)/, /^Technic/, /^Electric (Powered Up|Mindstorms EV3)/, /^(Wheel|Tyre)/, /^Electric/];
const rank = p => { const i = RANKS.findIndex(r => r.test(p.name)); return i < 0 ? RANKS.length : i; };
const LIST_LIMIT = 150;
const thumbObserver = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const ph = en.target;
    thumbObserver.unobserve(ph);
    thumbnail(ph.dataset.file).then(src => {
      if (!src || !ph.isConnected) return;
      const img = new Image(44, 44);
      img.alt = '';
      img.src = src;
      ph.replaceWith(img);
    });
  }
}, { root: $('#parts') });

function renderList() {
  if (filter === 'mine') return renderMine();
  const q = $('#search').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const all = [...catalog.values()].filter(FILTERS[filter]).filter(p => {
    const hay = (p.name + ' ' + p.file).toLowerCase();
    return words.every(w => hay.includes(w));
  }).map(p => [rank(p), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p); // stable sort keeps name order within a rank
  const list = $('#parts');
  list.replaceChildren(...all.slice(0, LIST_LIMIT).map(p => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.title = `Add ${p.name}`;
    const ph = document.createElement('span');
    ph.className = 'ph';
    ph.dataset.file = p.file;
    const text = document.createElement('span');
    text.innerHTML = '<span class="name"></span><span class="num"></span>';
    text.firstChild.textContent = p.name;
    text.lastChild.textContent = p.file.replace(/\.dat$/, '');
    btn.append(ph, text);
    btn.addEventListener('click', () => addPart(p));
    li.append(btn);
    thumbObserver.observe(ph);
    return li;
  }));
  $('#parts-note').textContent = all.length > LIST_LIMIT
    ? `Showing ${LIST_LIMIT} of ${fmt(all.length)}. Type to narrow it down.`
    : all.length ? `${fmt(all.length)} parts` : 'No parts match.';
}
$('#search').addEventListener('input', () => renderList());
function setFilter(f) {
  filter = f;
  try { localStorage.setItem('studio.filter', f); } catch { /* ignore */ }
  $$('#filters button').forEach(x => x.setAttribute('aria-pressed', x.dataset.filter === f));
  renderList();
}
$$('#filters button').forEach(b => b.addEventListener('click', () => setFilter(b.dataset.filter)));

// ---------------------------------------------------------------- my models (your uploads)
const KIND_LABEL = { ldraw: 'LEGO model', part: 'part', mesh: '3D model' };
async function modelThumb(rec) {
  if (rec.kind === 'part') return thumbnail(rec.file);
  if (rec.kind === 'mat') { // a small copy of the picture
    const img = new Image();
    img.src = rec.data;
    await img.decode();
    const k = 240 / Math.max(img.width, img.height);
    const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.8);
  }
  if (rec.kind === 'mesh') return renderThumb(new THREE.Mesh(await meshGeometry(rec), new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.6 })));
  const root = new THREE.Group();
  root.rotation.x = Math.PI;
  await Promise.all(parseLdr(rec.data).slice(0, 400).map(async r => {
    const mesh = await loadPart(r.file, r.color).catch(() => null);
    if (!mesh) return;
    const [x, y, z, a, b, c, d, e, f, g, h, i] = r.m;
    mesh.applyMatrix4(new THREE.Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1));
    root.add(mesh);
  }));
  return renderThumb(root);
}

async function uploadFiles(files) {
  const added = [];
  for (const f of files) {
    try {
      const rec = await readUpload(f);
      if (rec.kind === 'part') registerPart(rec);
      rec.thumb = await modelThumb(rec).catch(() => null);
      await saveModel(rec);
      added.push(rec);
    } catch (err) {
      toast(err.message);
    }
  }
  if (!added.length) return;
  const mats = added.filter(r => r.kind === 'mat'), models = added.filter(r => r.kind !== 'mat');
  if (models.length) toast(`Added to your models: ${models.map(r => r.name).join(', ')}`);
  if (models.length && mode === 'build') setFilter('mine');
  renderArenaModels();
  renderMats();
  if (mats.length && mode === 'test') await useMat(mats[0]);
  else if (mats.length) toast(`Added to My mats: ${mats.map(r => r.name).join(', ')}. Use it in Test.`);
  return added;
}

function modelRow(rec, onUse) {
  const li = document.createElement('li');
  li.className = 'row';
  const btn = document.createElement('button');
  btn.title = rec.kind === 'mesh' ? `Put ${rec.name} in the arena` : `Add ${rec.name}`;
  const img = rec.thumb ? Object.assign(new Image(46, 46), { src: rec.thumb, alt: '' }) : Object.assign(document.createElement('span'), { className: 'ph' });
  const text = document.createElement('span');
  text.innerHTML = '<span class="name"></span><span class="num"></span>';
  text.firstChild.textContent = rec.name;
  text.lastChild.innerHTML = `<span class="kind">${KIND_LABEL[rec.kind]}</span>.${rec.ext}`;
  btn.append(img, text);
  btn.addEventListener('click', () => onUse(rec));
  const del = document.createElement('button');
  del.className = 'remove';
  del.innerHTML = icon('i-x');
  del.title = `Remove ${rec.name} from My models`;
  del.setAttribute('aria-label', del.title);
  del.addEventListener('click', async () => {
    if (!confirm(`Remove ${rec.name} from My models?`)) return;
    await deleteModel(rec.id);
    renderList();
    renderArenaModels();
  });
  li.append(btn, del);
  return li;
}

async function renderMine() {
  const words = $('#search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = (await listModels()).filter(r => r.kind !== 'mat' && words.every(w => r.name.toLowerCase().includes(w)));
  if (filter !== 'mine') return;
  $('#parts').replaceChildren(...all.map(r => modelRow(r, useModel)));
  $('#parts-note').textContent = all.length ? `${all.length} of your models` : 'Nothing here yet. Upload LEGO models (.ldr .mpd .io), part files (.dat) or 3D models (.stl .glb .obj), or drop them on this panel.';
}
async function renderArenaModels() {
  const all = (await listModels()).filter(r => r.kind === 'ldraw' || r.kind === 'mesh');
  $('#arena-models').replaceChildren(...all.map(r => modelRow(r, useModel)));
}

// Build: a LEGO model joins your robot as a group that follows the cursor and auto-connects.
// Test: LEGO and 3D models go in the arena. A part file becomes a normal part.
async function useModel(rec) {
  if (mode === 'test') {
    if (rec.kind === 'part') return toast('A single part goes on your robot: switch to Build to add it.');
    const obj = await arena.addModel(rec);
    if (!obj) return;
    const ahead = controls.target.clone().sub(camera.position).setY(0).setLength(0.3);
    obj.position.set(controls.target.x + ahead.x, 0, controls.target.z + ahead.z);
    arena.autosave();
    select(obj);
    return;
  }
  if (rec.kind === 'mesh') {
    toast(`${rec.name} is a 3D model, so it goes in the Test arena.`);
    await setMode('test');
    return useModel(rec);
  }
  if (rec.kind === 'part') return addPart(catalog.get(rec.file));
  cancelPlacing();
  const objs = await editor.insert(parseLdr(rec.data), { commit: false });
  if (!objs.length) return toast(`None of the parts in ${rec.name} are in the LDraw library.`);
  await startPlacing(objs);
}

$$('[data-upload]').forEach(b => b.addEventListener('click', () => {
  const input = $('#file-upload');
  input.onchange = () => { const files = [...input.files]; input.value = ''; uploadFiles(files); };
  input.click();
}));
// drop files on the left panel to upload them
const leftPanel = $('.panel.left');
leftPanel.addEventListener('dragover', e => { e.preventDefault(); leftPanel.classList.add('drop-target'); });
leftPanel.addEventListener('dragleave', e => { if (!leftPanel.contains(e.relatedTarget)) leftPanel.classList.remove('drop-target'); });
leftPanel.addEventListener('drop', e => {
  e.preventDefault();
  leftPanel.classList.remove('drop-target');
  uploadFiles([...e.dataTransfer.files]);
});

let paint = '71';
async function addPart(p) {
  cancelPlacing();
  // start under the orbit point, on the stud grid (LDraw X/Z = world X/-Z), then follow the cursor
  const at = { x: Math.round(controls.target.x / LDU / 20) * 20, z: Math.round(-controls.target.z / LDU / 20) * 20 };
  const obj = await editor.addPart(p.file, p.cat === 'Electric' ? '15' : paint, at, { place: true });
  if (obj) await startPlacing([obj]);
}

// ---------------------------------------------------------------- properties panel (build)
const COMMON_COLOURS = ['0', '71', '72', '15', '4', '1', '14', '25', '2', '19', '70', '191', '322', '73', '26', '85', '320', '272', '28', '27', '10', '226', '212', '5'];
const colourOf = code => loader.getMaterial(code);
function swatches(codes, current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  for (const code of codes) {
    const m = colourOf(code);
    if (!m) continue;
    const b = document.createElement('button');
    b.style.background = '#' + m.color.getHexString(THREE.SRGBColorSpace);
    if (m.transparent) b.style.opacity = 0.6;
    b.title = (m.name || '').replace(/_/g, ' ') + ` (${code})`;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', code === current);
    b.addEventListener('click', () => onPick(code));
    wrap.append(b);
  }
  return wrap;
}

// Small DOM helpers for the panels.
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const section = (title, ...children) => { const s = el('section', 'section'); if (title) s.append(el('h3', null, title)); s.append(...children); return s; };
const stats = items => { const d = el('div', 'stats'); for (const [label, value, wide] of items) { const s = el('div', wide ? 'stat wide' : 'stat'); s.append(el('b', null, value), el('span', null, label)); if (wide) s.style.gridColumn = '1 / -1'; d.append(s); } return d; };
const icon = id => `<svg class="i"><use href="#${id}"/></svg>`;

let panelToken = 0;
async function refreshPanel() {
  if (mode !== 'build') return refreshObstacle();
  const token = ++panelToken;
  const props = $('#props');
  const frag = document.createDocumentFragment();
  const head = el('div', 'props-head');
  const h = el('h2');
  const sub = el('div', 'sub');
  head.append(h, sub);
  frag.append(head);

  if (selection.size > 1) {
    const objs = [...selection];
    const infos = await Promise.all(objs.map(o => partInfo(o.userData.file).catch(() => null)));
    if (token !== panelToken) return;
    h.textContent = `${objs.length} parts`;
    sub.textContent = 'Drag any of them to move them together';
    frag.append(stats([['grams', fmt(infos.reduce((s, i) => s + (i ? massGrams(i) : 0), 0), 1)]]),
      section(null, el('p', 'note', 'Use the buttons under the view to turn, move, copy or delete them. Shift-click adds or removes a part; double-click a part to select everything attached to it.')));
  } else if (!selected) {
    const parts = editor.parts();
    const infos = await Promise.all(parts.map(o => partInfo(o.userData.file).catch(() => null)));
    if (token !== panelToken) return;
    const grams = infos.reduce((s, i) => s + (i ? massGrams(i) : 0), 0);
    const size = editor.sizeMm();
    h.textContent = 'Your robot';
    sub.textContent = parts.length ? 'Click a part to see its details' : 'Nothing built yet';
    frag.append(stats([
      ['parts', fmt(parts.length)],
      ['grams', fmt(grams, 0)],
      ['mm tall', size ? fmt(size.y) : '–'],
      ['mm wide × long × tall', size ? `${fmt(size.x)} × ${fmt(size.z)} × ${fmt(size.y)}` : '–', true],
    ]));
    if (size) {
      // start-of-match size limits: WRO RoboMission 250 mm cube, FLL 12 in (305 mm) tall
      const badge = (ok, text, title) => `<span class="badge ${ok ? 'ok' : 'bad'}" title="${title}">${ok ? '✓' : '✕'} ${text}</span>`;
      frag.append(section('Competition size', el('div', 'badges',
        badge(size.x <= 250 && size.y <= 250 && size.z <= 250, 'WRO', 'WRO RoboMission: fits in a 250 mm cube at the start') +
        badge(size.y <= 305, 'FLL', 'FLL: no taller than 305 mm (12 in) at the start'))));
    }
    frag.append(section('Colour for new parts', swatches(COMMON_COLOURS, paint, code => { paint = code; refreshPanel(); })),
      section(null, el('p', 'note', 'Click a part in the list, then click in the view to put it down. Press <kbd>?</kbd> for every shortcut.')));
  } else {
    const obj = selected;
    const info = await partInfo(obj.userData.file).catch(() => null);
    await partSnaps(obj.userData.file).catch(() => null);
    if (token !== panelToken || !info) return;
    h.textContent = info.name || obj.userData.file;
    sub.textContent = `Part ${obj.userData.file.replace(/\.dat$/, '')}`;
    const s = info.box.getSize(new THREE.Vector3()).toArray().map(v => v * LDU * 1000).sort((a, b) => b - a);
    const studs = Math.round(s[0] / 4) / 2; // LEGO lengths come in whole and half studs (a 3L axle is 23.6 mm)
    const grams = massGrams(info);
    // how is it attached?
    const entries = modelEntries(new Set());
    const me = entries.findIndex(en => en.obj === obj);
    const links = findConnections(entries).filter(c => c.a === me || c.b === me);
    const others = new Set(links.map(c => (c.a === me ? c.b : c.a)));
    const kinds = { fixed: links.filter(c => c.kind === 'fixed').length, hinge: links.filter(c => c.kind === 'hinge').length };
    const hasSnaps = (snapsOf(obj.userData.file) || []).length > 0;
    const attached = others.size
      ? `<span class="badge ok">Attached to ${others.size} part${others.size > 1 ? 's' : ''}</span> <span class="sub">${[kinds.fixed && `${kinds.fixed} locked`, kinds.hinge && `${kinds.hinge} turning`].filter(Boolean).join(', ')}</span>`
      : hasSnaps ? '<span class="badge bad">Not connected</span>' : '<span class="badge">No pin or axle points</span>';
    frag.append(stats([
      ['grams', fmt(grams, grams < 10 ? 2 : 1)],
      ['studs long', fmt(studs, studs % 1 ? 1 : 0)],
      ['mm', `${s.map(v => fmt(v, 1)).join(' × ')}`, true],
    ]));

    const row = el('label', 'field row', '<span class="sub"></span><span class="unit"><input type="number" min="0" step="0.01"><i>g</i></span>');
    row.querySelector('.sub').textContent = weightSource(info);
    const input = row.querySelector('input');
    input.value = +grams.toFixed(2);
    input.title = 'Weighed your own? Type the grams here (0 = back to default).';
    input.addEventListener('change', () => { setWeightOverride(info.file, +input.value); refreshPanel(); });
    row.style.marginTop = '0';

    const pickColour = code => { paint = code; editor.recolor(obj, code).then(refreshPanel); };
    const more = el('details', null, '<summary>All LEGO colours</summary>');
    more.append(swatches(loader.materials.map(m => String(m.userData.code)).filter(c => +c >= 0 && c !== '16' && c !== '24'), obj.userData.color, pickColour));
    frag.append(section(null, el('div', 'badges', attached)),
      section('Colour', swatches(COMMON_COLOURS, obj.userData.color, pickColour), more),
      section('Mass', row));
  }
  props.replaceChildren(frag);
}


function button(label, onClick) {
  const b = document.createElement('button');
  b.innerHTML = label;
  b.addEventListener('click', onClick);
  return b;
}
editor.onChange(() => { if (mode === 'build') refreshPanel(); });

// ---------------------------------------------------------------- file actions (build)
const download = (name, text, type = 'text/plain') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const pickFile = (input, fn) => {
  input.onchange = () => { const f = input.files[0]; input.value = ''; if (f) fn(f); };
  input.click();
};
$('#save').addEventListener('click', () => download('robot.ldr', editor.serialize()));
const openModel = () => pickFile($('#file-model'), async f => { select(null); await editor.open(f); fitView(); });
$('#open').addEventListener('click', openModel);
$('#open-file').addEventListener('click', openModel);
const openExample = async () => { select(null); await editor.open(new File([exampleRobot], 'example drive base.ldr')); fitView(); };
$('#open-example').addEventListener('click', openExample);

// Bring everything into view: the robot in Build; the robot and the arena in Test.
function fitView() {
  const box = new THREE.Box3();
  if (mode === 'build') editor.parts().forEach(p => box.expandByObject(p));
  else { box.expandByObject(sim ? sim.visuals : robotStart); arena.items.forEach(it => box.expandByObject(it.obj)); }
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = Math.max((sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1, 0.12);
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(sphere.center.clone().addScaledVector(dir, dist), sphere.center, 500);
}
$('#fit').addEventListener('click', fitView);

$('#part-bar').addEventListener('click', async e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act || !selection.size) return;
  if (act === 'turn' || act === 'tip') turn90(act === 'tip');
  else if (act === 'up' || act === 'down') nudge(act === 'up' ? 'arrowup' : 'arrowdown', true);
  else if (act === 'copy') selectMany(await editor.duplicate([...selection]));
  else if (act === 'delete') { editor.remove([...selection]); select(null); }
});

// An empty build area says how to start, instead of showing nothing.
const refreshEmpty = () => { $('#empty').hidden = mode !== 'build' || !!placing || editor.parts().length > 0; };
editor.onChange(refreshEmpty);

// Help: every shortcut in one place (and once, the first time someone opens the app).
const helpSheet = $('#help-sheet');
$('#help').addEventListener('click', () => helpSheet.showModal());
helpSheet.querySelector('[data-close]').addEventListener('click', () => helpSheet.close());
helpSheet.addEventListener('click', e => { if (e.target === helpSheet) helpSheet.close(); }); // click outside closes

// Account: your initial in the top bar; click for your email, the home page and Log out.
$('#me').textContent = (user.name || user.email)[0].toUpperCase();
$('#me').title = `Signed in as ${user.email}`;
$('#me-email').textContent = user.email;
$('#me').addEventListener('click', () => { $('#me-menu').hidden = !$('#me-menu').hidden; });
addEventListener('pointerdown', e => { if (!e.target.closest('.account-menu')) $('#me-menu').hidden = true; });
$('#logout').addEventListener('click', async () => { await auth.logOut(); location.href = '/'; });
$('#new').addEventListener('click', () => {
  if (editor.parts().length && !confirm('Clear the model? (Undo can bring it back.)')) return;
  select(null);
  editor.clear();
});
$('#undo').addEventListener('click', () => { select(null); editor.undo(); });
$('#redo').addEventListener('click', () => { select(null); editor.redo(); });

// ---------------------------------------------------------------- modes
let mode = 'build';
let buildView = null;
const robotStart = new THREE.Group(); // where the robot starts in the arena (x, z, yaw)
const robotInner = new THREE.Group(); // centres the model over robotStart and rests it on the floor
let robotModel = null;
robotStart.add(robotInner);
robotStart.visible = false;
scene.add(robotStart);

function placeRobot() {
  robotInner.clear();
  robotModel = editor.model.clone();
  robotModel.visible = true; // the build model is hidden in Test mode; the clone must not inherit that
  for (const c of [...robotModel.children]) if (!c.userData.part) robotModel.remove(c); // editing helpers
  robotInner.add(robotModel);
  robotInner.position.set(0, 0, 0);
  robotInner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(robotModel);
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    robotInner.position.set(-c.x, -box.min.y + 0.0005, -c.z);
  }
  robotStart.position.set(arena.robotStart.x, 0, arena.robotStart.z);
  robotStart.rotation.set(0, arena.robotStart.yaw, 0);
  robotStart.visible = true;
  localBoxes.delete(robotStart);
}

async function setMode(m) {
  if (m === mode) return;
  cancelPlacing();
  select(null);
  hovered = null;
  mode = m;
  document.body.dataset.mode = m;
  $$('.seg button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m));
  const testing = m === 'test';
  refreshEmpty();
  showDock(dockTab === 'assistant' ? 'assistant' : lastDock[m]);
  editor.model.visible = studGrid.visible = bigGrid.visible = !testing;
  arena.group.visible = testing;
  setShadowArea(testing ? 1.6 : 0.4);
  setAoScale(testing ? 0.03 : 0.012);
  if (testing) {
    buildView = [camera.position.clone(), controls.target.clone()];
    placeRobot();
    const t = robotStart.position.clone().setY(0.04);
    await flyTo(t.clone().add(new THREE.Vector3(0.55, 0.5, 0.75)), t);
    refreshTelemetry();
  } else {
    stopSim();
    robotStart.visible = false;
    if (buildView) await flyTo(buildView[0], buildView[1]);
    refreshPanel();
  }
}
$$('.seg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ---------------------------------------------------------------- arena panel (test)
$$('[data-add]').forEach(b => b.addEventListener('click', () => {
  const obj = arena.add(b.dataset.add);
  // 30 cm ahead of where the camera looks, so it doesn't land on the robot
  const ahead = controls.target.clone().sub(camera.position).setY(0).setLength(0.3);
  obj.position.set(controls.target.x + ahead.x, 0, controls.target.z + ahead.z);
  arena.autosave();
  select(obj);
}));
// Mats: every picture you upload is kept in My mats, so you can switch between them.
$('#mat-file').addEventListener('click', () => pickFile($('#file-mat'), f => uploadFiles([f])));
async function useMat(rec) {
  await arena.setMat(rec?.data, +$('#mat-width').value || FLL_MAT_MM[0], rec?.id);
  arena.autosave();
  renderMats();
  if (rec) toast(`Mat ${rec.name}: ${fmt(arena.mat.widthMm)} × ${fmt(arena.mat.heightMm)} mm`);
}
async function renderMats() {
  const mats = (await listModels().catch(() => [])).filter(r => r.kind === 'mat');
  const tile = (rec, label) => {
    const li = el('li');
    const b = el('button', 'pick');
    b.setAttribute('aria-pressed', (arena.mat?.id ?? null) === (rec?.id ?? null) && (!!arena.mat === !!rec));
    b.title = rec ? `Use ${rec.name}` : 'No mat: plain floor';
    if (rec?.thumb) b.append(Object.assign(new Image(), { src: rec.thumb, alt: rec.name }));
    else b.append(el('span', null, label));
    b.addEventListener('click', () => useMat(rec));
    li.append(b);
    if (rec) {
      const del = button(icon('i-x'), async () => { if (!confirm(`Remove ${rec.name} from My mats?`)) return; await deleteModel(rec.id); renderMats(); });
      del.className = 'remove';
      del.title = `Remove ${rec.name} from My mats`;
      del.setAttribute('aria-label', del.title);
      li.append(del);
    }
    return li;
  };
  $('#mats').replaceChildren(...(mats.length ? [tile(null, 'None'), ...mats.map(r => tile(r))] : []));
  $('#mat-size').hidden = !arena.mat;
}
$('#mat-width').addEventListener('change', async () => { await arena.setMatWidth(+$('#mat-width').value); arena.autosave(); });
$('#mat-fll').addEventListener('click', async () => {
  $('#mat-width').value = FLL_MAT_MM[0];
  if (!arena.mat) return;
  await arena.setMatWidth(FLL_MAT_MM[0]);
  if (Math.abs(arena.mat.heightMm - FLL_MAT_MM[1]) > 15) toast(`Heads up: this picture's shape makes it ${fmt(arena.mat.heightMm)} mm deep, not 1143 mm. Crop it to the mat's edges for exact scale.`);
  arena.autosave();
});
$('#arena-save').addEventListener('click', () => download('arena.json', JSON.stringify(arena.toJSON()), 'application/json'));
$('#arena-load').addEventListener('click', () => pickFile($('#file-arena'), async f => {
  try {
    select(null);
    await arena.load(JSON.parse(await f.text()));
    placeRobot();
    arena.autosave();
    renderMats();
  } catch { toast('That file is not an arena saved by this app.'); }
}));
$('#arena-clear').addEventListener('click', async () => {
  if (!confirm('Remove all obstacles and the mat?')) return;
  select(null);
  await arena.load({ items: [], robotStart: arena.robotStart });
  arena.autosave();
  renderMats();
});

function refreshObstacle() {
  const card = $('#obstacle');
  const def = selected?.userData.obstacle && arena.defOf(selected);
  card.hidden = !def;
  if (!def) return;
  const lego = def.type === 'ldraw';
  const size = lego && localBox(selected)?.getSize(new THREE.Vector3());
  $('#ob-title').textContent = def.name || { box: 'Box', wall: 'Wall', ramp: 'Ramp', cylinder: 'Can', mesh: '3D model' }[def.type] || 'Obstacle';
  $$('[data-size]').forEach(inp => {
    inp.disabled = lego; // LEGO models are their real size
    if (document.activeElement !== inp) inp.value = lego ? Math.round(size.getComponent(+inp.dataset.size) * 1000) : Math.round(selected.scale.getComponent(+inp.dataset.size) * (def.type === 'mesh' ? 100 : 1000));
    inp.closest('label').querySelector('.unit i').textContent = def.type === 'mesh' ? '%' : 'mm';
  });
  $('#ob-push').checked = !def.fixed;
  $('#ob-mass').value = def.massG;
  $('#ob-mass-row').hidden = def.fixed;
}
$$('[data-size]').forEach(inp => inp.addEventListener('change', () => {
  const def = arena.defOf(selected);
  if (!def || !(+inp.value > 0)) return;
  selected.scale.setComponent(+inp.dataset.size, +inp.value / (def.type === 'mesh' ? 100 : 1000));
  localBoxes.delete(selected);
  arena.autosave();
}));
$('#ob-push').addEventListener('change', () => { arena.defOf(selected).fixed = !$('#ob-push').checked; refreshObstacle(); arena.autosave(); });
$('#ob-mass').addEventListener('change', () => { arena.defOf(selected).massG = Math.max(1, +$('#ob-mass').value); arena.autosave(); });
$('#ob-delete').addEventListener('click', () => { arena.remove(selected); select(null); arena.autosave(); });

// Drop files on the 3D view: models in Build; meshes, mat images or arenas in Test.
view.addEventListener('dragover', e => e.preventDefault());
view.addEventListener('drop', async e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const name = f.name.toLowerCase();
  if (/\.(ldr|mpd|io|dat)$/.test(name) && mode === 'build') {
    select(null);
    return editor.open(f);
  }
  if (/\.(ldr|mpd|io|stl|glb|gltf|obj)$/.test(name)) {
    // a model: keep it in My models and put it straight into the arena (or the robot, for LEGO in Build)
    const [rec] = (await uploadFiles([f])) || [];
    if (rec) useModel(rec);
  } else if (f.type.startsWith('image/')) {
    await uploadFiles([f]); // becomes a mat (and goes down straight away in Test)
  } else if (mode !== 'test') return toast('Switch to Test to drop an arena file.');
  else if (name.endsWith('.json')) {
    try { await arena.load(JSON.parse(await f.text())); placeRobot(); arena.autosave(); } catch { toast('That file is not an arena saved by this app.'); }
  } else toast(`Don't know what to do with ${f.name}.`);
});

// ---------------------------------------------------------------- simulation
let sim = null, paused = false, starting = false;
const keys = new Set();

async function play() {
  if (sim) { paused = !paused; updatePlayButton(); return; }
  if (starting) return;
  starting = true;
  select(null);
  try {
    arena.savePoses();
    sim = await createSim(robotStart, arena, { reverse: $('#reverse').checked, ports: loadChoices(PORTS_KEY), roles: loadChoices(ROLES_KEY) });
    sim.setSpeed(+$('#speed').value / 100);
    sim.setTurnSpeed(+$('#turn-speed').value / 100);
    sim.setStopMode($('#stop-mode').value);
    robotStart.visible = false;
    scene.add(sim.visuals);
    paused = false;
    document.activeElement?.blur(); // so Space toggles pause instead of re-clicking the Play button
  } catch (err) {
    sim = null;
    toast(err.message || 'Could not start the simulation.');
    console.error(err);
  }
  starting = false;
  updatePlayButton();
  refreshTelemetry();
}
function stopSim() {
  runner.stop();
  glowOn(null);
  if (!sim) return;
  scene.remove(sim.visuals);
  sim.dispose();
  sim = null;
  arena.restorePoses();
  robotStart.visible = mode === 'test';
  $('#hud').classList.remove('on');
  $('#hub-display').textContent = '';
  updatePlayButton();
  refreshTelemetry();
}
function updatePlayButton() {
  $('#play use').setAttribute('href', sim && !paused ? '#i-pause' : '#i-play');
  $('#play span').textContent = !sim ? 'Play' : paused ? 'Resume' : 'Pause';
}
$('#play').addEventListener('click', play);
$('#reset').addEventListener('click', stopSim);

// Driving settings are remembered between visits.
const DRIVE_KEY = 'studio.drive';
const DRIVE_INPUTS = ['speed', 'turn-speed', 'stop-mode', 'follow', 'reverse'];
const valueOf = inp => (inp.type === 'checkbox' ? inp.checked : inp.value);
try {
  const saved = JSON.parse(localStorage.getItem(DRIVE_KEY)) || {};
  for (const id of DRIVE_INPUTS) if (id in saved) $('#' + id)[$('#' + id).type === 'checkbox' ? 'checked' : 'value'] = saved[id];
} catch { /* defaults */ }
const showDrive = () => { $('#speed-out').textContent = `${$('#speed').value} %`; $('#turn-out').textContent = `${$('#turn-speed').value} %`; };
showDrive();
DRIVE_INPUTS.forEach(id => $('#' + id).addEventListener('change', () => {
  try { localStorage.setItem(DRIVE_KEY, JSON.stringify(Object.fromEntries(DRIVE_INPUTS.map(x => [x, valueOf($('#' + x))])))); } catch { /* ignore */ }
}));
$('#speed').addEventListener('input', () => { showDrive(); sim?.setSpeed(+$('#speed').value / 100); });
$('#turn-speed').addEventListener('input', () => { showDrive(); sim?.setTurnSpeed(+$('#turn-speed').value / 100); });
$('#reverse').addEventListener('change', () => { if (sim) { stopSim(); play(); } });
$('#stop-mode').addEventListener('change', () => sim?.setStopMode($('#stop-mode').value));

// Each device's port and job are remembered (by part + where it sits), so they survive Reset and reloads.
const PORTS_KEY = 'studio.ports', ROLES_KEY = 'studio.roles';
const loadChoices = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
function saveChoice(k, key, value, unique) {
  const all = loadChoices(k);
  if (unique) for (const x of Object.keys(all)) if (all[x] === value) delete all[x]; // one device per port
  if (value) all[key] = value; else delete all[key];
  try { localStorage.setItem(k, JSON.stringify(all)); } catch { /* kept for this session only */ }
}

const READING = {
  color: v => v && (v.color >= 0 ? `${COLOUR_NAMES[v.color] || v.color} · ${v.reflection} %` : `no colour · ${v.reflection} %`),
  distance: v => (v >= 0 ? `${v} mm` : 'nothing in range'),
  force: v => v && `${v.pressed ? 'pressed' : 'not pressed'} · ${v.force} N`,
  gyro: v => `${fmt(v ?? 0, 1)}°`,
};
const COLOUR_NAMES = { 0: 'black', 1: 'magenta', 3: 'blue', 4: 'azure', 6: 'green', 7: 'yellow', 9: 'red', 10: 'white' };
const SENSOR_LABEL = { color: 'Colour sensor', distance: 'Distance sensor', force: 'Force sensor', gyro: 'Gyro sensor' };
const ROLE_LABEL = { left: 'Left wheel', right: 'Right wheel', centre: 'Middle wheel', aux: 'Arm or attachment' };
const kbd = s => s.split(' ').map(x => `<kbd>${x}</kbd>`).join('');

// The ports the blocks start on, and how far one motor turn drives the robot.
function robotPorts() {
  const t = sim?.telemetry();
  if (!t) return {};
  const left = t.motors.find(m => m.role === 'left' && m.port), right = t.motors.find(m => m.role === 'right' && m.port);
  const sensor = type => t.sensors.find(s => s.type === type && s.port)?.port;
  const d = left || right;
  return {
    left: left?.port, right: right?.port, arm: t.motors.find(m => m.role === 'aux' && m.port)?.port,
    color: sensor('color'), distance: sensor('distance'), force: sensor('force'),
    cmPerRotation: d?.wheelMm ? (Math.PI * d.wheelMm * (d.ratio || 1)) / 10 : undefined,
  };
}

let telemetryShape = null;
function refreshTelemetry() {
  const list = $('#telemetry');
  const t = sim?.telemetry();
  $('#stats').innerHTML = [
    [t ? fmt(t.speed * 1000) : '–', 'mm/s'], [t ? `${fmt(t.imu[0], 0)}°` : '–', 'heading'], [t ? fmt(t.distance * 1000) : '–', 'mm driven'],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  if (!t) {
    if (telemetryShape !== '') {
      telemetryShape = '';
      list.replaceChildren(el('p', 'note', 'Press <b>Play</b> to see your robot\'s motors and sensors, then set each one\'s port to match the real robot.'));
      list.firstChild.style.marginTop = '0';
      renderKeys(null);
    }
    return;
  }
  // rebuild the cards only when something about them changes, so the dropdowns stay usable
  const shape = JSON.stringify([...t.motors, ...t.sensors].map(d => [d.key, d.port, d.role, d.keys]));
  if (shape !== telemetryShape) {
    telemetryShape = shape;
    const frag = document.createDocumentFragment();
    for (const d of [...t.motors.filter(m => !m.assumed), ...t.sensors]) {
      const card = el('div', 'device');
      card.dataset.key = d.key;
      const who = el('div', 'who', '<b></b><span class="sub"></span>');
      const [, short, family] = d.name.match(/^(.*?)(?:\s*\((.*)\))?$/); // "Large Angular Motor", "SPIKE / Inventor"
      who.firstChild.textContent = short;
      who.firstChild.title = d.name;
      who.lastChild.textContent = d.role
        ? [d.keys ? `keys ${d.keys.join(' ').toUpperCase()}` : null, d.wheelMm && `${fmt(d.wheelMm, 1)} mm wheel`, d.ratio && d.ratio !== 1 && `${fmt(d.ratio, 2)} : 1 gears`].filter(Boolean).join(' · ') || family || 'motor'
        : family || SENSOR_LABEL[d.type];
      const port = el('select', 'port', '<option value="">–</option>' + ['A', 'B', 'C', 'D', 'E', 'F'].map(p => `<option${p === d.port ? ' selected' : ''}>${p}</option>`).join(''));
      port.title = 'Which port it\'s plugged into on the hub';
      port.setAttribute('aria-label', `Port for ${d.name}`);
      port.addEventListener('change', () => { saveChoice(PORTS_KEY, d.key, port.value, true); sim?.setPort(d.key, port.value); refreshTelemetry(); });
      card.append(who, port);
      if (d.role) {
        const roles = ['left', 'right', 'aux', ...(d.role === 'centre' ? ['centre'] : [])];
        const role = el('select', 'role', roles.map(r => `<option value="${r}"${r === d.role ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join(''));
        role.title = 'What this motor does when you drive with the keyboard';
        role.setAttribute('aria-label', `Job for ${d.name}`);
        role.addEventListener('change', () => { saveChoice(ROLES_KEY, d.key, role.value); sim?.setRole(d.key, role.value); refreshTelemetry(); });
        card.append(role, el('div', 'reading', '<span></span><span></span>'), el('div', 'load', '<i></i>'));
      } else card.append(el('div', 'reading', '<span></span>'));
      // point at a card to see which part it is
      card.addEventListener('mouseenter', () => glowOn(sim?.objectOf(d.key)));
      card.addEventListener('mouseleave', () => glowOn(null));
      frag.append(card);
    }
    if (!t.motors.length) frag.append(el('p', 'note', 'No motors found. Add a motor and put an axle through its output.'));
    if (t.assumedMotor) frag.append(el('p', 'note', 'There are no motor parts in the model, so each wheel gets a SPIKE Large Motor.'));
    for (const n of t.notes) frag.append(el('p', 'note', n));
    const warn = el('p', 'warn', 'Tipped over! Press Reset.');
    warn.dataset.v = 'tipped';
    frag.append(warn);
    list.replaceChildren(frag);
    renderKeys(t);
    blocks?.setPorts(robotPorts());
  }
  list.querySelector('[data-v="tipped"]').hidden = !t.tipped;
  for (const d of [...t.motors, ...t.sensors]) {
    const r = list.querySelector(`.device[data-key="${CSS.escape(d.key)}"] .reading`);
    if (!r) continue;
    if (d.role) {
      r.firstChild.textContent = `${d.angle}°`;
      r.lastChild.textContent = d.idle ? 'nothing attached' : `${d.dps} °/s`;
      const bar = r.nextElementSibling.firstChild;
      bar.style.transform = `scaleX(${Math.min(1, d.load)})`;
      bar.classList.toggle('hot', d.load > 0.85);
      bar.parentElement.title = `Load: ${fmt(d.load * 100)} % of what the motor can do`;
    } else r.firstChild.textContent = READING[d.type]?.(d.value) ?? '';
  }
  $('#hud').innerHTML = `<b>${fmt(t.speed * 1000)}</b>mm/s`;
  $('#hud').classList.add('on');
  $('#hub-display').textContent = sim.api.displayText;
}
function renderKeys(t) {
  const row = (keysHtml, text) => `<div>${keysHtml}<span>${text}</span></div>`;
  $('#keys').innerHTML = row(kbd('W S'), 'forward and back') + row(kbd('A D'), 'turn') + row(kbd('Shift'), 'hold to drive slowly') +
    (t?.motors.filter(m => m.keys) || []).map(m => row(kbd(m.keys.join(' ').toUpperCase()), `${m.port ? `port ${m.port}` : 'arm'} motor`)).join('') +
    row(kbd('Space'), 'play and pause') + row(kbd('Esc'), 'reset');
}
setInterval(() => { if (sim && !paused) refreshTelemetry(); }, 150);

// ---------------------------------------------------------------- code tab
const CODE_KEY = 'studio.code';
const codeBox = $('#code');
try { codeBox.value = localStorage.getItem(CODE_KEY) || EXAMPLE_PROGRAM; } catch { codeBox.value = EXAMPLE_PROGRAM; }
codeBox.addEventListener('input', () => { try { localStorage.setItem(CODE_KEY, codeBox.value); } catch { /* ignore */ } });
codeBox.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  e.preventDefault(); // Python needs real indentation: Tab inserts four spaces
  const { selectionStart: a, selectionEnd: b, value } = codeBox;
  codeBox.value = value.slice(0, a) + '    ' + value.slice(b);
  codeBox.selectionStart = codeBox.selectionEnd = a + 4;
  codeBox.dispatchEvent(new Event('input'));
});
const consoleEl = $('#console');
function printLine(text, error) {
  const line = document.createElement('div');
  if (error) line.className = 'err';
  line.textContent = text;
  consoleEl.append(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
const runner = createRunner({
  getSim: () => sim,
  onPrint: printLine,
  onState: state => {
    $('#run span').textContent = state === 'loading' ? 'Starting…' : state === 'running' ? 'Running' : 'Run';
    $('#run').disabled = state !== 'idle';
  },
});

// Blocks or Python. Blocks become SPIKE Python when you press Run (Blockly loads the first time it's needed).
const KIND_KEY = 'studio.codeKind';
let codeKind = 'blocks';
try { codeKind = localStorage.getItem(KIND_KEY) === 'python' ? 'python' : 'blocks'; } catch { /* default */ }
async function showCodeKind(kind) {
  codeKind = kind;
  try { localStorage.setItem(KIND_KEY, kind); } catch { /* ignore */ }
  $$('#code-kind button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === kind));
  $('#blocks').hidden = kind !== 'blocks';
  codeBox.hidden = kind !== 'python';
  $('#to-python').hidden = kind !== 'blocks';
  $('#code-note').textContent = kind === 'blocks' ? 'Runs as SPIKE Python' : 'SPIKE Prime 3 Python';
  if (kind === 'blocks' && !blocks) {
    const { createBlocks } = await import('./blocks.js');
    blocks ??= createBlocks($('#blocks'), null, theme === 'dark');
    blocks.setPorts(robotPorts());
  }
  blocks?.resize();
}
$$('#code-kind button').forEach(b => b.addEventListener('click', () => showCodeKind(b.dataset.kind)));
const blocksPython = () => blocks?.toPython(robotPorts());

$('#run').addEventListener('click', async () => {
  consoleEl.replaceChildren();
  if (!sim) await play();
  if (!sim) return;
  if (paused) play(); // a paused world would never run the program
  const code = codeKind === 'blocks' ? blocksPython() : codeBox.value;
  if (!code) return printLine('Put your blocks under a "when program starts" block (in Events).', true);
  runner.run(code);
});
$('#stop').addEventListener('click', () => runner.stop());
$('#example').addEventListener('click', () => {
  if (codeKind === 'blocks') {
    if (confirm('Replace your blocks with the example?')) blocks?.example();
    return;
  }
  if (codeBox.value !== EXAMPLE_PROGRAM && !confirm('Replace your program with the example?')) return;
  codeBox.value = EXAMPLE_PROGRAM;
  codeBox.dispatchEvent(new Event('input'));
});
$('#to-python').addEventListener('click', () => {
  const code = blocksPython();
  if (!code) return toast('Put your blocks under a "when program starts" block first.');
  if (codeBox.value.trim() && codeBox.value !== EXAMPLE_PROGRAM && !confirm('Replace your Python program with these blocks?')) return;
  codeBox.value = code;
  codeBox.dispatchEvent(new Event('input'));
  showCodeKind('python');
});
// ---------------------------------------------------------------- the dock (right panel tabs) and the side panels
// Build: Part | Assistant. Test: Drive | Code | Assistant. Each mode remembers its last tab; the assistant stays open across both.
let dockTab = 'part';
const lastDock = { build: 'part', test: 'drive' };
function showDock(name) {
  dockTab = name;
  if (name !== 'assistant') lastDock[mode] = name;
  $$('[data-dock]').forEach(b => b.setAttribute('aria-selected', b.dataset.dock === name));
  $$('[data-dock-body]').forEach(x => { x.hidden = x.dataset.dockBody !== name; });
  $('#assist-open').setAttribute('aria-pressed', name === 'assistant');
  document.body.classList.toggle('wide-right', name === 'code'); // the block editor gets room to breathe
  if (name === 'code') showCodeKind(codeKind);
}
$$('[data-dock]').forEach(b => b.addEventListener('click', () => showDock(b.dataset.dock)));
showDock('part');
function showPanel(side, on) {
  document.body.classList.toggle(`hide-${side}`, !on);
  $(`#toggle-${side}`).setAttribute('aria-pressed', on);
  try { localStorage.setItem(`studio.panel.${side}`, on ? '1' : '0'); } catch { /* ignore */ }
}
for (const side of ['left', 'right']) {
  try { if (localStorage.getItem(`studio.panel.${side}`) === '0') showPanel(side, false); } catch { /* shown */ }
  $(`#toggle-${side}`).addEventListener('click', () => showPanel(side, document.body.classList.contains(`hide-${side}`)));
}

// ---------------------------------------------------------------- keyboard
// Keys belong to the block editor after you click in it (Delete removes a block there, not an obstacle).
let inBlocks = false;
addEventListener('pointerdown', e => { inBlocks = !!e.target.closest?.('.blocks, .blocklyWidgetDiv, .blocklyDropDownDiv'); }, true);
const typing = e => inBlocks || e.target.closest?.('input, select, textarea, dialog');
const DRIVE_KEYS = ['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e', 'z', 'c', 'r', 'f', 't', 'g', 'shift'];
addEventListener('keydown', e => {
  if (typing(e)) return;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === '?') { helpSheet.showModal(); return; }
  if (e.key === '/') { e.preventDefault(); openAssistant(); return; }
  if (e.key === '[' || e.key === ']') { const side = e.key === '[' ? 'left' : 'right'; showPanel(side, document.body.classList.contains(`hide-${side}`)); return; }
  if (mode === 'test' && sim && !mod) {
    if (DRIVE_KEYS.includes(k)) {
      keys.add(k);
      e.preventDefault();
      return;
    }
  }
  if (mode === 'test') {
    if (k === ' ') { e.preventDefault(); play(); return; }
    if (k === 'escape' && sim) { stopSim(); return; }
  }
  if (mode === 'build') {
    if (k === 'escape') { if (placing) cancelPlacing(); else select(null); return; }
    if (mod && k === 'z') { e.preventDefault(); cancelPlacing(); select(null); e.shiftKey ? editor.redo() : editor.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); cancelPlacing(); select(null); editor.redo(); return; }
    if (mod && k === 'd' && selection.size) { e.preventDefault(); editor.duplicate([...selection]).then(selectMany); return; }
    if (mod && k === 'a') { e.preventDefault(); selectMany(editor.parts()); return; }
    if (k.startsWith('arrow') || k === 'pageup' || k === 'pagedown') {
      if (!selection.size || placing) return;
      e.preventDefault();
      const vertical = k.startsWith('page') || (e.shiftKey && (k === 'arrowup' || k === 'arrowdown'));
      nudge(k === 'pageup' ? 'arrowup' : k === 'pagedown' ? 'arrowdown' : k, vertical);
      return;
    }
    if (k === 'r' && selection.size) { turn90(e.shiftKey); return; }
    if (k === 'c' && !mod) { setAutoConnect(!autoConnectOn); return; }
    if ((k === 'delete' || k === 'backspace') && selection.size && !placing) { editor.remove([...selection]); select(null); return; }
  } else {
    if (k === 'r') setGizmoMode('rotate');
    else if (k === 's' && !sim) setGizmoMode('scale');
    else if (k === 'escape') select(null);
    else if ((k === 'delete' || k === 'backspace') && selected && selected !== robotStart) { arena.remove(selected); arena.autosave(); select(null); }
  }
  if (k === 'm') setGizmoMode('translate');
  else if (k === 'f' && selected) {
    const c = new THREE.Box3().setFromObject(selected).getCenter(new THREE.Vector3());
    flyTo(c.clone().add(camera.position.clone().sub(controls.target).setLength(mode === 'build' ? 0.18 : 0.6)), c, 450);
  } else if (k === 'f') fitView();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock();
const follow = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (sim && !paused) {
    const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const turn = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    sim.setInput(fwd, turn, keys);
    sim.update(dt);
    if ($('#follow').checked) {
      // ease the camera after the robot instead of bolting it on
      follow.copy(sim.focus()).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 5));
      controls.target.add(follow);
      camera.position.add(follow);
    }
  }
  if (drag?.target) glideDrag(dt);
  controls.update();
  floorGrid.visible = mode === 'test' && !arena.mat; // a mat covers the floor; the grid would flicker through it
  sun.position.copy(controls.target).add(SUN_OFFSET);
  sun.target.position.copy(controls.target);
  let n = 0;
  for (const obj of selection) {
    if (!selOutlines[n]) selOutlines[n] = makeOutline(SELECT_BLUE, 0.95);
    fitOutline(selOutlines[n++], obj);
  }
  for (; n < selOutlines.length; n++) selOutlines[n].visible = false;
  fitOutline(hoverOutline, hovered && !selection.has(hovered) ? hovered : null);
  runner.frame();
  composer.render();
});

// ---------------------------------------------------------------- assistant
const assistantEl = $('#assistant');
function openAssistant() {
  showPanel('right', true);
  showDock('assistant');
  assistant.focus();
}
$('#assist-open').addEventListener('click', () => (dockTab === 'assistant' ? showDock(lastDock[mode]) : openAssistant()));

// A picture to build from, pinned in the corner of the view.
const reference = $('#reference');
function showReference(src) {
  reference.querySelector('img')?.remove();
  reference.prepend(Object.assign(new Image(), { src, alt: 'Your reference picture' }));
  reference.hidden = false;
}
reference.addEventListener('click', e => {
  const act = e.target.closest('[data-ref]')?.dataset.ref;
  if (act === 'close') reference.hidden = true;
  else if (act === 'grow' || e.target.tagName === 'IMG') reference.classList.toggle('big');
});

const assistant = createAssistant(assistantEl, {
  editor, setMode, setTheme, fit: fitView, openExample, reset: stopSim,
  mode: () => mode,
  selection: () => [...selection],
  select: objs => (objs.length ? selectMany(objs) : select(null)),
  turn: tilt => turn90(tilt),
  // new parts settle into place, like parts put down by hand
  drop: objs => {
    const ends = objs.map(o => o.position.clone());
    return tween(280, k => objs.forEach((o, i) => { o.position.set(ends[i].x, ends[i].y - 30 * (1 - k), ends[i].z); o.updateMatrix(); }), easeOutBack);
  },
  async play(on) {
    if (on && !sim) await play();
    else if (sim && paused === on) play(); // play() toggles pause
  },
  async addObstacle(type, i, rel) {
    if (mode !== 'test') await setMode('test');
    const obj = arena.add(type);
    if (rel === 'front') { // ahead of where the robot starts and faces
      const { x, z, yaw } = arena.robotStart, d = 0.35 + i * 0.2;
      obj.position.set(x + Math.sin(yaw) * d, 0, z + Math.cos(yaw) * d);
    } else {
      const ahead = controls.target.clone().sub(camera.position).setY(0).setLength(0.3 + i * 0.2);
      obj.position.set(controls.target.x + ahead.x, 0, controls.target.z + ahead.z);
    }
    arena.autosave();
    select(obj);
  },
  showReference,
  // a picture or a LEGO/3D file handed to the assistant: same as uploading it
  async upload(file) { return (await uploadFiles([file]))?.[0] || null; },
  useModel,
  useMat,
  async stats() {
    const parts = editor.parts();
    const infos = await Promise.all(parts.map(o => partInfo(o.userData.file).catch(() => null)));
    const size = editor.sizeMm();
    return { parts: parts.length, grams: infos.reduce((g, i) => g + (i ? massGrams(i) : 0), 0), size: size ? [size.x, size.z, size.y].map(Math.round) : null };
  },
  // drive as a SPIKE program, the same one the blocks would make
  async drive(steps) {
    if (mode !== 'test') await setMode('test');
    if (!sim) await play();
    if (!sim) return 'The robot couldn\'t start. Check it has motors and wheels.';
    if (paused) play();
    const ports = robotPorts();
    if (!ports.left || !ports.right) {
      const driving = sim.telemetry().motors.filter(m => m.role === 'left' || m.role === 'right');
      return driving.length < 2
        ? `Only ${driving.length} motor${driving.length === 1 ? '' : 's'} turn${driving.length === 1 ? 's' : ''} a wheel, so the robot can't drive straight or steer. Check each drive motor has an axle going into its wheel; the Drive tab shows what each motor is doing.`
        : 'Give the left and right wheel motors a port in the Drive tab, then ask again.';
    }
    const { stepsToPython } = await import('./blocks.js');
    runner.run(stepsToPython(steps, ports));
  },
});

if (import.meta.env?.DEV) window.studio = { editor, arena, getSim: () => sim, select, selectMany, runner, assistant, camera, canvas: renderer.domElement };  // console poking during development only

// ---------------------------------------------------------------- start
(async () => {
  try {
    await initParts();
  } catch (err) {
    $('#loading').textContent = err.message;
    return;
  }
  for (const rec of await listModels().catch(() => [])) if (rec.kind === 'part') registerPart(rec);
  let saved = null;
  try { saved = localStorage.getItem('studio.filter'); } catch { /* ignore */ }
  setFilter(saved === 'mine' || FILTERS[saved] ? saved : 'technic');
  renderArenaModels();
  await editor.loadAutosave();
  await arena.loadAutosave();
  if (arena.mat) $('#mat-width').value = arena.mat.widthMm;
  renderMats();
  if (editor.parts().length) fitView(); // start looking at your robot, not at empty floor
  refreshPanel();
  refreshTelemetry();
  $('#loading').classList.add('done');
  // first visit: show how it works
  try { if (!localStorage.getItem('studio.welcomed')) { localStorage.setItem('studio.welcomed', '1'); helpSheet.showModal(); } } catch { /* ignore */ }
})();
