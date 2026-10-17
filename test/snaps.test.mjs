import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { servePublic } from './serve.mjs';
import { initParts, catalog } from '../src/parts.js';
import { partSnaps, transformSnap, findConnections, buildIndex, snapPose, autoConnect, clashChecker, isConnector } from '../src/snaps.js';
import { partInfo } from '../src/parts.js';

let srv;
before(async () => {
  srv = await servePublic();
  await initParts(srv.base);
});
after(() => srv.close());

const mat = ([x, y, z], r = [1, 0, 0, 0, 1, 0, 0, 0, 1]) =>
  new THREE.Matrix4().set(r[0], r[1], r[2], x, r[3], r[4], r[5], y, r[6], r[7], r[8], z, 0, 0, 0, 1);
const X_TO_Y = [0, -1, 0, 1, 0, 0, 0, 0, 1]; // part's X axis -> model Y
const Z_TO_Y = [1, 0, 0, 0, 0, -1, 0, 1, 0]; // part's Z axis -> model Y

async function place(spec) {
  return Promise.all(spec.map(async ([file, pos, rot]) => ({
    name: catalog.get(file)?.name, file, snaps: (await partSnaps(file)).map(s => transformSnap(s, mat(pos, rot))),
  })));
}

test('beam 15 has 15 pin holes 8 mm apart', async () => {
  const holes = (await partSnaps('32278.dat')).filter(s => s.gender === 'F' && s.shape === 'R');
  assert.equal(holes.length, 15);
  const zs = holes.map(h => h.p.z).sort((a, b) => a - b);
  zs.slice(1).forEach((z, i) => assert.equal(z - zs[i], 20)); // 20 LDU = 8 mm
});

test('friction pin locks, axle spins in a round hole, gear locks on axle', async () => {
  const parts = await place([
    ['32278.dat', [0, 0, 0]], // beam, holes along Y
    ['2780.dat', [0, -10, 0], X_TO_Y], // friction pin, half in the hole at z = 0
    ['3706.dat', [0, 0, 20], X_TO_Y], // 6L axle through the hole at z = 20
    ['3648b.dat', [0, -40, 20], Z_TO_Y], // 24 tooth gear on that axle, above the beam
  ]);
  const conns = findConnections(parts);
  const between = (a, b) => conns.filter(c => (c.a === a && c.b === b) || (c.a === b && c.b === a)).map(c => c.kind);
  assert.ok(between(0, 1).includes('fixed'), 'pin-beam ' + between(0, 1));
  assert.deepEqual([...new Set(between(0, 2))], ['hinge'], 'axle-beam');
  assert.ok(between(2, 3).includes('fixed'), 'gear-axle ' + between(2, 3));
  assert.deepEqual(between(1, 3), [], 'pin and gear do not touch');
});

test('a motor output is marked as the spinning rotor', async () => {
  const snaps = await partSnaps('54675.dat');
  assert.ok(snaps.some(s => s.rotor && s.shape === 'A'), 'axle hole on the drive hub');
  assert.ok(snaps.filter(s => !s.rotor).length >= 30, 'body holes stay put');
});

test('dragging a pin near a hole clicks it in, upright and fully seated', async () => {
  const [beam] = await place([['32278.dat', [0, 0, 0]]]);
  const index = buildIndex([beam]);
  // pin lying on its side, 6 LDU off the hole at z = 40 and tilted 20°
  const tilt = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(70));
  const start = new THREE.Matrix4().makeTranslation(3, -14, 44).multiply(tilt);
  const pin = (await partSnaps('2780.dat')).map(s => transformSnap(s, start));
  const hit = snapPose(pin, index);
  assert.ok(hit, 'found a snap');
  const final = hit.matrix.clone().multiply(start);
  const placed = (await partSnaps('2780.dat')).map(s => transformSnap(s, final));
  const conns = findConnections([beam, { name: 'Technic Pin with Friction', snaps: placed }]);
  assert.ok(conns.some(c => c.kind === 'fixed'), 'pin is now connected to the beam');
});

// A top-down view for tests: screen x = model x, screen y = model z (1 px per LDU), looking straight down.
const topDown = { project: v => ({ x: v.x, y: v.z }), rayAt: (x, z) => new THREE.Ray(new THREE.Vector3(x, -1000, z), new THREE.Vector3(0, 1, 0)) };

async function placed(file, pos, rot) {
  const info = await partInfo(file);
  const m = mat(pos, rot);
  return { file, name: catalog.get(file)?.name, matrix: m, box: info.box.clone().applyMatrix4(m), localBox: info.box.clone(), snaps: (await partSnaps(file)).map(s => transformSnap(s, m)) };
}

async function drop(file, startRot, cursor, staticParts) {
  const statics = staticParts.flatMap(p => p.snaps.map(s => ({ ...s, owner: p })));
  const info = await partInfo(file);
  return autoConnect({
    moving: await partSnaps(file),
    statics,
    rotation: new THREE.Matrix4().makeRotationFromEuler(startRot),
    project: topDown.project,
    cursor,
    ray: topDown.rayAt(cursor.x, cursor.y),
    centre: info.box.getCenter(new THREE.Vector3()),
    clash: clashChecker(staticParts.map(p => ({ box: p.box, connector: isConnector(p.name) })), [{ box: info.box, offset: new THREE.Matrix4(), connector: isConnector(catalog.get(file)?.name) }]),
  });
}

test('auto-connect: a pin dropped near a hole goes in upright, from any angle', async () => {
  const beam = await placed('32278.dat', [0, 0, 0]);
  const hit = await drop('2780.dat', new THREE.Euler(0.3, 0.2, 1.1), { x: 3, y: 44 }, [beam]);
  assert.ok(hit, 'found a connection');
  const pin = { name: 'Technic Pin with Friction', snaps: (await partSnaps('2780.dat')).map(s => transformSnap(s, hit.matrix)) };
  const conns = findConnections([{ name: beam.name, snaps: beam.snaps }, pin]);
  assert.ok(conns.some(c => c.kind === 'fixed'), 'pin locked into the beam');
  assert.ok(Math.abs(hit.point.z - 40) < 1, `went into the hole under the cursor (z ${hit.point.z})`);
});

test('auto-connect: a beam dropped on a pin stacks on top instead of overlapping the beam below', async () => {
  const lower = await placed('32278.dat', [0, 0, 0]);
  const pin = await placed('2780.dat', [0, -10, 0], X_TO_Y); // half in the lower beam, half sticking up
  const hit = await drop('32278.dat', new THREE.Euler(0, 0, 0), { x: 0, y: 0 }, [lower, pin]);
  assert.ok(hit, 'found a connection');
  const y = new THREE.Vector3().setFromMatrixPosition(hit.matrix).y;
  assert.ok(Math.abs(y - -20) < 0.5, `new beam centred at y=${y} (directly on top is -20)`);
});
