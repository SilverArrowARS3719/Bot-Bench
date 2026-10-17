import * as THREE from 'three';
import { isWheelPart, isRubber, isCasterBall } from './parts.js';
import { MOTORS, DEFAULT_MOTOR } from './data/motors.js';
import { transformSnap, findConnections } from './snaps.js';

// Works out how a model moves, from how its parts are connected:
//   rigid groups  — parts locked together (axle in axle hole, friction pin, stud)
//   hinges        — groups that can turn against each other (axle in round hole, smooth pin)
//   motors        — each motor's body and its spinning output (rotor), and what the output drives
//   gears         — meshing gears in different groups
//   wheels, ball castors
// Everything here is in the model frame (LDU, LDraw axes); the sim converts to metres.

export const gearTeeth = name => +((/Gear\s+(\d+)\s+Tooth/i.exec(name || '') || [])[1] || 0);
export const isHub = info => info.cat === 'Electric' && /\bHub\b|Mindstorms (EV3|NXT)\b/.test(info.name || '') && !/Drive Hub|Motor|Handset/i.test(info.name || '');
const LDU_PER_MM = 2.5;

// parts: [{ info, snaps (part frame), local (Matrix4 part -> model) , grams }]
export function analyseMechanism(parts) {
  const N = parts.length;
  const centre = parts.map(p => p.info.box.getCenter(new THREE.Vector3()).applyMatrix4(p.local));
  const boxes = parts.map(p => p.info.box.clone().applyMatrix4(p.local).expandByScalar(2));

  // Motor outputs: snaps on the drive hub, or failing that the motor's axle holes.
  const snaps = parts.map(p => {
    if (!MOTORS[p.info.file]) return p.snaps;
    if (p.snaps.some(s => s.rotor)) return p.snaps;
    return p.snaps.map(s => (s.gender === 'F' && s.shape === 'A' ? { ...s, rotor: true } : s));
  });
  const entries = parts.map((p, i) => ({ name: p.info.name, snaps: snaps[i].map(s => transformSnap(s, p.local)) }));
  const conns = findConnections(entries);

  // node ids: 0..N-1 parts, then one extra node per motor for its rotor
  const motorParts = parts.map((p, i) => (MOTORS[p.info.file] ? i : -1)).filter(i => i >= 0);
  const rotorNode = new Map(motorParts.map((k, j) => [k, N + j]));
  let nodeCount = N + motorParts.length;
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; return a !== b; };
  const addNode = () => { parent.push(nodeCount); return nodeCount++; };

  const degree = new Array(N).fill(0);
  const hinges = [];
  for (const c of conns) {
    degree[c.a]++; degree[c.b]++;
    const a = c.rotorA && rotorNode.has(c.a) ? rotorNode.get(c.a) : c.a;
    const b = c.rotorB && rotorNode.has(c.b) ? rotorNode.get(c.b) : c.b;
    if (c.kind === 'fixed') union(a, b);
    else hinges.push({ a, b, axis: c.axis, point: c.point });
  }

  // Each motor: body <-> rotor hinge along the output axle, positive = clockwise seen from the output face.
  const motors = motorParts.map(k => {
    const s = entries[k].snaps.find(x => x.rotor && x.shape === 'A') || entries[k].snaps.find(x => x.rotor);
    const point = s ? s.p.clone() : centre[k].clone();
    const axis = s ? s.d.clone() : new THREE.Vector3(1, 0, 0);
    if (centre[k].clone().sub(point).dot(axis) < 0) axis.negate(); // point into the motor
    const m = { part: k, spec: MOTORS[parts[k].info.file], node: rotorNode.get(k), axis, point, assumed: false };
    hinges.push({ a: k, b: m.node, axis, point, motor: m });
    return m;
  });

  // Loose wheels (no snap connections, e.g. placed by eye): cluster rim + tyre, then hang them on the
  // motor whose output axle they sit on, or on a free hinge.
  const wheelInfo = new Map(); // part index -> { axis, radius, width, centre } (model frame)
  for (let i = 0; i < N; i++) {
    if (!isWheelPart(parts[i].info)) continue;
    const size = parts[i].info.box.getSize(new THREE.Vector3()).toArray();
    const [x, y, z] = [[0, 1, 2], [0, 2, 1], [1, 2, 0]].reduce((best, p) =>
      Math.abs(size[p[0]] - size[p[1]]) < Math.abs(size[best[0]] - size[best[1]]) ? p : best);
    const axis = new THREE.Vector3().setComponent(z, 1).transformDirection(parts[i].local);
    wheelInfo.set(i, { axis, radius: Math.max(size[x], size[y]) / 2, width: size[z], centre: centre[i] });
  }
  const looseWheels = [...wheelInfo.keys()].filter(i => degree[i] === 0);
  const clusters = [];
  for (const i of looseWheels) {
    const w = wheelInfo.get(i);
    const c = clusters.find(c => c.centre.distanceTo(w.centre) < 15 && Math.abs(c.axis.dot(w.axis)) > 0.95);
    if (c) c.parts.push(i);
    else clusters.push({ parts: [i], centre: w.centre.clone(), axis: w.axis.clone() });
  }
  for (const c of clusters) {
    c.parts.slice(1).forEach(i => union(c.parts[0], i));
    let best = null, bestD = Infinity;
    for (const m of motors) {
      const rel = m.point.clone().sub(c.centre);
      const along = Math.abs(rel.dot(c.axis));
      const off = rel.addScaledVector(c.axis, -rel.dot(c.axis)).length();
      // the output axle line passes through the wheel, or (older models) the motor body sits on the wheel's axle line
      const bodyRel = centre[m.part].clone().sub(c.centre);
      const bodyOff = bodyRel.clone().addScaledVector(c.axis, -bodyRel.dot(c.axis)).length();
      const d = Math.abs(m.axis.dot(c.axis)) > 0.95 && off < 10 ? along : bodyOff < 100 && Math.abs(bodyRel.dot(c.axis)) < 300 ? 1000 + bodyOff : Infinity;
      if (d < bestD) { best = m; bestD = d; }
    }
    if (best) {
      union(best.node, c.parts[0]);
      if (bestD >= 1000) { best.axis.copy(c.axis); best.point.copy(c.centre); } // drive along the wheel's own axle (shared with its hinge)
    } else if (!motors.length) {
      const node = addNode();
      const m = { part: -1, spec: DEFAULT_MOTOR, node, axis: c.axis.clone(), point: c.centre.clone(), assumed: true };
      union(node, c.parts[0]);
      hinges.push({ a: -1, b: node, axis: m.axis, point: m.point, motor: m });
      motors.push(m);
    } else {
      hinges.push({ a: -1, b: c.parts[0], axis: c.axis.clone(), point: c.centre.clone() }); // free wheel on the chassis
    }
  }

  // Ball castors are their own body on a ball joint.
  const castors = [];
  for (let i = 0; i < N; i++) if (isCasterBall(parts[i].info) && degree[i] === 0) castors.push(i);

  // Root (chassis): the hub's group, else the heaviest group.
  const grams = i => parts[i].grams;
  const hubIdx = parts.findIndex(p => isHub(p.info));
  const groupMass = () => {
    const m = new Map();
    for (let i = 0; i < N; i++) if (!castors.includes(i)) m.set(find(i), (m.get(find(i)) || 0) + grams(i));
    return m;
  };
  let root = hubIdx >= 0 ? find(hubIdx) : [...groupMass()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const resolveRoot = () => { root = find(hubIdx >= 0 ? hubIdx : root); };
  for (const h of hinges) if (h.a === -1) h.a = root; // free wheels / assumed motors hang on the chassis

  // Hinges between the same two groups that don't share one axis line lock those groups together.
  for (let changed = true; changed;) {
    changed = false;
    resolveRoot();
    const byPair = new Map();
    for (const h of hinges) {
      const a = find(h.a), b = find(h.b);
      if (a === b) continue;
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!byPair.has(k)) byPair.set(k, []);
      byPair.get(k).push(h);
    }
    for (const list of byPair.values()) {
      const [h0] = list;
      const colinear = list.every(h => Math.abs(h.axis.dot(h0.axis)) > 0.99 &&
        h.point.clone().sub(h0.point).cross(h0.axis).length() < 1.5);
      if (!colinear) { union(h0.a, h0.b); changed = true; }
    }
  }

  // Anything not linked to the chassis through joints (a part sitting there unpinned, a floating
  // sub-assembly) is glued rigidly to whatever it touches, or to the chassis.
  // One at a time, so a motor gets attached before the wheel hanging off its output is considered.
  // Gears are held by their axle, never by touching (and a round gear's box overlaps things it doesn't touch).
  const isGear = parts.map(p => gearTeeth(p.info.name) > 0 || /^Technic Worm Gear/i.test(p.info.name || ''));
  const notes = [];
  for (let pass = 0; pass <= N; pass++) {
    resolveRoot();
    const reach = new Set([find(root)]);
    for (let grow = true; grow;) {
      grow = false;
      for (const h of hinges) {
        const a = find(h.a), b = find(h.b);
        if (reach.has(a) !== reach.has(b)) { reach.add(a); reach.add(b); grow = true; }
      }
    }
    const strays = [...new Set(parts.map((_, i) => find(i)))].filter(g => !reach.has(g) && !castors.some(c => find(c) === g));
    if (!strays.length) break;
    let pick = null;
    for (const g of strays) {
      for (let i = 0; i < N && !pick; i++) {
        if (find(i) !== g) continue;
        for (let j = 0; j < N && !pick; j++)
          if (reach.has(find(j)) && !castors.includes(j) && !isGear[i] && !isGear[j] && boxes[i].intersectsBox(boxes[j])) pick = [find(j), g];
      }
      if (pick) break;
    }
    if (pick) union(pick[0], pick[1]);
    else {
      // nothing touches: glue a plain structural piece (no gears or wheels) first, so what hangs off it can still turn
      const moving = g => parts.some((p, i) => find(i) === g && (isGear[i] || isWheelPart(p.info)));
      const stray = strays.find(g => !moving(g)) ?? strays[0];
      const count = parts.filter((_, i) => find(i) === stray).length;
      union(find(root), stray);
      notes.push(`${count} part(s) aren't touching the robot; they were glued to the chassis.`);
    }
  }
  resolveRoot();

  // Gears that mesh across different groups.
  const gears = [];
  for (let i = 0; i < N; i++) {
    const name = parts[i].info.name || '';
    const worm = /^Technic Worm Gear/i.test(name);
    const teeth = gearTeeth(name);
    if (!teeth && !worm) continue;
    const hole = entries[i].snaps.find(s => s.gender === 'F' && s.shape === 'A') || entries[i].snaps.find(s => s.gender === 'F');
    if (!hole) continue;
    const size = parts[i].info.box.getSize(new THREE.Vector3());
    // module 1: pitch radius = teeth / 2 mm; a worm's pitch radius is its outside radius less one module
    const r = worm ? Math.min(size.x, size.y, size.z) / 2 - LDU_PER_MM : (teeth / 2) * LDU_PER_MM;
    const length = worm ? Math.max(size.x, size.y, size.z) : 0;
    gears.push({ part: i, teeth, worm, r, length, centre: centre[i], axis: hole.d.clone(), bevel: /bevel/i.test(name) });
  }
  const meshes = [];
  for (let x = 0; x < gears.length; x++) for (let y = x + 1; y < gears.length; y++) {
    let g1 = gears[x], g2 = gears[y];
    if (find(g1.part) === find(g2.part)) continue;
    if (g1.worm && g2.worm) continue;
    if (g1.worm || g2.worm) {
      // worm screw across a spur gear: axles at right angles, gear sitting on the worm, its plane through the worm's axle
      if (g2.worm) [g1, g2] = [g2, g1];
      const rel = g2.centre.clone().sub(g1.centre);
      const along = rel.dot(g1.axis);
      const off = rel.clone().addScaledVector(g1.axis, -along).length();
      if (Math.abs(g1.axis.dot(g2.axis)) < 0.1 && Math.abs(off - (g1.r + g2.r)) < 3 && Math.abs(along) < g1.length / 2 + 4 && Math.abs(rel.dot(g2.axis)) < 6)
        meshes.push({ a: g1, b: g2, worm: true });
      continue;
    }
    const rel = g2.centre.clone().sub(g1.centre);
    const dot = g1.axis.dot(g2.axis);
    let ok = false;
    if (Math.abs(dot) > 0.99) {
      const axial = rel.dot(g1.axis);
      const radial = rel.clone().addScaledVector(g1.axis, -axial).length();
      ok = Math.abs(radial - (g1.r + g2.r)) < 2.5 && Math.abs(axial) < 6;
    } else if (Math.abs(dot) < 0.1 && (g1.bevel || g2.bevel)) {
      const off = (p, g) => { const r = p.clone().sub(g.centre); return r.addScaledVector(g.axis, -r.dot(g.axis)).length(); };
      ok = off(g1.centre, g2) < g2.r + 8 && off(g2.centre, g1) < g1.r + 8 && rel.length() < g1.r + g2.r + 4;
    }
    if (ok) meshes.push({ a: g1, b: g2 });
  }

  // Final groups.
  const ids = [...new Set([...parts.map((_, i) => find(i)), ...motors.map(m => find(m.node))])];
  const groups = ids.map(id => ({ id, parts: parts.map((_, i) => i).filter(i => find(i) === id && !castors.includes(i)) }));
  const groupOf = id => groups.findIndex(g => g.id === find(id));
  const joints = [];
  const seenPair = new Set();
  for (const h of hinges) {
    const a = groupOf(h.a), b = groupOf(h.b);
    if (a === b || a < 0 || b < 0) continue;
    const k = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (h.motor) { h.motor.body = a; h.motor.rotor = b; }
    if (seenPair.has(k)) continue;
    seenPair.add(k);
    joints.push({ a, b, axis: h.axis.clone(), point: h.point.clone() });
  }
  for (const m of motors) if (m.body === undefined) { m.body = groupOf(m.part >= 0 ? m.part : root); m.rotor = groupOf(m.node); }

  return {
    groups,
    root: groupOf(root),
    joints,
    motors: motors.map(m => ({ part: m.part, spec: m.spec, body: m.body, rotor: m.rotor, axis: m.axis, point: m.point, assumed: m.assumed, stalled: m.body === m.rotor })),
    gears: meshes.map(({ a, b, worm }) => ({ worm: !!worm, a: { ...a, group: groupOf(a.part) }, b: { ...b, group: groupOf(b.part) } })),
    wheels: [...wheelInfo].map(([part, w]) => ({ part, group: groupOf(part), ...w, rubber: isRubber(parts[part].info) })),
    castors: castors.map(i => {
      let host = null;
      for (let j = 0; j < N && host === null; j++) if (j !== i && !castors.includes(j) && boxes[i].intersectsBox(boxes[j])) host = groupOf(j);
      return { part: i, group: host ?? groupOf(root), centre: centre[i], radius: parts[i].info.box.getSize(new THREE.Vector3()).x / 2 };
    }),
    connections: conns,
    notes,
  };
}
