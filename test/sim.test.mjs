import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { servePublic } from './serve.mjs';
import { initParts, LDU } from '../src/parts.js';
import { parseLdr } from '../src/ldr.js';
import { createSim } from '../src/sim.js';

let srv;
before(async () => {
  srv = await servePublic();
  await initParts(srv.base);
});
after(() => srv.close());

// The example SPIKE Prime drive base: two Large Angular Motors, 3L axles through their outputs,
// 56 mm wheels on the axles, hub on top, ball castor at the back.
const SPIKE_BOT = parseLdr(readFileSync(new URL('../examples/spike-drive-base.ldr', import.meta.url), 'utf8'))
  .map(r => [r.file, r.m.slice(0, 3), r.m.slice(3)]);

function buildRobot(spec) {
  const root = new THREE.Group();
  root.scale.setScalar(LDU);
  root.rotation.x = Math.PI;
  for (const [file, [x, y, z], r = [1, 0, 0, 0, 1, 0, 0, 0, 1]] of spec) {
    const g = new THREE.Group();
    g.userData = { part: true, file };
    g.matrixAutoUpdate = false;
    g.matrix.set(r[0], r[1], r[2], x, r[3], r[4], r[5], y, r[6], r[7], r[8], z, 0, 0, 0, 1);
    root.add(g);
  }
  const placed = new THREE.Group();
  placed.add(root);
  return placed;
}

const run = (sim, seconds, fwd, turn = 0, keys = new Set()) => {
  sim.setInput(fwd, turn, keys);
  for (let t = 0; t < seconds; t += 1 / 60) sim.update(1 / 60);
};

test('SPIKE drive base: wheels on motor outputs, sides and ports assigned', async () => {
  const sim = await createSim(buildRobot(SPIKE_BOT), { items: [] });
  const t = sim.telemetry();
  assert.equal(t.assumedMotor, false);
  assert.deepEqual(t.motors.map(m => m.role).sort(), ['left', 'right']);
  assert.deepEqual(t.motors.map(m => [m.role, m.port]).sort(), [['left', 'A'], ['right', 'B']]);
  assert.ok(t.motors.every(m => m.name.startsWith('Large Angular') && m.wheelMm === 56), JSON.stringify(t.motors));
  assert.equal(t.castors, 1);
  assert.equal(t.joints, 2);
  sim.dispose();
});

test('top speed matches motor rpm x wheel circumference', async () => {
  const sim = await createSim(buildRobot(SPIKE_BOT), { items: [] });
  run(sim, 0.5, 0); // settle onto the floor
  sim.setSpeed(0.75);
  run(sim, 2, 1);
  const { speed, topSpeed, tipped } = sim.telemetry();
  // 175 rpm × π × 56 mm = 0.513 m/s at 100 %; 75 % -> 0.385 m/s
  assert.ok(Math.abs(topSpeed - 0.385) < 0.005, `top ${topSpeed}`);
  assert.ok(Math.abs(speed / topSpeed - 1) < 0.05, `measured ${speed.toFixed(3)} m/s vs ${topSpeed.toFixed(3)}`);
  assert.equal(tipped, false);
  sim.dispose();
});

test('releasing W at full speed slows at 1000 deg/s² (SPIKE default), stops, does not tip', async () => {
  const sim = await createSim(buildRobot(SPIKE_BOT), { items: [] });
  sim.setSpeed(1);
  run(sim, 0.5, 0);
  run(sim, 1.5, 1);
  run(sim, 1.5, 0);
  const t = sim.telemetry();
  assert.equal(t.tipped, false);
  assert.ok(t.speed < 0.01, `still moving at ${t.speed}`);
  sim.dispose();
});

