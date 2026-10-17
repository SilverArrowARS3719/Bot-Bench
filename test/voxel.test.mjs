import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servePublic } from './serve.mjs';
import { initParts, partInfo } from '../src/parts.js';
import { boxDecompose } from '../src/voxel.js';

let srv;
before(async () => {
  srv = await servePublic();
  await initParts(srv.base);
});
after(() => srv.close());

const inside = (boxes, [x, y, z]) => {
  for (let i = 0; i < boxes.length; i += 6)
    if (Math.abs(x - boxes[i]) <= boxes[i + 3] && Math.abs(y - boxes[i + 1]) <= boxes[i + 4] && Math.abs(z - boxes[i + 2]) <= boxes[i + 5]) return true;
  return false;
};

test('beam collision boxes keep the holes open and the material solid', async () => {
  const info = await partInfo('32278.dat');
  const boxes = boxDecompose(info.tris, info.box);
  assert.ok(boxes && boxes.length / 6 <= 96, `${boxes?.length / 6} boxes`);
  for (let z = -140; z <= 140; z += 20) assert.ok(!inside(boxes, [0, 0, z]), `hole at z=${z} is open`);
  for (let z = -130; z <= 130; z += 20) assert.ok(inside(boxes, [0, 0, z]), `material between holes at z=${z}`);
});

test('a 5 x 7 frame stays open in the middle', async () => {
  const info = await partInfo('64179.dat');
  const boxes = boxDecompose(info.tris, info.box);
  const c = info.box.getCenter(info.box.min.clone());
  assert.ok(!inside(boxes, [c.x, c.y, c.z]), 'centre is open');
});

test('physics shapes: open frames keep their opening, plain beams are one hull', async () => {
  const { collisionShape } = await import('../src/sim.js');
  assert.ok(collisionShape(await partInfo('64179.dat')), '5 x 7 open frame uses boxes');
  assert.equal(collisionShape(await partInfo('32278.dat')), null, 'beam 15 uses a hull');
  const frame = collisionShape(await partInfo('64179.dat'));
  assert.ok(frame.length / 6 <= 48, `${frame.length / 6} boxes`);
});
