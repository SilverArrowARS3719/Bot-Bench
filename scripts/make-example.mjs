// Writes examples/spike-drive-base.ldr: a SPIKE Prime drive base built from real connections, and prints how the sim sees it.
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { servePublic } from '../test/serve.mjs';
import { initParts, partInfo } from '../src/parts.js';
import { partSnaps } from '../src/snaps.js';
import { analyseMechanism } from '../src/mechanism.js';
import { massGrams } from '../src/data/weights.js';
import { serializeLdr } from '../src/ldr.js';
const I = [1,0,0,0,1,0,0,0,1];
const MOTOR_R = [0,1,0,-1,0,0,0,0,1], MOTOR_L = [0,-1,0,1,0,0,0,0,1], WHEEL = [0,0,1,0,1,0,-1,0,0];
const spec = [
  ['54675.dat', '15', [50, -70, 0], MOTOR_R],
  ['54675.dat', '15', [-50, -70, 0], MOTOR_L],
  ['4519.dat', '0', [90, -70, 0], I],
  ['4519.dat', '0', [-90, -70, 0], I],
  ['39367p02.dat', '15', [100, -70, 0], WHEEL],
  ['39367p02.dat', '15', [-100, -70, 0], WHEEL],
  ['45601c01.dat', '15', [0, -120, 60], I],
  ['52629.dat', '0', [0, -24, 175], I],
];
const srv = await servePublic();
await initParts(srv.base);
const parts = await Promise.all(spec.map(async ([file, , p, r]) => {
  const info = await partInfo(file);
  return { info, snaps: await partSnaps(file), local: new THREE.Matrix4().set(r[0],r[1],r[2],p[0], r[3],r[4],r[5],p[1], r[6],r[7],r[8],p[2], 0,0,0,1), grams: massGrams(info) };
}));
const m = analyseMechanism(parts);
console.log('connections', m.connections.map(c => `${spec[c.a][0]}-${spec[c.b][0]} ${c.kind}${c.rotorA||c.rotorB?' (rotor)':''}`));
console.log('groups', m.groups.map(g => g.parts.map(i => spec[i][0]).join('+')));
console.log('joints', m.joints.length, 'motors', m.motors.map(x => `${x.spec.name} body ${x.body} rotor ${x.rotor} stalled ${x.stalled}`));
console.log('wheels', m.wheels.map(w => `g${w.group} r${w.radius}`), 'castors', m.castors.length, 'notes', m.notes);
writeFileSync(new URL('../examples/spike-drive-base.ldr', import.meta.url), serializeLdr(spec.map(([file, color, p, r]) => ({ file, color, m: [...p, ...r] })), 'spike-drive-base.ldr'));
srv.close();