test('W drives toward +Z (the model front), A/D spin it in place, gyro follows', async () => {
  const sim = await createSim(buildRobot(SPIKE_BOT), { items: [] });
  run(sim, 0.5, 0);
  const start = sim.focus();
  run(sim, 1, 1);
  const moved = sim.focus().sub(start);
  assert.ok(moved.z > 0.2 && Math.abs(moved.x) < 0.03, `moved ${moved.toArray().map(n => n.toFixed(3))}`);
  run(sim, 1, 0);
  const before = sim.focus();
  run(sim, 0.6, 0, 1); // D: turn right
  assert.ok(sim.focus().distanceTo(before) < 0.06, 'spin in place stays roughly in place');
  assert.ok(sim.telemetry().imu[0] < -20, `yaw ${sim.telemetry().imu[0]} (right turn = negative)`);
  sim.dispose();
});

test('turning: W+D drives a smooth arc, Shift drives slowly, a motor\'s job can be changed', async () => {
  const sim = await createSim(buildRobot(SPIKE_BOT), { items: [] });
  run(sim, 0.5, 0);
  const start = sim.focus();
  run(sim, 1.2, 1, 1); // W + D
  const moved = sim.focus().sub(start), yaw = sim.telemetry().imu[0];
  assert.ok(moved.z > 0.1, `keeps driving forward (${moved.z.toFixed(3)} m)`);
  assert.ok(yaw < -15, `curves right (yaw ${yaw.toFixed(1)}°)`);
  const left = sim.telemetry().motors.find(m => m.role === 'left');
  sim.setRole(left.key, 'aux');
  assert.deepEqual(sim.telemetry().motors.find(m => m.key === left.key).keys, ['q', 'e'], 'an arm motor gets the Q/E keys');
  sim.dispose();

  const slow = await createSim(buildRobot(SPIKE_BOT), { items: [] });
  run(slow, 0.5, 0);
  run(slow, 1.5, 1, 0, new Set(['shift']));
  const v = slow.telemetry().speed;
  assert.ok(v > 0.07 && v < 0.15, `Shift drives at about 30 % (${v.toFixed(3)} m/s, full is 0.38)`);
  slow.dispose();
});

test('program API: move_for_degrees drives the right distance', async () => {
  const sim = await createSim(buildRobot(SPIKE_BOT), { items: [] });
  run(sim, 0.5, 0);
  sim.api.setProgram(true);
  const start = sim.focus();
  let done = false;
  sim.api.pairMoveForDegrees('A', 'B', 360, 0, 360, 'brake').then(() => { done = true; });
  for (let i = 0; i < 300 && !done; i++) { sim.update(1 / 60); await null; } // let the promise settle between frames
  assert.ok(done, 'finished');
  run(sim, 0.3, 0);
  const mm = sim.focus().sub(start).length() * 1000;
  // one wheel turn = π × 56 mm = 176 mm
  assert.ok(Math.abs(mm - 176) < 10, `${mm.toFixed(1)} mm`);
  sim.dispose();
});

// An arm: a Large Angular Motor on the chassis with a 15-hole beam pinned to its output.
test('an arm on a motor output lifts with Q/E and holds when released', async () => {
  const spec = [
    ...SPIKE_BOT,
    ['54675.dat', [0, -170, 140], [1, 0, 0, 0, 1, 0, 0, 0, 1]], // motor on the hub, output facing up/down (its Y axis)
    ['32278.dat', [0, -221, 140], [0, 0, 1, 0, 1, 0, -1, 0, 0]], // beam lying across the output, along X
    ['2780.dat', [-20, -231, 140], [0, -1, 0, 1, 0, 0, 0, 0, 1]], // pins from beam holes into the drive hub
    ['2780.dat', [20, -231, 140], [0, -1, 0, 1, 0, 0, 0, 0, 1]],
  ];
  const sim = await createSim(buildRobot(spec), { items: [] });
  const arm = sim.telemetry().motors.find(m => m.role === 'aux');
  assert.ok(arm && !arm.idle, 'arm motor drives a body: ' + JSON.stringify(sim.telemetry().motors));
  run(sim, 0.3, 0);
  run(sim, 0.5, 0, 0, new Set([arm.keys[1]]));
  const turned = sim.telemetry().motors.find(m => m.role === 'aux').angle;
  assert.ok(Math.abs(turned) > 60, `arm turned ${turned}°`);
  run(sim, 1, 0);
  const held = sim.telemetry().motors.find(m => m.role === 'aux').angle;
  assert.ok(Math.abs(held - turned) < 25, `arm held near ${turned}°, now ${held}°`);
  sim.dispose();
});

