import * as THREE from 'three';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';

// 1 LDraw unit = 0.4 mm, so 1 stud = 20 LDU = 8 mm. Every size in the app comes from this one number.
export const LDU = 0.0004; // metres

export const loader = new LDrawLoader(new THREE.LoadingManager());
export const catalog = new Map(); // file -> { file, name, cat }
// Where library files live; filled by initParts. ldrawUrl/shadowUrl take a name as LDraw references it ("s/3001s01.dat").
export const lib = { primSet: new Set(), shadowSet: new Set(), bearingSet: new Set(), ldrawUrl: null, shadowUrl: null };

let ready = null;

// base: where parts.json and ldraw/ are served from ('' in the browser, an http URL in tests).
export function initParts(base = '') {
  ready ??= (async () => {
    const res = await fetch(base + 'parts.json');
    if (!res.ok) throw new Error('parts.json missing: run "npm run index-parts"');
    const { parts, prims, shadow = [], bearing = [] } = await res.json();
    for (const [file, name, cat] of parts) catalog.set(file, { file, name, cat });
    const primSet = new Set(prims);
    const root = new URL(base ? base : location.href);
    const resolve = name => (primSet.has(name) ? 'p/' : 'parts/') + name;
    Object.assign(lib, {
      primSet, shadowSet: new Set(shadow), bearingSet: new Set(bearing),
      resolve,
      ldrawUrl: name => new URL('ldraw/' + resolve(name), root).href,
      shadowUrl: name => new URL('ldcad/' + resolve(name), root).href,
    });
    // LDrawLoader guesses folders (parts/, p/, models/) and 404s its way through them; send each .dat straight to where it lives.
    loader.manager.setURLModifier(url => {
      const m = url.match(/^(.*\/ldraw\/)(?:(?:parts|p|models)\/)*(.+\.dat)$/i);
      if (!m) return url;
      const name = m[2].toLowerCase();
      return m[1] + (primSet.has(name) ? 'p/' : 'parts/') + name;
    });
    loader.setPartsLibraryPath(new URL('ldraw/', base ? base : location.href).href);
    await loader.preloadMaterials(new URL('ldraw/LDConfig.ldr', base ? base : location.href).href);
    // LEGO ABS is a glossy, slightly clear-coated plastic: sharpen the highlights a little
    for (const m of loader.materials) if (m.isMeshStandardMaterial && m.metalness === 0 && m.roughness < 0.5) m.roughness = 0.22;
  })();
  return ready;
}

// Edge lines live on layer 1 so the view can switch between a realistic look and an instruction-book look.
export const LINE_LAYER = 1;
const rubber = new Map();
function finish(group, file) {
  const tyre = isWheelPart(catalog.get(file) || { name: '' });
  group.traverse(o => {
    if (o.isLineSegments) o.layers.set(LINE_LAYER);
    // tyres are matte rubber, not shiny plastic (only the dark, tyre-coloured surfaces of a wheel)
    if (tyre && o.isMesh) {
      const fix = m => {
        if (!m?.isMeshStandardMaterial || m.color.getHSL({}).l > 0.12) return m;
        if (!rubber.has(m)) rubber.set(m, Object.assign(m.clone(), { roughness: 0.85 }));
        return rubber.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    }
  });
  return group;
}

// One template per file+colour; callers get cheap clones that share geometry and materials.
const templates = new Map();
export function loadPart(file, color = '71') {
  const key = file + '|' + color;
  if (!templates.has(key)) {
    templates.set(key, new Promise((resolve, reject) => {
      loader.parse(`1 ${color} 0 0 0 1 0 0 0 1 0 0 0 1 ${file}`, group => resolve(finish(group, file)), reject);
    }).catch(err => {
      templates.delete(key);
      throw err;
    }));
  }
  return templates.get(key).then(t => t.clone());
}

// Geometry facts used by physics: bounding box (LDU), hull points (LDU), solid volume (mm³).
const infos = new Map();
export function partInfo(file) {
  if (!infos.has(file)) {
    infos.set(file, loadPart(file, '16').then(group => {
      group.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const seen = new Set();
      const pts = [];
      let vol6 = 0;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const tris = [];
      group.traverse(o => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position;
        const idx = o.geometry.index;
        const n = idx ? idx.count : pos.count;
        const vert = (i, v) => v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        for (let i = 0; i + 2 < n; i += 3) {
          vert(i, a); vert(i + 1, b); vert(i + 2, c);
          tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          vol6 += a.dot(b.clone().cross(c));
          for (const v of [a, b, c]) {
            box.expandByPoint(v);
            const k = `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`;
            if (!seen.has(k)) { seen.add(k); pts.push(v.x, v.y, v.z); }
          }
        }
      });
      const mm3 = Math.abs(vol6 / 6) * 0.064; // LDU³ -> mm³
      return { file, box, points: new Float32Array(pts), tris: new Float32Array(tris), volumeMm3: mm3, ...catalog.get(file) };
    }));
  }
  return infos.get(file);
}

// ---- thumbnails: one shared offscreen renderer, one job at a time ----
let thumbRenderer, thumbScene, thumbCam, queue = Promise.resolve();
const thumbs = new Map();

// Renders any object (a part, a whole model, a 3D mesh) to a small image.
export function renderThumb(object, size = 96) {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbScene = new THREE.Scene();
    thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    thumbScene.add(sun);
    thumbCam = new THREE.PerspectiveCamera(30, 1, 0.0001, 100000);
    thumbCam.layers.enable(LINE_LAYER); // outlines keep tiny thumbnails readable
  }
  thumbRenderer.setSize(size, size);
  thumbScene.add(object);
  object.updateMatrixWorld(true);
  const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.05;
  thumbCam.near = dist / 100; thumbCam.far = dist * 10;
  thumbCam.updateProjectionMatrix();
  thumbCam.position.copy(sphere.center).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(dist));
  thumbCam.lookAt(sphere.center);
  thumbRenderer.render(thumbScene, thumbCam);
  thumbScene.remove(object);
  return thumbRenderer.domElement.toDataURL();
}

export function thumbnail(file) {
  if (thumbs.has(file)) return thumbs.get(file);
  const job = (queue = queue.then(async () => {
    const part = await loadPart(file, catalog.get(file)?.cat === 'Electric' ? '15' : '71');
    part.rotation.x = Math.PI;
    return renderThumb(part);
  }).catch(() => null));
  thumbs.set(file, job);
  return job;
}

// Real-world facts: is this part a wheel/tyre, is it rubber?
export const isWheelPart = info => info.cat === 'Wheel' || info.cat === 'Tyre' || /^(Wheel|Tyre)\b/.test(info.name || '');
export const isRubber = info => info.cat === 'Tyre' || /\bTyre\b|\bRubber\b/.test(info.name || '');
export const isCasterBall = info => /Ball.*Cast[oe]r|Cast[oe]r.*Ball/i.test(info.name || '');
