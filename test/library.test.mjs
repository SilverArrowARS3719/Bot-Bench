import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';
import { servePublic } from './serve.mjs';
import { initParts, partInfo, LDU, catalog } from '../src/parts.js';
import { readUpload, registerPart } from '../src/library.js';
import { parseLdr } from '../src/ldr.js';
import { createArena } from '../src/arena.js';
import { createSim } from '../src/sim.js';

let srv;
before(async () => {
  srv = await servePublic();
  await initParts(srv.base);
});
after(() => srv.close());

const EXAMPLE = readFileSync(new URL('../examples/spike-drive-base.ldr', import.meta.url), 'utf8');

test('uploads are sorted into LEGO models, part files and 3D models', async () => {
  assert.equal((await readUpload(new File([EXAMPLE], 'robot.ldr'))).kind, 'ldraw');
  const io = zipSync({ 'model.ldr': strToU8(EXAMPLE), '.info': strToU8('{}') });
  const fromStudio = await readUpload(new File([io], 'robot.io'));
  assert.equal(fromStudio.kind, 'ldraw');
  assert.equal(parseLdr(fromStudio.data).length, 8);
  const part = await readUpload(new File(['0 My Bracket\n0 Name: bracket.dat\n4 16 0 0 0 20 0 0 20 0 20 0 0 20\n'], 'bracket.dat'));
  assert.equal(part.kind, 'part');
  assert.equal((await readUpload(new File([new Uint8Array(84)], 'thing.stl'))).kind, 'mesh');
  await assert.rejects(readUpload(new File(['hello'], 'notes.txt')), /use \.ldr/);
});

test('an uploaded part file becomes a usable part at its drawn size', async () => {
  const rec = await readUpload(new File(['0 My Plate 2 x 2\n0 Name: myplate.dat\n4 16 -20 0 -20 20 0 -20 20 0 20 -20 0 20\n4 16 -20 -8 -20 -20 -8 20 20 -8 20 20 -8 -20\n'], 'myplate.dat'));
  registerPart(rec);
  assert.equal(catalog.get(rec.file).cat, 'Custom');
  const info = await partInfo(rec.file);
  const size = info.box.getSize(new THREE.Vector3());
  assert.deepEqual([size.x, size.y, size.z].map(v => +(v * LDU * 1000).toFixed(1)), [16, 3.2, 16]); // 2 x 2 studs, one plate thick
});

test('an uploaded LEGO wall in the arena stops the robot', async () => {
  // ten 15-hole beams stacked on edge: a wall 119 mm wide and 80 mm tall, standing across the robot's path
  const wall = Array.from({ length: 10 }, (_, k) => `1 4 0 ${-10 - k * 20} 0 0 0 1 0 1 0 -1 0 0 32278.dat`).join('\n');
  const arena = createArena(new THREE.Scene(), () => {});
  const obj = await arena.addModel({ kind: 'ldraw', name: 'wall', data: wall });
  assert.ok(obj, 'built');
  obj.position.set(0, 0, 0.25);
  assert.ok(Math.abs(arena.defOf(obj).massG - 39) < 3, `wall weighs ${arena.defOf(obj).massG} g`);

  const root = new THREE.Group();
  root.scale.setScalar(LDU);
  root.rotation.x = Math.PI;
  for (const r of parseLdr(EXAMPLE)) {
    const g = new THREE.Group();
    g.userData = { part: true, file: r.file };
    g.matrixAutoUpdate = false;
    const [x, y, z, a, b, c, d, e, f, gg, h, i] = r.m;
    g.matrix.set(a, b, c, x, d, e, f, y, gg, h, i, z, 0, 0, 0, 1);
    root.add(g);
  }
  const robot = new THREE.Group();
  robot.add(root);
  const sim = await createSim(robot, arena);
  sim.setInput(1, 0, new Set());
  for (let t = 0; t < 2; t += 1 / 60) sim.update(1 / 60);
  const front = sim.focus().z;
  assert.ok(front < 0.25 && sim.telemetry().speed < 0.05, `robot stopped at z=${front.toFixed(3)} m, speed ${sim.telemetry().speed.toFixed(3)}`);
  sim.dispose();
});