const X_TO_Y = [0, -1, 0, 1, 0, 0, 0, 0, 1];
const Z_TO_Y = [1, 0, 0, 0, 0, -1, 0, 1, 0];

test('gear train: 8 tooth on the motor drives a 24 tooth at one third speed, opposite way', async () => {
  // a motor standing on the floor, output axle pointing up; the 24t sits on an axle in the motor's own body hole
  const spec = [
    ['54675.dat', [0, -30, 0]],
    ['4519.dat', [0, -80, 0], X_TO_Y],
    ['3647.dat', [0, -100, 0], Z_TO_Y],
    ['4519.dat', [40, -80, 0], X_TO_Y],
    ['3648b.dat', [40, -100, 0], Z_TO_Y],
  ];
  const sim = await createSim(buildRobot(spec), { items: [] });
  const { mech, bodies } = sim.debug;
  assert.equal(mech.gears.length, 1, 'gears mesh');
  sim.api.setProgram(true);
  run(sim, 0.3, 0);
  sim.api.motorRun('A', 360);
  run(sim, 1.5, 0);
  const groupOf = file => mech.groups.findIndex(g => g.parts.some(i => spec[i][0] === file));
  const spin = file => bodies[groupOf(file)].angvel().y - bodies[groupOf('54675.dat')].angvel().y;
  const ratio = spin('3648b.dat') / spin('3647.dat');
  assert.ok(Math.abs(ratio + 1 / 3) < 0.03, `ratio ${ratio.toFixed(3)}`);
  assert.ok(Math.abs(Math.abs(spin('3647.dat')) * 180 / Math.PI - 360) < 20, `motor ${(spin('3647.dat') * 180 / Math.PI).toFixed(0)} deg/s`);
  sim.dispose();
});

test('distance sensor sees a wall, colour sensor reads the mat under it', async () => {
  const spec = [
    ...SPIKE_BOT,
    ['37316.dat', [0, -140, -60]], // distance sensor on the front of the hub, looking forward
    ['37308.dat', [0, -60, -40], [1, 0, 0, 0, 0, -1, 0, 1, 0]], // colour sensor looking down, eye 4 mm above the floor
  ];
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  wall.scale.set(0.6, 0.08, 0.02);
  wall.position.set(0, 0, 0.3);
  const arena = { items: [{ obj: wall, def: { type: 'wall', fixed: true, massG: 0, color: 0x888888 } }], colourAt: () => [235, 235, 235] };
  const sim = await createSim(buildRobot(spec), arena);
  run(sim, 0.5, 0);
  const t = sim.telemetry();
  const dist = t.sensors.find(s => s.type === 'distance');
  const col = t.sensors.find(s => s.type === 'color');
  // eye at z = 120 LDU = 48 mm; wall face at 290 mm
  assert.ok(Math.abs(dist.value - 242) < 8, `distance ${dist.value} mm`);
  assert.equal(col.value.color, 10, 'WHITE');
  assert.ok(col.value.reflection > 80, `reflection ${col.value.reflection}`);
  assert.deepEqual([dist.port, col.port].sort(), ['C', 'D']);
  sim.dispose();
});

// Worm rig: a motor standing on the floor with its output axle pointing up, a 2L worm on that axle,
// a 24 tooth gear across it on a 6L axle held by a beam.
// (a 6L output axle, so the 24 tooth clears the top of the motor)
const WORM_RIG = [
  ['54675.dat', [0, -30, 0]],
  ['3706.dat', [0, -110, 0], X_TO_Y],
  ['4716.dat', [0, -150, 0], Z_TO_Y],
  ['3706.dat', [0, -150, 40]],
  ['3648b.dat', [0, -150, 40], [0, 0, 1, 0, 1, 0, -1, 0, 0]],
  ['32278.dat', [40, -150, 40], [0, 1, 0, -1, 0, 0, 0, 0, 1]],
  ['45601c01.dat', [120, 0, 60]], // a hub alongside as ballast, so the rig doesn't twist on the floor
];

