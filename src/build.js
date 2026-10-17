import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { LDU, loadPart, partInfo, catalog } from './parts.js';
import { parseLdr, serializeLdr } from './ldr.js';
import { tween, easeOutBack } from './motion.js';

const AUTOSAVE_KEY = 'studio.model';
const DROP_LDU = 75; // new parts drop in from 30 mm above

// The model lives in LDraw space: LDU units, -Y up. The root scales and flips it into metres, +Y up.
export function createEditor({ scene, toast }) {
  const model = new THREE.Group();
  model.scale.setScalar(LDU);
  model.rotation.x = Math.PI;
  scene.add(model);

  const listeners = new Set();
  const changed = () => listeners.forEach(f => f());
  let history = [], future = [];

  const record = obj => {
    obj.updateMatrix();
    const e = obj.matrix.elements; // column-major
    return { file: obj.userData.file, color: obj.userData.color, m: [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] };
  };
  const parts = () => model.children.filter(o => o.userData.part);
  const serialize = () => serializeLdr(parts().map(record));

  async function makePart({ file, color, m }) {
    const obj = new THREE.Group();
    obj.userData = { part: true, file, color };
    const [x, y, z, a, b, c, d, e, f, g, h, i] = m;
    new THREE.Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1).decompose(obj.position, obj.quaternion, obj.scale);
    const mesh = await loadPart(file, color);
    mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    obj.add(mesh);
    return obj;
  }

  // Loads many parts; parts missing from the LDraw library are skipped and reported once.
  async function addRecords(records) {
    const missing = new Set();
    const objs = await Promise.all(records.map(r => makePart(r).catch(() => { missing.add(r.file); return null; })));
    for (const o of objs) if (o) model.add(o);
    if (missing.size) toast(`${missing.size} part type(s) aren't in the LDraw library and were skipped: ${[...missing].slice(0, 5).join(', ')}${missing.size > 5 ? '…' : ''}`);
    return objs.filter(Boolean);
  }

  function commit() {
    const text = serialize();
    if (history[history.length - 1] !== text) {
      history.push(text);
      if (history.length > 200) history.shift();
      future = [];
    }
    try { localStorage.setItem(AUTOSAVE_KEY, text); } catch { /* storage full or blocked: Save still works */ }
    changed();
  }

  async function restore(text) {
    for (const o of parts()) model.remove(o);
    await addRecords(parseLdr(text));
    try { localStorage.setItem(AUTOSAVE_KEY, text); } catch { /* ignore */ }
    changed();
  }

  return {
    model,
    parts,
    serialize,
    onChange: f => listeners.add(f),

    // Drops a new part at the given LDraw x/z, resting on the floor, with a short settle.
    // Adds a part resting on the floor. With place: true the caller positions it (and commits) itself.
    async addPart(file, color, at = { x: 0, z: 0 }, { place = false } = {}) {
      const info = await partInfo(file);
      const y = -info.box.max.y; // LDraw +Y is down: the part's lowest point sits on the floor
      const [obj] = await addRecords([{ file, color, m: [at.x, y, at.z, 1, 0, 0, 0, 1, 0, 0, 0, 1] }]);
      if (!obj) return null;
      if (place) return obj;
      obj.position.y = y - DROP_LDU;
      tween(320, k => { obj.position.y = y - DROP_LDU * (1 - k); }, easeOutBack).then(commit);
      return obj;
    },

    async duplicate(objs) {
      objs = [].concat(objs);
      const records = objs.map(record);
      for (const r of records) { r.m[0] += 20; r.m[2] += 20; } // one stud over, so the copy is visible
      const copies = await addRecords(records);
      commit();
      return copies;
    },

    remove(objs) {
      for (const o of [].concat(objs)) model.remove(o);
      commit();
    },

    async recolor(obj, color) {
      obj.userData.color = color;
      const mesh = await loadPart(obj.userData.file, color);
      mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      obj.clear();
      obj.add(mesh);
      commit();
    },

    commit,

    // Adds parts at exact positions (records as in an .ldr file) and records one undo step.
    async insert(records, { commit: save = true } = {}) {
      const objs = await addRecords(records);
      if (save) commit();
      return objs;
    },

    async undo() {
      if (history.length < 2) return;
      future.push(history.pop());
      await restore(history[history.length - 1]);
    },
    async redo() {
      if (!future.length) return;
      history.push(future.pop());
      await restore(history[history.length - 1]);
    },

    async open(file) {
      const name = file.name.toLowerCase();
      let text;
      if (name.endsWith('.io')) {
        // BrickLink Studio .io = zip with model.ldr inside. Older password-protected ones can't be read.
        try {
          const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
          const key = Object.keys(files).find(k => /(^|\/)model\.ldr$/i.test(k)) || Object.keys(files).find(k => /\.ldr$/i.test(k));
          if (!key) throw new Error('no model.ldr');
          text = strFromU8(files[key]);
        } catch {
          return toast('Could not read this .io file (older Studio files are password-protected). In Studio, use File → Export As → LDraw (.ldr) and open that.');
        }
      } else {
        text = await file.text();
      }
      const records = parseLdr(text);
      if (!records.length) return toast('No parts found in that file.');
      for (const o of parts()) model.remove(o);
      await addRecords(records);
      commit();
      toast(`Opened ${file.name}: ${parts().length} parts`);
    },

    async loadAutosave() {
      let text = null;
      try { text = localStorage.getItem(AUTOSAVE_KEY); } catch { /* ignore */ }
      if (text) await addRecords(parseLdr(text));
      history = [serialize()];
      changed();
    },

    clear() {
      for (const o of parts()) model.remove(o);
      commit();
    },

    // Real-world size of the whole model in mm (what you'd measure with a ruler).
    sizeMm() {
      model.updateMatrixWorld(true); // freshly added parts haven't been through a render yet
      const box = new THREE.Box3();
      for (const o of parts()) box.expandByObject(o);
      if (box.isEmpty()) return null;
      return box.getSize(new THREE.Vector3()).multiplyScalar(1000);
    },

    describe(obj) {
      return catalog.get(obj.userData.file) || { file: obj.userData.file, name: obj.userData.file };
    },
  };
}
