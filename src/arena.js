import * as THREE from 'three';
import { LDU, loadPart, partInfo } from './parts.js';
import { parseLdr } from './ldr.js';
import { massGrams } from './data/weights.js';
import { meshGeometry, saveState, loadState } from './library.js';

const ARENA_KEY = 'studio.arena';
export const FLL_MAT_MM = [2362, 1143]; // FLL / WRO RoboMission mat

// Sizes in mm, masses in grams. Every shape's origin is its bottom centre so y = 0 sits on the floor.
const DEFAULTS = {
  box: { size: [100, 100, 100], fixed: false, massG: 120, color: 0xd9a441 },
  wall: { size: [600, 80, 20], fixed: true, massG: 0, color: 0x8a8f98 },
  ramp: { size: [300, 60, 200], fixed: true, massG: 0, color: 0x6f9bd1 },
  cylinder: { size: [80, 100, 80], fixed: false, massG: 90, color: 0xc4675a },
};

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 40).translate(0, 0.5, 0);
const unitRamp = (() => {
  // wedge rising along +X: full base, vertical back face at x = +0.5
  const [a, b, c, d, e, f] = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 1, -.5], [-.5, 0, .5], [.5, 0, .5], [.5, 1, .5]];
  const tris = [a, c, b, d, e, f, a, b, e, a, e, d, b, c, f, b, f, e, a, d, f, a, f, c];
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
})();
const GEOMETRY = { box: unitBox, wall: unitBox, cylinder: unitCylinder, ramp: unitRamp };