test('worm gear: the 24 tooth turns once for every 24 turns of the worm', async () => {
  const sim = await createSim(buildRobot(WORM_RIG), { items: [] });
  const { mech, bodies } = sim.debug;
  assert.equal(mech.gears.filter(g => g.worm).length, 1, 'worm meshes');
  sim.api.setProgram(true);
  run(sim, 0.3, 0);
  sim.api.motorRun('A', 720);
  run(sim, 1.5, 0);
  const groupOf = file => mech.groups.findIndex(g => g.parts.some(i => WORM_RIG[i][0] === file));
  const root = bodies[mech.root];
  assert.notEqual(groupOf('3648b.dat'), mech.root, 'gear turns on its own axle');
  // the lone motor twists a little on the floor, so measure about each axle as it points now
  const now = v => v.applyQuaternion(new THREE.Quaternion().copy(root.rotation()));
  const spin = (file, axis) => new THREE.Vector3().copy(bodies[groupOf(file)].angvel()).sub(root.angvel()).dot(now(axis));
  const worm = spin('4716.dat', new THREE.Vector3(0, 1, 0)), gear = spin('3648b.dat', new THREE.Vector3(1, 0, 0));
  assert.ok(Math.abs(Math.abs(worm / gear) - 24) < 2.5, `worm ${(worm * 180 / Math.PI).toFixed(0)} °/s, gear ${(gear * 180 / Math.PI).toFixed(1)} °/s`);
  sim.dispose();
});

test('worm gear: nothing turning the worm means the gear is locked', async () => {
  const rig = WORM_RIG.slice(1); // no motor
  const sim = await createSim(buildRobot(rig), { items: [] });
  const { mech, bodies } = sim.debug;
  assert.equal(mech.gears.filter(g => g.worm).length, 1, 'worm meshes');
  run(sim, 0.3, 0);
  const g = bodies[mech.groups.findIndex(gr => gr.parts.some(i => rig[i][0] === '3648b.dat'))];
  const root = bodies[mech.root];
  // how far the gear has turned relative to the frame holding it, about its axle
  const turned = () => {
    const rel = new THREE.Quaternion().copy(root.rotation()).invert().multiply(new THREE.Quaternion().copy(g.rotation()));
    return Math.abs(2 * Math.atan2(rel.x, rel.w)) * 180 / Math.PI;
  };
  const before = turned();
  for (let i = 0; i < 30; i++) { g.applyTorqueImpulse({ x: 0.00005, y: 0, z: 0 }, true); sim.update(1 / 60); } // lean on the gear (~3 N·mm)
  assert.ok(Math.abs(turned() - before) < 3, `gear turned ${(turned() - before).toFixed(1)}°`);
  sim.dispose();
});

test('self-collision: an arm swinging down is stopped by the robot body', async () => {
  // a third motor on top of the hub, output to the side; a 15-hole arm pinned to its output, pointing back over the hub
  const spec = [
    ...SPIKE_BOT,
    ['54675.dat', [0, -250, 0], [0, 1, 0, -1, 0, 0, 0, 0, 1]],
    ['32278.dat', [-60, -250, 140], [0, 1, 0, -1, 0, 0, 0, 0, 1]],
    ['2780.dat', [-50, -250, 20]],
  ];
  const swing = async key => {
    const sim = await createSim(buildRobot(spec), { items: [] });
    const arm = sim.telemetry().motors.find(m => m.role === 'aux');
    run(sim, 0.3, 0);
    sim.setSpeed(0.3);
    run(sim, 1.5, 0, 0, new Set([arm.keys[key]]));
    const angle = sim.telemetry().motors.find(m => m.role === 'aux').angle;
    sim.dispose();
    return Math.abs(angle);
  };
  const [one, other] = [await swing(0), await swing(1)];
  // one way the arm swings up freely; the other way it lands on the hub within a few tens of degrees
  assert.ok(Math.max(one, other) > 150, `free swing ${Math.max(one, other)}°`);
  assert.ok(Math.min(one, other) < 40, `blocked swing ${Math.min(one, other)}° (no self-collision would reach ~60° at the floor)`);
});
