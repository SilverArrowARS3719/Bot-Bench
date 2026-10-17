import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { loader, catalog } from './parts.js';

// "My models": files you upload (robots and sub-assemblies, single custom parts, 3D models for the arena),
// kept in this browser so they're there next time. Stored in IndexedDB because models can be megabytes.
//   kind 'ldraw' — a LEGO model (.ldr / .mpd / .io): add it to your robot, or put it in the arena
//   kind 'part'  — one LDraw part file (.dat) that isn't in the library: becomes a normal part
//   kind 'mesh'  — a 3D model (.stl / .glb / .gltf / .obj): an arena obstacle or mission model
//   kind 'mat'   — a picture of a mat (.png / .jpg …): the Test arena's floor

const DB = 'robot-studio', STORE = 'models', STATE = 'state';
let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!req.result.objectStoreNames.contains(STATE)) req.result.createObjectStore(STATE); // autosaves too big for localStorage
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
const run = async (mode, fn, store = STORE) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode), req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
};

export const listModels = () => run('readonly', s => s.getAll()).then(all => (all || []).sort((a, b) => b.added - a.added));
export const getModel = id => run('readonly', s => s.get(id));
export const saveModel = rec => run('readwrite', s => s.put(rec));
export const deleteModel = id => run('readwrite', s => s.delete(id));
export const saveState = (key, value) => run('readwrite', s => s.put(value, key), STATE);
export const loadState = key => run('readonly', s => s.get(key), STATE);

const IMAGE = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

// Reads an uploaded file into a library record (without saving it).
export async function readUpload(file) {
  const name = file.name, ext = (name.match(/\.(\w+)$/)?.[1] || '').toLowerCase();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const base = { id, name: name.replace(/\.\w+$/, ''), ext, added: Date.now() };
  if (['stl', 'glb', 'gltf', 'obj'].includes(ext)) return { ...base, kind: 'mesh', data: await file.arrayBuffer() };
  // a picture is a mat for the Test arena
  if (IMAGE.includes(ext) || file.type?.startsWith('image/')) {
    return { ...base, kind: 'mat', data: await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); }) };
  }
  let text;
  if (ext === 'io') {
    // BrickLink Studio .io = zip with model.ldr inside. Older password-protected ones can't be read.
    try {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const key = Object.keys(files).find(k => /(^|\/)model\.ldr$/i.test(k)) || Object.keys(files).find(k => /\.ldr$/i.test(k));
      text = strFromU8(files[key]);
    } catch {
      throw new Error(`Couldn't read ${name}: older Studio files are password-protected. In Studio use File → Export As → LDraw, then upload that.`);
    }
  } else if (['ldr', 'mpd', 'dat'].includes(ext)) text = await file.text();
  else throw new Error(`${name}: use .ldr, .mpd, .io or .dat for LEGO, .stl, .glb, .gltf, .obj for 3D models, or a picture for a mat.`);
  // A .dat with its own triangles is a part drawing; one that only places other parts is a model.
  const drawsShapes = /^\s*[2345]\s/m.test(text), placesParts = /^\s*1\s/m.test(text);
  if (ext === 'dat' && drawsShapes) {
    const file = customPartName(name);
    return { ...base, kind: 'part', file, data: text, title: (text.split(/\r?\n/, 1)[0] || '').replace(/^0\s*/, '').trim() || base.name };
  }
  if (!placesParts) throw new Error(`${name} has no LEGO parts in it.`);
  return { ...base, kind: 'ldraw', data: text };
}

// Uploaded part files get a name that can't clash with the official library.
function customPartName(name) {
  const clean = name.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return catalog.has(clean) ? `custom-${clean}` : clean;
}

// Makes an uploaded part usable everywhere a library part is (lists, building, physics).
export function registerPart(rec) {
  loader.partsCache.parseCache.setData(rec.file, rec.data);
  catalog.set(rec.file, { file: rec.file, name: rec.title || rec.name, cat: 'Custom' });
}

// The geometry of an uploaded 3D file, in metres, centred on its base.
export async function meshGeometry(rec) {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const merged = root => {
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const g = new THREE.BufferGeometry().setAttribute('position', o.geometry.attributes.position.clone());
      if (o.geometry.index) g.setIndex(o.geometry.index.clone());
      parts.push(g.applyMatrix4(o.matrixWorld).toNonIndexed());
    });
    if (!parts.length) throw new Error('no meshes');
    return mergeGeometries(parts);
  };
  let g;
  // shortcut: STL and OBJ carry no units; nearly all of them are millimetres (STL Z-up from CAD, OBJ Y-up)
  if (rec.ext === 'stl') g = new STLLoader().parse(rec.data).scale(0.001, 0.001, 0.001).rotateX(-Math.PI / 2);
  else if (rec.ext === 'obj') g = merged(new OBJLoader().parse(new TextDecoder().decode(rec.data))).scale(0.001, 0.001, 0.001);
  else g = merged((await new GLTFLoader().parseAsync(rec.data, '')).scene); // glTF is metres by definition
  g = g.index ? g.toNonIndexed() : g;
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.computeVertexNormals();
  return g;
}
