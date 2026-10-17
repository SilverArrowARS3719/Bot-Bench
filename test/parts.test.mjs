import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { servePublic } from './serve.mjs';
import { initParts, partInfo, LDU } from '../src/parts.js';
import { massGrams } from '../src/data/weights.js';

let srv;
before(async () => {
  srv = await servePublic();
  await initParts(srv.base);
});
after(() => srv.close());

const mm = (info, axis) => +(info.box.getSize(new THREE.Vector3())[axis] * LDU * 1000).toFixed(1);

test('15-hole Technic beam is 119.2 x 8 x 7.2 mm', async () => {
  const beam = await partInfo('32278.dat');
  // holes are 8 mm apart (14 gaps = 112 mm) and the beam is 7.2 mm wide with round ends: 112 + 7.2 = 119.2 mm
  assert.deepEqual(['x', 'y', 'z'].map(a => mm(beam, a)).sort((a, b) => a - b), [7.2, 8, 119.2]);
});

test('2 x 4 brick is 16 x 32 mm', async () => {
  const brick = await partInfo('3001.dat');
  assert.deepEqual([mm(brick, 'z'), mm(brick, 'x')].sort((a, b) => a - b), [16, 32]);
});

// Real sizes (mm) from BrickLink's catalogue dimensions, read 2026-10-14.
// Not listed: SPIKE motors/sensors, because BrickLink measures them with their cable attached;
// the 40-tooth gear, where BrickLink says 48.2 mm but a module-1 LEGO gear is (teeth + 2) = 42 mm across.
const REAL_SIZES = {
  '45601c01.dat': [32, 55, 88], // SPIKE hub (LDraw 56: exactly 7 modules)
  '95646c01.dat': [50.8, 72, 111.2], '95658.dat': [40, 58.8, 110.8], '99455.dat': [24, 31.2, 72.4],
  '95650.dat': [24, 31, 39.6], '95648.dat': [24, 31.2, 43.6], '95652.dat': [32, 47.6, 58.4],
  '56145.dat': [20, 30.4, 30.4], '3647.dat': [8, 9.9, 9.9], '4019.dat': [8, 17.3, 17.3], '52629.dat': [19, 19, 19],
};
for (const [file, real] of Object.entries(REAL_SIZES)) {
  test(`${file} matches its real size ${real.join(' x ')} mm within 4 mm`, async () => {
    const info = await partInfo(file);
    const s = ['x', 'y', 'z'].map(a => mm(info, a)).sort((a, b) => a - b);
    s.forEach((v, k) => assert.ok(Math.abs(v - real[k]) <= 4, `${s.join(' x ')} mm`));
  });
}

test('LEGO gears are module 1: outside diameter = teeth + 2 mm', async () => {
  for (const [file, teeth] of [['3647.dat', 8], ['4019.dat', 16], ['3648b.dat', 24], ['3649.dat', 40]]) {
    const info = await partInfo(file);
    const d = Math.max(...['x', 'y', 'z'].map(a => mm(info, a)));
    assert.ok(Math.abs(d - (teeth + 2)) < 1, `${file}: ${d} mm`);
  }
});

// BrickLink catalogue weights (grams), read 2026-10-14
const BRICKLINK = {
  '3001.dat': 2.32, '32278.dat': 4, '41239.dat': 3.3, '32524.dat': 1.74, '32523.dat': 0.7,
  '32140.dat': 1.43, '64179.dat': 5.3, '3706.dat': 0.86, '6558.dat': 0.37,
};
for (const [file, real] of Object.entries(BRICKLINK)) {
  test(`${file} mass from solid volume is within 20% of BrickLink ${real} g`, async () => {
    const g = massGrams(await partInfo(file));
    assert.ok(Math.abs(g / real - 1) < 0.2, `${g.toFixed(2)} g`);
  });
}