export function createArena(scene, toast) {
  const group = new THREE.Group();
  scene.add(group);
  const items = []; // { obj, def }
  let mat = null; // { src (data URL), widthMm, mesh }
  const robotStart = { x: 0, z: 0, yaw: 0 };

  function makeMesh(geometry, color) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  // A LEGO model as an arena object (a mission model, a wall built from bricks): real parts, real mass.
  async function buildLdraw(text) {
    const records = parseLdr(text);
    const root = new THREE.Group();
    root.scale.setScalar(LDU);
    root.rotation.x = Math.PI;
    let grams = 0;
    await Promise.all(records.map(async r => {
      const mesh = await loadPart(r.file, r.color).catch(() => null);
      if (!mesh) return;
      mesh.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      const part = new THREE.Group();
      part.userData = { part: true, file: r.file };
      const [x, y, z, a, b, c, d, e, f, g, h, i] = r.m;
      new THREE.Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1).decompose(part.position, part.quaternion, part.scale);
      part.add(mesh);
      root.add(part);
      const partGrams = massGrams(await partInfo(r.file));
      grams += partGrams; // (not `grams += await …`: that reads grams before the wait and loses the other parts)
    }));
    if (!root.children.length) throw new Error('none of its parts are in the LDraw library');
    const obj = new THREE.Group();
    obj.add(root);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -box.min.y, -c.z); // centred, standing on the floor
    return { obj, grams };
  }

  function add(def, pose, built) {
    const obj = built || makeMesh(def.type === 'mesh' ? def.geometry : GEOMETRY[def.type], def.color);
    obj.userData.obstacle = true;
    if (pose) {
      obj.position.fromArray(pose.pos);
      obj.quaternion.fromArray(pose.quat);
      obj.scale.fromArray(pose.scale);
    } else if (def.size) {
      obj.scale.fromArray(def.size.map(mm => mm / 1000));
    }
    group.add(obj);
    const item = { obj, def };
    items.push(item);
    return obj;
  }

  const toB64 = buf => {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;

  function setMat(src, widthMm, id = null) {
    if (mat) { group.remove(mat.mesh); mat.mesh.material.map.dispose(); }
    mat = null;
    if (!src) return Promise.resolve();
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(src, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        const w = widthMm / 1000, h = (w * tex.image.height) / tex.image.width;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.0003; // a hair above the floor so it never flickers through it
        mesh.receiveShadow = true;
        group.add(mesh);
        // keep the pixels so a colour sensor can read the mat (capped at 2048 px: ~1 mm per pixel on an FLL mat)
        const k = Math.min(1, 2048 / Math.max(tex.image.width, tex.image.height));
        const cv = Object.assign(document.createElement('canvas'), { width: Math.round(tex.image.width * k), height: Math.round(tex.image.height * k) });
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(tex.image, 0, 0, cv.width, cv.height);
        mat = { src, id, widthMm, mesh, heightMm: h * 1000, pixels: ctx.getImageData(0, 0, cv.width, cv.height) };
        resolve(mat);
      }, undefined, reject);
    });
  }

  const api = {
    group,
    items,
    robotStart,
    get mat() { return mat; },

    // What colour is the floor at world (x, z)? The mat is centred on the origin, image top towards -Z.
    colourAt(x, z) {
      if (!mat) return null;
      const { pixels, widthMm, heightMm } = mat;
      const u = (x * 1000) / widthMm + 0.5, v = (z * 1000) / heightMm + 0.5;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
      const i = (Math.floor(v * pixels.height) * pixels.width + Math.floor(u * pixels.width)) * 4;
      return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
    },

    add(type) {
      const d = DEFAULTS[type];
      const obj = add({ type, fixed: d.fixed, massG: d.massG, color: d.color, size: d.size });
      obj.position.set(0, 0, 0.25);
      return obj;
    },

    async importMesh(file) {
      const ext = (file.name.match(/\.(\w+)$/)?.[1] || '').toLowerCase();
      return api.addModel({ kind: 'mesh', name: file.name, ext, data: await file.arrayBuffer() });
    },

    // An uploaded model (from My models): a 3D file, or a LEGO model built from real parts.
    async addModel(rec) {
      try {
        let obj;
        if (rec.kind === 'ldraw') {
          const { obj: built, grams } = await buildLdraw(rec.data);
          obj = add({ type: 'ldraw', fixed: true, massG: Math.round(grams), color: 0x9aa0a8, ldr: rec.data, name: rec.name }, null, built);
        } else {
          const geometry = await meshGeometry(rec);
          obj = add({ type: 'mesh', fixed: true, massG: 200, color: 0xb9bec7, geometry, src: { name: `${rec.name}.${rec.ext}`.replace(/\.(\w+)\.\1$/, '.$1'), b64: toB64(rec.data) } });
        }
        obj.position.set(0, 0, 0.25);
        return obj;
      } catch (err) {
        toast(`Couldn't use ${rec.name}: ${err.message}. 3D files: .stl (mm), .obj (mm), .glb; LEGO: .ldr, .mpd, .io.`);
        return null;
      }
    },

    remove(obj) {
      const i = items.findIndex(it => it.obj === obj);
      if (i < 0) return;
      group.remove(obj);
      items.splice(i, 1);
    },

    defOf: obj => items.find(it => it.obj === obj)?.def,

    setMat, // (picture as a data URL or null, real width in mm, its id in My mats)
    setMatWidth: widthMm => mat && setMat(mat.src, widthMm, mat.id),

    // Physics moves pushable obstacles; these put them back.
    savePoses: () => items.forEach(it => { it.pose = [it.obj.position.clone(), it.obj.quaternion.clone()]; }),
    restorePoses: () => items.forEach(it => { if (it.pose) { it.obj.position.copy(it.pose[0]); it.obj.quaternion.copy(it.pose[1]); } }),

    toJSON() {
      return {
        version: 1,
        robotStart: { ...robotStart },
        mat: mat && { src: mat.src, widthMm: mat.widthMm, id: mat.id },
        items: items.map(({ obj, def }) => ({
          type: def.type, fixed: def.fixed, massG: def.massG, color: def.color, src: def.src, ldr: def.ldr, name: def.name,
          pos: obj.position.toArray(), quat: obj.quaternion.toArray(), scale: obj.scale.toArray(),
        })),
      };
    },

    async load(json) {
      while (items.length) api.remove(items[0].obj);
      Object.assign(robotStart, json.robotStart || { x: 0, z: 0, yaw: 0 });
      for (const it of json.items || []) {
        let geometry, built;
        try {
          if (it.type === 'mesh') geometry = await meshGeometry({ ext: it.src.name.split('.').pop().toLowerCase(), data: fromB64(it.src.b64) });
          else if (it.type === 'ldraw') built = (await buildLdraw(it.ldr)).obj;
          else if (!GEOMETRY[it.type]) continue;
        } catch { continue; }
        add({ type: it.type, fixed: it.fixed, massG: it.massG, color: it.color, src: it.src, ldr: it.ldr, name: it.name, geometry }, it, built);
      }
      await setMat(json.mat?.src, json.mat?.widthMm, json.mat?.id);
    },

    // Kept in IndexedDB: a mat picture alone can be bigger than localStorage's 5 MB.
    autosave() {
      saveState(ARENA_KEY, api.toJSON()).catch(() => toast('Couldn\'t keep the arena in this browser. Use Save to keep it as a file.'));
    },
    async loadAutosave() {
      try {
        let json = await loadState(ARENA_KEY).catch(() => null);
        json ??= JSON.parse(localStorage.getItem(ARENA_KEY)); // saved by an older version
        if (json) await api.load(json);
      } catch { /* nothing saved or unreadable: start empty */ }
    },
  };
  return api;
}
