import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { partInfo } from './parts.js';
import { partSnaps } from './snaps.js';
import { massGrams } from './data/weights.js';
import { motorPhysics } from './data/motors.js';
import { SENSORS, SENSOR_COLOURS } from './data/devices.js';
import { analyseMechanism, isHub } from './mechanism.js';
import { boxDecompose } from './voxel.js';

// Coefficients of friction. Pairs combine with "Min": rubber on a vinyl mat ≈ 1.0, plastic on mat ≈ 0.35.
export const FRICTION = { rubber: 1.0, plastic: 0.35, floor: 1.0, obstacle: 0.6 };
const STEP = 1 / 240; // s; small LEGO parts need a short step to stay stable
const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
// Collision groups (membership << 16 | filter). Robot parts can hit each other too; contactFilter below
// skips the pairs that already touch in the build (an axle in its hole, a wheel against its motor).
const ROBOT = (0x0001 << 16) | 0x0003;
const WORLD = (0x0002 << 16) | 0x0003;
const RAY = (0x0002 << 16) | 0x0002;
const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'];
const WORM_LEAD = Math.PI * 0.001; // m per turn: a single-start worm advances one module-1 tooth (π mm) per revolution
const AUX_KEYS = [['q', 'e'], ['z', 'c'], ['r', 'f'], ['t', 'g']];

// Open parts (frames, open-centre liftarms, U-shapes) get boxes that keep their openings open; everything
// else gets one convex hull. A beam's 4.8 mm pin holes filled in almost never matters, while hundreds of
// little boxes per beam would make a big robot crawl.
const shapeCache = new Map();
export const OPEN_PART_FILL = 0.45;
export function collisionShape(info) {
  if (!shapeCache.has(info.file)) {
    const s = info.box.getSize(new THREE.Vector3());
    const fill = info.volumeMm3 / (s.x * s.y * s.z * 0.064);
    shapeCache.set(info.file, fill < OPEN_PART_FILL ? boxDecompose(info.tris, info.box, 4, 48) : null);
  }
  return shapeCache.get(info.file);
}

let rapierReady = null;

// robotRoot: placed robot (descendants with userData.part). arena: { items, mat }.
// opts: { reverse, ports: { deviceKey: 'A' } }
export async function createSim(robotRoot, arena, { reverse = false, ports = {}, roles = {} } = {}) {
  rapierReady ??= RAPIER.init();
  await rapierReady;

  robotRoot.updateMatrixWorld(true);
  const objs = [];
  robotRoot.traverse(o => { if (o.userData.part) objs.push(o); });
  if (!objs.length) throw new Error('Build a robot first: the model is empty.');
  const modelRoot = objs[0].parent;
  const M2W = modelRoot.matrixWorld.clone(); // model (LDU) -> world (m)
  const S = new THREE.Vector3().setFromMatrixScale(M2W).x; // metres per LDU
  const toW = p => p.clone().applyMatrix4(M2W);
  const dirW = d => d.clone().transformDirection(M2W);

  const infos = await Promise.all(objs.map(o => partInfo(o.userData.file)));
  const snapLists = await Promise.all(objs.map(o => partSnaps(o.userData.file).catch(() => [])));
  const parts = objs.map((o, i) => ({ obj: o, info: infos[i], snaps: snapLists[i], local: o.matrix.clone(), world: o.matrixWorld.clone(), grams: massGrams(infos[i]) }));
  const mech = analyseMechanism(parts);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  world.integrationParameters.lengthUnit = 0.1; // contact tolerances scaled for a 10 cm-sized robot (0.1 mm slop)
  world.integrationParameters.numSolverIterations = 8;
  const MIN = RAPIER.CoefficientCombineRule.Min;
  const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.05, 10).setTranslation(0, -0.05, 0)
    .setFriction(FRICTION.floor).setFrictionCombineRule(MIN).setCollisionGroups(WORLD));

  const visuals = new THREE.Group();
  const tracked = [];
  const track = (body, vis) => {
    const p = new THREE.Vector3().copy(body.translation()), q = new THREE.Quaternion().copy(body.rotation());
    tracked.push({ body, vis, p0: p.clone(), q0: q.clone(), p1: p, q1: q });
  };
  const cloneAt = (obj, matrix) => {
    const c = obj.clone();
    c.matrixAutoUpdate = false;
    c.matrix.copy(matrix);
    return c;
  };

  // ---- one body per rigid group, placed at the world origin so world coordinates = body coordinates at t=0 ----
  const wheelOf = new Map(mech.wheels.map(w => [w.part, w]));
  const groupVis = [];
  const bodies = mech.groups.map((g, gi) => {
    if (!g.parts.length) return null;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const vis = new THREE.Group();
    for (const i of g.parts) {
      const p = parts[i];
      p.vis = cloneAt(p.obj, p.world);
      vis.add(p.vis);
      const mass = p.grams / 1000;
      const wheel = wheelOf.get(i);
      if (wheel) {
        const c = toW(wheel.centre), axis = dirW(wheel.axis), r = wheel.radius * S, w = wheel.width * S;
        const border = Math.min(0.001, r * 0.2, w * 0.2);
        world.createCollider(RAPIER.ColliderDesc.roundCylinder(w / 2 - border, r - border, border)
          .setTranslation(c.x, c.y, c.z).setRotation(new THREE.Quaternion().setFromUnitVectors(UP, axis)).setMass(mass)
          .setFriction(wheel.rubber ? FRICTION.rubber : FRICTION.plastic).setFrictionCombineRule(MIN).setCollisionGroups(ROBOT), body);
        continue;
      }
      const mu = p.info.cat === 'Tyre' || /rubber/i.test(p.info.name || '') ? FRICTION.rubber : FRICTION.plastic;
      const boxes = collisionShape(p.info);
      if (boxes) {
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
        p.world.decompose(pos, quat, scl);
        let vol = 0;
        for (let k = 0; k < boxes.length; k += 6) vol += boxes[k + 3] * boxes[k + 4] * boxes[k + 5];
        for (let k = 0; k < boxes.length; k += 6) {
          const c = new THREE.Vector3(boxes[k], boxes[k + 1], boxes[k + 2]).applyMatrix4(p.world);
          world.createCollider(RAPIER.ColliderDesc.cuboid(boxes[k + 3] * S, boxes[k + 4] * S, boxes[k + 5] * S)
            .setTranslation(c.x, c.y, c.z).setRotation(quat)
            .setMass((mass * boxes[k + 3] * boxes[k + 4] * boxes[k + 5]) / vol)
            .setFriction(mu).setFrictionCombineRule(MIN).setCollisionGroups(ROBOT), body);
        }
        continue;
      }
      const src = p.info.points, pts = new Float32Array(src.length), v = new THREE.Vector3();
      for (let n = 0; n < src.length; n += 3) {
        v.set(src[n], src[n + 1], src[n + 2]).applyMatrix4(p.world);
        pts[n] = v.x; pts[n + 1] = v.y; pts[n + 2] = v.z;
      }
      const desc = pts.length >= 12 && RAPIER.ColliderDesc.convexHull(pts);
      if (desc) world.createCollider(desc.setMass(mass).setFriction(mu).setFrictionCombineRule(MIN).setCollisionGroups(ROBOT), body);
    }
    visuals.add(vis);
    track(body, vis);
    groupVis[gi] = vis;
    return body;
  });
  const rootBody = bodies[mech.root];

  // ---- ball castors: a real ball on a ball joint, so it rolls ----
  const castorPairs = [];
  for (const c of mech.castors) {
    const p = parts[c.part], host = bodies[c.group];
    const centre = toW(c.centre), r = c.radius * S;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z));
    world.createCollider(RAPIER.ColliderDesc.ball(r).setMass(p.grams / 1000).setFriction(FRICTION.plastic)
      .setFrictionCombineRule(MIN).setCollisionGroups(ROBOT), body);
    if (host) castorPairs.push([host, body, centre]);
    const vis = new THREE.Group();
    vis.add(cloneAt(p.obj, new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z).multiply(p.world)));
    visuals.add(vis);
    track(body, vis);
  }

  // ---- hinges (created after the self-collision survey below, so its throwaway step can't leave the joints
  // holding stale impulses that would kick the parts on the first real step) ----
  function createJoints() {
    for (const [host, ball, centre] of castorPairs)
      world.createImpulseJoint(RAPIER.JointData.spherical(centre, { x: 0, y: 0, z: 0 }), host, ball, true).setContactsEnabled(false);
    for (const j of mech.joints) {
      if (!bodies[j.a] || !bodies[j.b]) continue;
      const p = toW(j.point), a = dirW(j.axis);
      // contacts stay on: an arm on a hinge must still hit the chassis it's hinged to (see contactFilter)
      world.createImpulseJoint(RAPIER.JointData.revolute(p, p, a), bodies[j.a], bodies[j.b], true);
    }
  }

  // ---- gear meshes: keep the tooth contact points moving together ----
  const gears = mech.gears.filter(m => bodies[m.a.group] && bodies[m.b.group]).map(m => ({
    b1: bodies[m.a.group], b2: bodies[m.b.group],
    c1: toW(m.a.centre), a1: dirW(m.a.axis), r1: m.a.r * S, c2: toW(m.b.centre), a2: dirW(m.b.axis), r2: m.b.r * S,
    q1: new THREE.Quaternion(), q2: new THREE.Quaternion(),
    worm: m.worm, groupA: m.a.group, locked: false,
  }));
  const contact = (c1, a1, r1, c2) => {
    const towards = c2.clone().sub(c1);
    return c1.clone().add(towards.addScaledVector(a1, -towards.dot(a1)).setLength(r1));
  };
  // Where a worm touches its gear: on the worm's surface, in line with the gear's centre. The gear's tooth
  // there moves along the worm's axle.
  const wormContact = (cw, aw, rw, cg) => {
    const foot = cw.clone().addScaledVector(aw, cg.clone().sub(cw).dot(aw));
    return foot.add(cg.clone().sub(foot).setLength(rw));
  };
  // gear ratio ω2/ω1 from the contact geometry (sign included); used to find what each motor drives
  const meshRatio = (c1, a1, r1, c2, a2, worm) => {
    if (worm) { // one worm turn moves the gear on by one tooth
      const P = wormContact(c1, a1, r1, c2), k2 = a2.clone().cross(P.clone().sub(c2)).dot(a1);
      return Math.abs(k2) < 1e-9 ? 0 : WORM_LEAD / (2 * Math.PI) / k2;
    }
    const P = contact(c1, a1, r1, c2), t = a1.clone().cross(P.clone().sub(c1)).normalize();
    const k1 = a1.clone().cross(P.clone().sub(c1)).dot(t), k2 = a2.clone().cross(P.clone().sub(c2)).dot(t);
    return Math.abs(k2) < 1e-9 ? 0 : k1 / k2;
  };

  // ---- motors ----
  const robotCom = new THREE.Vector3();
  let robotGrams = 0;
  parts.forEach(p => { robotCom.addScaledVector(p.info.box.getCenter(new THREE.Vector3()).applyMatrix4(p.world), p.grams); robotGrams += p.grams; });
  robotCom.divideScalar(robotGrams || 1);

  const drivenGroups = new Set();
  const motors = mech.motors.map((m, idx) => {
    const phys = motorPhysics(m.spec);
    const axis = dirW(m.axis), body = bodies[m.body], rotor = m.stalled ? null : bodies[m.rotor];
    if (rotor && rotor !== rootBody) {
      // the gearbox and rotor add inertia at the output
      const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
      rotor.setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 1e-9, y: phys.inertia, z: 1e-9 }, q, true);
    }
    // what this output turns: its own group, plus anything reached through meshing gears
    const reach = new Map([[m.rotor, { ratio: 1, axis }]]);
    for (let grow = true; grow;) {
      grow = false;
      // (a worm drives its gear, but a gear can't turn a worm)
      for (const g of gears.length ? mech.gears : []) for (const [from, to, A, B] of g.worm ? [[g.a, g.b, g.a, g.b]] : [[g.a, g.b, g.a, g.b], [g.b, g.a, g.b, g.a]]) {
        if (!reach.has(from.group) || reach.has(to.group)) continue;
        const prev = reach.get(from.group);
        const a1 = dirW(A.axis), a2 = dirW(B.axis);
        const r = meshRatio(toW(A.centre), a1, A.r * S, toW(B.centre), a2, g.worm) * prev.ratio * Math.sign(prev.axis.dot(a1) || 1);
        reach.set(to.group, { ratio: r, axis: a2 });
        grow = true;
      }
    }
    const wheel = mech.wheels.find(w => reach.has(w.group) && bodies[w.group]);
    for (const g of reach.keys()) drivenGroups.add(g);
    const part = m.part >= 0 ? parts[m.part] : null;
    const key = part ? deviceKey(part) : `assumed${idx}`;
    return {
      ...phys, name: m.spec.name, axisLocal: axis.clone(), body, rotor, part, key, assumed: m.assumed,
      wheel, wheelLink: wheel && reach.get(wheel.group),
      kp: 0, ki: 0, integ: 0, angle: 0, twist: 0, w: 0, load: 0,
      // SPIKE ramps speed changes at 1000 deg/s² unless told otherwise
      mode: 'coast', target: 0, cmd: 0, accel: 1000 * DEG, decel: 1000 * DEG, goal: 0, holdAt: 0, after: 'brake', thenStop: null, done: null, port: null, role: 'aux',
    };
  });
  // a worm screw nothing is turning holds its gear still (friction makes worms self-locking)
  for (const g of gears) if (g.worm) g.locked = !drivenGroups.has(g.groupA);
  const drive = motors.filter(m => m.wheel);
  // the axis the drive wheels turn about defines left/right; the model's front (+Z) is forward
  const right = new THREE.Vector3(1, 0, 0);
  if (drive.length) right.copy(dirW(drive[0].wheel.axis)).projectOnPlane(UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const fwd0 = UP.clone().cross(right);
  if (fwd0.z < -1e-6 || (Math.abs(fwd0.z) <= 1e-6 && fwd0.x < 0)) right.negate();
  if (reverse) right.negate();
  for (const m of motors) {
    if (!m.wheel) continue;
    const s = toW(m.wheel.centre).sub(robotCom).dot(right);
    m.role = Math.abs(s) < 0.002 ? 'centre' : s > 0 ? 'right' : 'left';
    const aw = dirW(m.wheel.axis);
    // positive motor speed -> wheel spin ratio*ω about the wheel's axis; forward needs spin -v/R about "right"
    m.fwdSign = -Math.sign(aw.dot(right) * m.wheelLink.ratio * Math.sign(m.wheelLink.axis.dot(aw) || 1)) || 1;
    m.wheelRadius = m.wheel.radius * S;
    m.ratio = Math.abs(m.wheelLink.ratio);
  }
  // jobs you chose in the Drive tab win over the guess from the wheels
  for (const m of motors) if (['left', 'right', 'centre', 'aux'].includes(roles[m.key])) m.role = roles[m.key];
  const giveKeys = () => { let n = 0; for (const m of motors) m.keys = m.role === 'aux' ? AUX_KEYS[n++] || null : null; };
  giveKeys();

  // ---- sensors ----
  const groupOfPart = new Map();
  mech.groups.forEach((g, gi) => g.parts.forEach(i => groupOfPart.set(i, gi)));
  const sensors = [];
  parts.forEach((p, i) => {
    const spec = SENSORS[p.info.file];
    if (!spec) return;
    const body = bodies[groupOfPart.get(i)];
    if (!body) return;
    sensors.push({ ...spec, part: p, key: deviceKey(p), body, port: null, value: null,
      eye: new THREE.Vector3(...spec.eye).applyMatrix4(p.world),
      dir: new THREE.Vector3(0, 0, -1).transformDirection(p.world) });
  });
  const hubPart = parts.findIndex(p => isHub(p.info));
  const imuBody = bodies[hubPart >= 0 ? groupOfPart.get(hubPart) : mech.root] || rootBody;
  const imuStart = new THREE.Quaternion().copy(imuBody.rotation());
  let yawZero = 0;

  // ---- ports: remembered choices first, then drive motors A/B, other motors, sensors ----
  const devices = [...motors.filter(m => !m.assumed), ...sensors];
  const taken = new Set();
  for (const d of devices) if (ports[d.key] && !taken.has(ports[d.key])) { d.port = ports[d.key]; taken.add(d.port); }
  const order = [...motors.filter(m => m.role === 'left'), ...motors.filter(m => m.role === 'right'), ...motors.filter(m => !['left', 'right'].includes(m.role)), ...sensors];
  for (const d of order) if (!d.port && !d.assumed) { d.port = PORTS.find(p => !taken.has(p)) || null; if (d.port) taken.add(d.port); }

  // ---- self-collision: robot parts push on each other (an arm stops when it swings into the chassis), except
  //  * parts that already touch in the build (an axle in its hole, a beam pinned against a motor),
  //  * meshing gears, and a castor ball in its holder,
  //  * across a hinge: faces that just slide past each other, and anything right round the axle
  //    (for a motor that's its whole spinning output disc, which is part of the motor's own shape here) ----
  // handles are opaque numbers; give every robot collider and body a small index so pair keys are plain integers
  const index = new Map();
  const id = h => { let i = index.get(h); if (i === undefined) index.set(h, (i = index.size)); return i; };
  const pairKey = (a, b) => { const i = id(a), j = id(b); return i < j ? i * 1e6 + j : j * 1e6 + i; };
  const robotBodies = new Set(tracked.map(t => t.body.handle));
  const shapes = new Map(); // collider -> its start-pose points (world), centre and radius
  world.forEachCollider(c => {
    if (!robotBodies.has(c.parent()?.handle)) return;
    c.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    shapes.set(c.handle, colliderPoints(c));
  });
  const ignored = new Set();
  const ignoredBodies = new Set([...gears.map(g => pairKey(g.b1.handle, g.b2.handle)), ...castorPairs.map(([a, b]) => pairKey(a.handle, b.handle))]);
  const hinges = new Map();
  for (const j of mech.joints) {
    if (!bodies[j.a] || !bodies[j.b]) continue;
    const motorJoint = mech.motors.some(m => (m.body === j.a && m.rotor === j.b) || (m.body === j.b && m.rotor === j.a));
    hinges.set(pairKey(bodies[j.a].handle, bodies[j.b].handle), { p: toW(j.point), a: dirW(j.axis), r: motorJoint ? 0.02 : 0.005 });
  }
  const verdicts = new Map();
  function collide(c1, c2, b1, b2) {
    const k = pairKey(c1, c2);
    let ok = verdicts.get(k);
    if (ok !== undefined) return ok;
    ok = !ignored.has(k) && !ignoredBodies.has(pairKey(b1, b2));
    const h = ok && hinges.get(pairKey(b1, b2));
    if (h) {
      // the hinged body only turns about the axle, so these measurements stay true as it moves
      const s1 = shapes.get(c1), s2 = shapes.get(c2);
      const along = s => s.pts.reduce(([lo, hi], v) => { const t = v.clone().sub(h.p).dot(h.a); return [Math.min(lo, t), Math.max(hi, t)]; }, [Infinity, -Infinity]);
      const off = v => { const r = v.clone().sub(h.p); return r.addScaledVector(h.a, -r.dot(h.a)).length(); };
      const inside = s => Math.max(...s.pts.map(off)) < h.r; // wholly within the axle zone (an axle, a pin on the output)
      const reaches = s => off(s.centre) - s.radius < h.r; // some of it is in the zone (the hole round that axle)
      const [l1, u1] = along(s1), [l2, u2] = along(s2);
      if (Math.min(u1, u2) - Math.max(l1, l2) < 0.001) ok = false;
      else if ((inside(s1) && reaches(s2)) || (inside(s2) && reaches(s1))) ok = false;
    }
    verdicts.set(k, ok);
    return ok;
  }
  const events = new RAPIER.EventQueue(true); // Rapier only runs contact hooks when given an event queue
  const contactFilter = {
    filterContactPair(c1, c2, b1, b2) {
      if (!shapes.has(c1) || !shapes.has(c2)) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      return b1 !== b2 && collide(c1, c2, b1, b2) ? RAPIER.SolverFlags.COMPUTE_IMPULSE : null;
    },
    filterIntersectionPair: () => true,
  };
  // Which parts already touch? Ask the shapes directly (stepping the world to find out leaves Rapier holding
  // impulses from the overlaps, which then kick parts on the first real step).
  world.propagateModifiedBodyPositionsToColliders();
  world.updateSceneQueries();
  for (const [h, sh] of shapes) {
    const c = world.getCollider(h), box = new THREE.Box3().setFromPoints(sh.pts);
    const centre = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).addScalar(0.0005);
    world.collidersWithAabbIntersectingAabb(centre, half, o => {
      if (o.handle !== h && shapes.has(o.handle) && o.parent().handle !== c.parent().handle) {
        const hit = c.contactCollider(o, 0.0005);
        if (hit && hit.distance < 0.0005) ignored.add(pairKey(h, o.handle));
      }
      return true;
    });
  }
  createJoints();

  // ---- arena obstacles ----
  const obstacleColour = new Map();
  for (const { obj, def } of arena.items) {
    obj.updateMatrixWorld(true);
    const bodyDesc = (def.fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(obj.position.x, obj.position.y, obj.position.z).setRotation(obj.quaternion);
    if (def.type === 'ldraw') {
      // a LEGO model: one body made of each part's hull, each with that part's real mass
      const body = world.createRigidBody(bodyDesc), toObj = obj.matrixWorld.clone().invert(), v = new THREE.Vector3();
      const legoParts = [];
      obj.traverse(o => { if (o.userData.part) legoParts.push(o); });
      for (const part of legoParts) {
        const info = await partInfo(part.userData.file);
        const m = toObj.clone().multiply(part.matrixWorld), pts = new Float32Array(info.points.length);
        for (let n = 0; n < pts.length; n += 3) {
          v.set(info.points[n], info.points[n + 1], info.points[n + 2]).applyMatrix4(m);
          pts[n] = v.x; pts[n + 1] = v.y; pts[n + 2] = v.z;
        }
        const desc = pts.length >= 12 && RAPIER.ColliderDesc.convexHull(pts);
        if (!desc) continue;
        const col = world.createCollider(desc.setFriction(FRICTION.obstacle).setFrictionCombineRule(MIN)
          .setMass(def.fixed ? 0 : massGrams(info) / 1000).setCollisionGroups(WORLD), body);
        obstacleColour.set(col.handle, new THREE.Color(def.color));
      }
      if (!def.fixed) track(body, obj);
      continue;
    }
    const desc = obstacleCollider(obj, def);
    if (!desc) continue;
    const body = world.createRigidBody(bodyDesc);
    const col = world.createCollider(desc.setFriction(FRICTION.obstacle).setFrictionCombineRule(MIN).setMass(def.fixed ? 0 : def.massG / 1000).setCollisionGroups(WORLD), body);
    obstacleColour.set(col.handle, new THREE.Color(def.color));
    if (!def.fixed) track(body, obj);
  }

  // ---- control loop ----
  const input = { fwd: 0, turn: 0, keys: new Set() };
  let speedFrac = 0.75, turnFrac = 0.3, acc = 0, distance = 0, stopMode = 'brake', time = 0, program = false;
  const axisW = new THREE.Vector3(), tmp = new THREE.Vector3(), cv = new THREE.Vector3();

  // Inertia of a body about an axis through its centre of mass.
  const inertiaAbout = (b, a) => {
    const I = b.effectiveAngularInertia();
    return a.x * (I.m11 * a.x + I.m12 * a.y + I.m13 * a.z) + a.y * (I.m12 * a.x + I.m22 * a.y + I.m23 * a.z) + a.z * (I.m13 * a.x + I.m23 * a.y + I.m33 * a.z);
  };

  function motorStep(m) {
    let wRel;
    if (m.rotor) {
      axisW.copy(m.axisLocal).applyQuaternion(m.body.rotation());
      cv.copy(m.body.angvel());
      wRel = tmp.copy(m.rotor.angvel()).sub(cv).dot(axisW);
      // The torque turns the output one way and the housing the other, so the controller sees both inertias
      // in series. Sizing the gain from that keeps a light motor (a lone motor, a small arm) from oscillating.
      const ir = inertiaAbout(m.rotor, axisW) || m.inertia, ib = inertiaAbout(m.body, axisW) || Infinity;
      m.kp = (0.5 / STEP) / (1 / ir + 1 / ib);
      m.ki = m.kp * 10;
    } else {
      // nothing attached (or locked): the output just follows the command, like a motor on the bench
      wRel = m.mode === 'speed' ? m.target : m.mode === 'position' ? Math.sign(m.goal - m.angle) * Math.min(Math.abs(m.target), Math.abs(m.goal - m.angle) / STEP) : 0;
    }
    m.w = wRel;
    if (m.rotor) {
      // the encoder reads the real angle between output and housing (contacts can nudge parts without any velocity)
      const rel = new THREE.Quaternion().copy(m.body.rotation()).invert().multiply(new THREE.Quaternion().copy(m.rotor.rotation()));
      const twist = 2 * Math.atan2(rel.x * m.axisLocal.x + rel.y * m.axisLocal.y + rel.z * m.axisLocal.z, rel.w);
      m.angle += Math.atan2(Math.sin(twist - m.twist), Math.cos(twist - m.twist));
      m.twist = twist;
    } else m.angle += wRel * STEP;
    const hi = m.stall * (1 - wRel / m.w0), lo = m.stall * (-1 - wRel / m.w0);
    // the commanded speed follows the wanted speed at the motor's acceleration / deceleration
    const ramp = desired => {
      const rate = Math.abs(desired) < Math.abs(m.cmd) || Math.sign(desired) !== Math.sign(m.cmd) ? m.decel : m.accel;
      m.cmd += THREE.MathUtils.clamp(desired - m.cmd, -rate * STEP, rate * STEP);
      return m.cmd;
    };
    let want = null, tau = 0;
    if (m.mode === 'speed') {
      want = ramp(m.target);
      if (m.thenStop && Math.abs(m.cmd) < 1e-6) { m.mode = m.thenStop; m.thenStop = null; m.holdAt = m.angle; }
    } else if (m.mode === 'position') {
      const err = m.goal - m.angle;
      // trapezoid: cruise, then slow so we arrive at the target at zero speed
      want = ramp(Math.sign(err) * Math.min(Math.abs(m.target), Math.sqrt(2 * m.decel * Math.abs(err)) + 0.05));
      if (Math.abs(err) < 0.5 * DEG) {
        m.mode = m.after;
        m.holdAt = m.goal;
        m.cmd = 0;
        const done = m.done;
        m.done = null;
        done?.();
      }
    } else if (m.mode === 'hold') {
      want = THREE.MathUtils.clamp((m.holdAt - m.angle) * 20, -m.w0, m.w0);
    }
    if (want !== null) {
      const err = want - wRel;
      tau = m.kp * err + m.ki * m.integ;
      if (tau > hi) tau = hi;
      else if (tau < lo) tau = lo;
      else m.integ += err * STEP; // integrate only while not saturated (no wind-up)
    } else {
      tau = m.mode === 'brake' ? -m.stall * (wRel / m.w0) : 0; // BRAKE shorts the motor; COAST spins free
      m.integ = 0;
      m.cmd = wRel;
    }
    m.load = Math.abs(tau) / m.stall;
    if (m.rotor) {
      m.rotor.applyTorqueImpulse(axisW.clone().multiplyScalar(tau * STEP), true);
      m.body.applyTorqueImpulse(axisW.clone().multiplyScalar(-tau * STEP), true); // reaction on the motor housing
    }
  }

  // Keyboard driving. Turning on the spot runs at the turn speed; turning while driving makes a smooth arc
  // (the inside wheel slows down rather than stopping), and Shift drives slowly for lining up.
  function keyboard() {
    if (program) return;
    const { fwd, turn } = input, slow = input.keys.has('shift') ? 0.3 : 1;
    let l, r;
    if (fwd) {
      const inner = 1 - turnFrac; // 30 % turn speed: inside wheel at 70 %, a wide easy curve
      l = fwd * (turn < 0 ? inner : 1);
      r = fwd * (turn > 0 ? inner : 1);
    } else {
      l = turn * turnFrac;
      r = -turn * turnFrac;
    }
    for (const m of motors) {
      let cmd = null;
      if (m.role === 'left') cmd = l;
      else if (m.role === 'right') cmd = r;
      else if (m.role === 'centre') cmd = fwd;
      else if (m.keys) cmd = (input.keys.has(m.keys[1]) ? 1 : 0) - (input.keys.has(m.keys[0]) ? 1 : 0);
      if (cmd === null) continue;
      if (cmd !== 0) {
        if (m.mode !== 'speed') m.cmd = m.w;
        m.mode = 'speed';
        m.thenStop = null;
        m.target = cmd * m.w0 * speedFrac * slow * (m.fwdSign || 1);
      } else if (m.mode === 'speed' && m.role === 'aux') {
        m.mode = 'hold'; // arms stop dead and hold, like motor.stop(port, stop=motor.HOLD)
        m.holdAt = m.angle;
      } else if (m.mode === 'speed' && !m.thenStop) {
        // let go of the drive keys: roll to a stop at the motor's deceleration, then the chosen stop mode
        m.target = 0;
        m.thenStop = stopMode;
      }
    }
  }

  // Gears sit on axles, so they can only turn: the coupling acts as a pair of torques about each gear's own
  // axle. (A push at the tooth would partly be soaked up by the hinge and the ratio would slip.)
  const axleInertia = (b, c, a) => {
    const com = new THREE.Vector3().copy(b.worldCom()), r = com.sub(c);
    const d2 = r.addScaledVector(a, -r.dot(a)).lengthSq(); // centre of mass off the axle: parallel-axis term
    return inertiaAbout(b, a) + (b.invMass() > 0 ? d2 / b.invMass() : 0);
  };
  // A gear's spin about its axle at the end of the coming step: what it has now plus what gravity will add
  // (no gear is perfectly balanced, and a tiny gear has so little inertia that even 0.25 mm matters).
  const spinAbout = (b, a, c, inertia) => {
    let w = new THREE.Vector3().copy(b.angvel()).dot(a);
    if (c) {
      const lever = new THREE.Vector3().copy(b.worldCom()).sub(c);
      w += lever.cross(new THREE.Vector3(0, -9.81 / b.invMass(), 0)).dot(a) * STEP / inertia;
    }
    return w;
  };

  // Each gear's angle about its own axle relative to the chassis, unwrapped (like a motor encoder).
  const twistAbout = (b, aLocal) => {
    const q = new THREE.Quaternion().copy(rootBody.rotation()).invert().multiply(new THREE.Quaternion().copy(b.rotation()));
    return 2 * Math.atan2(q.x * aLocal.x + q.y * aLocal.y + q.z * aLocal.z, q.w);
  };
  const trackAngle = (g, key, b, aLocal) => {
    const t = twistAbout(b, aLocal), prev = g[key + 'raw'] ?? t;
    g[key] = (g[key] ?? 0) + Math.atan2(Math.sin(t - prev), Math.cos(t - prev));
    g[key + 'raw'] = t;
  };
  const DRIFT_FIX = 0.2; // fraction of any tooth slip pulled back each step

  function gearStep() {
    for (const g of gears) { trackAngle(g, 'th1', g.b1, g.a1); trackAngle(g, 'th2', g.b2, g.a2); }
    for (let it = 0; it < 4; it++) for (const g of gears) {
      const c1 = g.c1.clone().applyQuaternion(g.q1.copy(g.b1.rotation())).add(g.b1.translation());
      const c2 = g.c2.clone().applyQuaternion(g.q2.copy(g.b2.rotation())).add(g.b2.translation());
      const a1 = g.a1.clone().applyQuaternion(g.q1), a2 = g.a2.clone().applyQuaternion(g.q2);
      const i1 = axleInertia(g.b1, c1, a1), i2 = axleInertia(g.b2, c2, a2);
      // spins relative to the chassis, so turning the whole robot doesn't wind the gears
      const w1 = spinAbout(g.b1, a1, c1, i1) - (g.b1 === rootBody ? spinAbout(g.b1, a1, c1, i1) : spinAbout(rootBody, a1));
      const w2 = spinAbout(g.b2, a2, c2, i2) - (g.b2 === rootBody ? spinAbout(g.b2, a2, c2, i2) : spinAbout(rootBody, a2));
      let k1, k2, K;
      if (g.worm) {
        // worm (1) and gear (2): the gear's tooth moves along the worm's axle by lead/2π per radian of worm
        const P = wormContact(c1, a1, g.r1, c2);
        k1 = WORM_LEAD / (2 * Math.PI);
        k2 = a2.clone().cross(P.clone().sub(c2)).dot(a1);
      } else {
        const P = contact(c1, a1, g.r1, c2), t = a1.clone().cross(P.clone().sub(c1)).normalize();
        k1 = a1.clone().cross(P.clone().sub(c1)).dot(t);
        k2 = a2.clone().cross(P.clone().sub(c2)).dot(t);
      }
      // a worm nothing drives is self-locking: it acts as if fixed, so only the gear moves
      const lock1 = g.worm && g.locked;
      K = k2 * k2 / i2 + (lock1 ? 0 : k1 * k1 / i1);
      g.e0 ??= k1 * g.th1 - k2 * g.th2; // the teeth's starting phase
      const slip = k1 * g.th1 - k2 * g.th2 - g.e0;
      const cdot = k1 * w1 - k2 * w2 + (DRIFT_FIX / STEP) * slip;
      const lambda = -cdot / K;
      const t1 = lock1 ? new THREE.Vector3() : a1.clone().multiplyScalar(lambda * k1);
      const t2 = a2.clone().multiplyScalar(-lambda * k2);
      if (!lock1) g.b1.applyTorqueImpulse(t1, true);
      g.b2.applyTorqueImpulse(t2, true);
      // the frame the gears sit in takes the reaction
      if (g.b1 !== rootBody && g.b2 !== rootBody) rootBody.applyTorqueImpulse(t1.add(t2).negate(), true);
      if (lock1 && g.b1 !== rootBody) { // keep the locked worm itself from turning
        const rel = spinAbout(g.b1, a1, c1, i1) - spinAbout(rootBody, a1);
        g.b1.applyTorqueImpulse(a1.clone().multiplyScalar(-rel * i1), true);
      }
    }
  }




  function update(dt) {
    acc = Math.min(acc + dt, 0.1); // never try to catch up more than 100 ms after a stall
    while (acc >= STEP) {
      for (const t of tracked) { t.p0.copy(t.p1); t.q0.copy(t.q1); }
      keyboard();
      for (const m of motors) motorStep(m);
      gearStep();
      const before = new THREE.Vector3().copy(rootBody.translation());
      world.step(events, contactFilter);
      for (const t of tracked) { t.p1.copy(t.body.translation()); t.q1.copy(t.body.rotation()); }
      distance += before.distanceTo(rootBody.translation());
      time += STEP;
      acc -= STEP;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= time) timers.splice(i, 1)[0].resolve();
    }
    const alpha = acc / STEP; // draw between the last two physics states so motion stays smooth at any frame rate
    for (const t of tracked) {
      t.vis.position.lerpVectors(t.p0, t.p1, alpha);
      t.vis.quaternion.slerpQuaternions(t.q0, t.q1, alpha);
    }
    readSensors();
  }

  // ---- sensor readings ----
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const castFrom = (s, maxM) => {
    const q = new THREE.Quaternion().copy(s.body.rotation()), p = new THREE.Vector3().copy(s.body.translation());
    const o = s.eye.clone().applyQuaternion(q).add(p), d = s.dir.clone().applyQuaternion(q);
    ray.origin = o; ray.dir = d;
    const hit = world.castRay(ray, maxM, true, undefined, RAY);
    return hit && { toi: hit.timeOfImpact ?? hit.toi, collider: hit.collider, point: o.clone().addScaledVector(d, hit.timeOfImpact ?? hit.toi) };
  };
  function surfaceColour(hit) {
    if (hit.collider.handle === floor.handle) return arena.colourAt?.(hit.point.x, hit.point.z) || [35, 39, 44];
    const c = obstacleColour.get(hit.collider.handle);
    return c ? [c.r * 255, c.g * 255, c.b * 255] : [128, 128, 128];
  }
  function readSensors() {
    for (const s of sensors) {
      if (s.type === 'distance') {
        const hit = castFrom(s, s.maxMm / 1000);
        const mm = hit ? hit.toi * 1000 : -1;
        s.value = mm >= s.minMm ? Math.round(mm) : -1;
      } else if (s.type === 'force') {
        const hit = castFrom(s, (s.travelMm + 0.5) / 1000);
        const press = hit ? THREE.MathUtils.clamp((s.travelMm - hit.toi * 1000) / s.travelMm, 0, 1) : 0;
        s.value = { pressed: press > 0.05, force: Math.round(press * 100) / 10 }; // 0–10 N like the real sensor
      } else if (s.type === 'color') {
        const hit = castFrom(s, 0.04);
        if (!hit) { s.value = { color: -1, reflection: 0, rgb: [0, 0, 0] }; continue; }
        const rgb = surfaceColour(hit);
        const fade = THREE.MathUtils.clamp(1 - (hit.toi * 1000 - 8) / 24, 0, 1); // light falls off past ~8 mm
        const luma = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
        let best = SENSOR_COLOURS[0], bestD = Infinity;
        for (const c of SENSOR_COLOURS) {
          const d = (c.rgb[0] - rgb[0]) ** 2 + (c.rgb[1] - rgb[1]) ** 2 + (c.rgb[2] - rgb[2]) ** 2;
          if (d < bestD) { bestD = d; best = c; }
        }
        s.value = { color: fade > 0.3 ? best.id : -1, reflection: Math.round(luma * 100 * fade), rgb: rgb.map(v => Math.round(v * fade)) };
      } else if (s.type === 'gyro') {
        s.value = imuAngles()[0];
      }
    }
  }
  // yaw, pitch, roll in degrees; yaw counter-clockwise (seen from above) is positive
  function imuAngles() {
    const q = new THREE.Quaternion().copy(imuBody.rotation()).multiply(imuStart.clone().invert());
    const f = UP.clone().cross(right).applyQuaternion(q);
    const f0 = UP.clone().cross(right);
    const yaw = Math.atan2(f0.clone().cross(f).dot(UP), f0.dot(f.clone().projectOnPlane(UP))) / DEG;
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    let y = yaw - yawZero;
    y = ((y + 540) % 360) - 180;
    return [y, e.x / DEG, e.z / DEG];
  }

  // ---- program API (SPIKE-style), all speeds in degrees per second at the output ----
  const letter = port => (typeof port === 'number' ? PORTS[port] : port);
  const byPort = port => motors.find(m => m.port === letter(port));
  const sensorAt = port => sensors.find(s => s.port === letter(port));
  const timers = [];
  const wait = ms => new Promise(resolve => timers.push({ at: time + ms / 1000, resolve }));
  let display = '';
  const finish = (m, mode) => new Promise(res => { m.done?.(); m.done = res; if (m.mode !== 'speed' && m.mode !== 'position') m.cmd = m.w; m.mode = mode; });
  const accel = (m, a, d) => { m.accel = (a ?? 1000) * DEG; m.decel = (d ?? a ?? 1000) * DEG; };
  const api = {
    motorRun(port, dps, acceleration) {
      const m = byPort(port); if (!m) return;
      if (m.mode !== 'speed') m.cmd = m.w;
      accel(m, acceleration);
      m.mode = 'speed'; m.thenStop = null; m.target = THREE.MathUtils.clamp(dps * DEG, -m.w0, m.w0);
    },
    motorRunForDegrees(port, deg, dps, stop = 'brake', acceleration, deceleration) {
      const m = byPort(port); if (!m) return Promise.resolve();
      accel(m, acceleration, deceleration);
      m.goal = m.angle + deg * DEG * Math.sign(dps || 1); m.target = Math.min(Math.abs(dps * DEG), m.w0); m.after = stop;
      return finish(m, 'position');
    },
    motorRunToRelative(port, pos, dps, stop = 'brake', acceleration, deceleration) {
      const m = byPort(port); if (!m) return Promise.resolve();
      accel(m, acceleration, deceleration);
      m.goal = pos * DEG; m.target = Math.min(Math.abs(dps * DEG), m.w0); m.after = stop;
      return finish(m, 'position');
    },
    motorStop(port, stop = 'brake') { const m = byPort(port); if (!m) return; m.done?.(); m.done = null; m.mode = stop; m.thenStop = null; m.holdAt = m.angle; },
    motorPosition: port => Math.round((byPort(port)?.angle || 0) / DEG),
    motorResetPosition(port, pos = 0) { const m = byPort(port); if (m) { m.holdAt += pos * DEG - m.angle; m.goal += pos * DEG - m.angle; m.angle = pos * DEG; } },
    motorVelocity: port => Math.round((byPort(port)?.w || 0) / DEG),
    // pairs: forward is the robot's forward whatever way round the motors are mounted
    pairSpeeds(left, right, steering, dps) {
      const s = THREE.MathUtils.clamp(steering, -100, 100) / 50;
      const l = s >= 0 ? dps : dps * (1 + s), r = s <= 0 ? dps : dps * (1 - s);
      return [l * (left?.fwdSign || 1), r * (right?.fwdSign || 1)];
    },
    async motorRunForTime(port, ms, dps, stop = 'brake', acceleration) {
      api.motorRun(port, dps, acceleration);
      await wait(ms);
      api.motorStop(port, stop);
    },
    pairMove(lp, rp, steering, dps, acceleration) { const [l, r] = api.pairSpeeds(byPort(lp), byPort(rp), steering, dps); api.motorRun(lp, l, acceleration); api.motorRun(rp, r, acceleration); },
    pairTank(lp, rp, ld, rd, acceleration) { api.motorRun(lp, ld * (byPort(lp)?.fwdSign || 1), acceleration); api.motorRun(rp, rd * (byPort(rp)?.fwdSign || 1), acceleration); },
    pairMoveForDegrees(lp, rp, deg, steering, dps, stop, acceleration, deceleration) {
      const [l, r] = api.pairSpeeds(byPort(lp), byPort(rp), steering, dps);
      const k = Math.max(Math.abs(l), Math.abs(r)) || 1;
      return Promise.all([api.motorRunForDegrees(lp, Math.abs(deg * l / k), l, stop, acceleration, deceleration), api.motorRunForDegrees(rp, Math.abs(deg * r / k), r, stop, acceleration, deceleration)]);
    },
    pairTankForDegrees(lp, rp, deg, ld, rd, stop, acceleration, deceleration) {
      const l = ld * (byPort(lp)?.fwdSign || 1), r = rd * (byPort(rp)?.fwdSign || 1);
      const k = Math.max(Math.abs(l), Math.abs(r)) || 1;
      return Promise.all([api.motorRunForDegrees(lp, Math.abs(deg * l / k), l, stop, acceleration, deceleration), api.motorRunForDegrees(rp, Math.abs(deg * r / k), r, stop, acceleration, deceleration)]);
    },
    async pairMoveForTime(lp, rp, ms, steering, dps, stop = 'brake', acceleration) {
      api.pairMove(lp, rp, steering, dps, acceleration);
      await wait(ms);
      api.pairStop(lp, rp, stop);
    },
    async pairTankForTime(lp, rp, ld, rd, ms, stop = 'brake', acceleration) {
      api.pairTank(lp, rp, ld, rd, acceleration);
      await wait(ms);
      api.pairStop(lp, rp, stop);
    },
    pairStop(lp, rp, stop) { api.motorStop(lp, stop); api.motorStop(rp, stop); },
    wait,
    display(text) { display = text; },
    beep: (freq, ms) => wait(ms),
    get displayText() { return display; },
    // Everything a program can read, packed for the Python worker (see public/spike/spike.py for the layout).
    writeShared(buf) {
      buf[0] = time;
      const [y, p, r] = api.tilt();
      buf[1] = y; buf[2] = p; buf[3] = r;
      PORTS.forEach((P, i) => {
        const o = 8 + i * 8, m = motors.find(x => x.port === P), s = sensors.find(x => x.port === P);
        buf[o] = m ? m.angle / DEG : 0;
        buf[o + 1] = m ? m.w / DEG : 0;
        buf[o + 2] = s?.type === 'color' ? s.value?.color ?? -1 : -1;
        buf[o + 3] = s?.type === 'color' ? s.value?.reflection ?? 0 : 0;
        buf[o + 4] = s?.type === 'distance' ? s.value ?? -1 : -1;
        buf[o + 5] = s?.type === 'force' ? s.value?.force ?? 0 : 0;
        buf[o + 6] = s?.type === 'force' && s.value?.pressed ? 1 : 0;
        const rgb = s?.type === 'color' ? s.value?.rgb || [0, 0, 0] : [0, 0, 0];
        buf[o + 7] = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      });
    },
    colour: port => sensorAt(port)?.value?.color ?? -1,
    reflection: port => sensorAt(port)?.value?.reflection ?? 0,
    rgb: port => sensorAt(port)?.value?.rgb ?? [0, 0, 0],
    distance: port => (sensorAt(port)?.type === 'distance' ? sensorAt(port).value : -1),
    pressed: port => !!sensorAt(port)?.value?.pressed,
    force: port => sensorAt(port)?.value?.force ?? 0,
    tilt: () => imuAngles().map(v => Math.round(v * 10)), // decidegrees, like the SPIKE hub
    resetYaw(deg = 0) { yawZero = 0; yawZero = imuAngles()[0] - deg; },
    time: () => time,
    setProgram(on) { program = on; if (!on) for (const m of motors) { m.done?.(); m.done = null; if (m.mode !== 'coast') { m.mode = 'brake'; } } },
  };

  function telemetry() {
    const lv = rootBody.linvel();
    const up = UP.clone().applyQuaternion(rootBody.rotation());
    const d = drive[0];
    return {
      speed: Math.hypot(lv.x, lv.z),
      topSpeed: d ? d.w0 * speedFrac * d.ratio * d.wheelRadius : 0,
      grams: robotGrams,
      distance,
      tipped: up.y < 0.5,
      assumedMotor: motors.some(m => m.assumed),
      notes: mech.notes,
      bodies: bodies.filter(Boolean).length,
      joints: mech.joints.length,
      gears: gears.length,
      castors: mech.castors.length,
      motors: motors.map(m => ({ key: m.key, name: m.name, port: m.port, role: m.role, keys: m.keys, load: m.load, angle: Math.round(m.angle / DEG), dps: Math.round(m.w / DEG), wheelMm: m.wheel ? Math.round(m.wheel.radius * 2 * S * 1000 * 10) / 10 : null, ratio: m.ratio, idle: !m.rotor, assumed: m.assumed })),
      sensors: sensors.map(s => ({ key: s.key, name: s.name, type: s.type, port: s.port, value: s.value })),
      imu: imuAngles(),
    };
  }

  readSensors();
  return {
    visuals, update, telemetry, api,
    focus: () => groupVis[mech.root]?.localToWorld(robotCom.clone()) ?? robotCom.clone(), // chassis frame starts as the world frame
    setInput: (fwd, turn, keys) => { input.fwd = fwd; input.turn = turn; if (keys) input.keys = keys; },
    setSpeed: f => { speedFrac = f; },
    setTurnSpeed: f => { turnFrac = f; },
    setStopMode: m => { stopMode = m; },
    setPort(key, port) {
      for (const d of [...motors, ...sensors]) {
        if (port && d.port === port) d.port = null;
        if (d.key === key) d.port = port || null;
      }
    },
    // what a motor does when you drive with the keys: 'left' / 'right' wheel, 'aux' (arm keys)
    setRole(key, role) {
      const m = motors.find(x => x.key === key);
      if (!m) return;
      m.role = role;
      m.mode = 'brake';
      giveKeys();
    },
    objectOf: key => [...motors, ...sensors].find(d => d.key === key)?.part?.vis ?? null, // the part on screen

    dispose: () => { for (const m of motors) m.done?.(); for (const t of timers) t.resolve(); events.free(); world.free(); },
    debug: { world, rootBody, bodies, mech, motors, sensors, RAPIER, selfCollision: { verdicts, ignored, ignoredBodies, hinges, shapes } }, // for inspecting from the console
  };
}

// A collider's shape as world points at its start pose, plus a bounding sphere.
function colliderPoints(c) {
  const t = new THREE.Vector3().copy(c.translation()), q = new THREE.Quaternion().copy(c.rotation()), sh = c.shape;
  const local = [];
  if (sh.halfExtents) {
    const h = sh.halfExtents;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) local.push(new THREE.Vector3(x * h.x, y * h.y, z * h.z));
  } else if (sh.vertices) {
    for (let i = 0; i < sh.vertices.length; i += 3) local.push(new THREE.Vector3(sh.vertices[i], sh.vertices[i + 1], sh.vertices[i + 2]));
  } else if (sh.halfHeight !== undefined) {
    const r = sh.radius + (sh.borderRadius || 0), hh = sh.halfHeight + (sh.borderRadius || 0);
    for (let k = 0; k < 12; k++) for (const y of [-hh, hh]) local.push(new THREE.Vector3(Math.cos(k * Math.PI / 6) * r, y, Math.sin(k * Math.PI / 6) * r));
  } else {
    const r = sh.radius || 0;
    for (const v of [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]) local.push(new THREE.Vector3(...v));
  }
  const pts = local.map(v => v.applyQuaternion(q).add(t));
  const centre = pts.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(pts.length);
  return { pts, centre, radius: Math.max(...pts.map(v => v.distanceTo(centre))) };
}

// Stable id for a device across sessions: part number + where it sits in the model.
export function deviceKey(p) {
  const e = p.local.elements;
  return `${p.info.file}@${Math.round(e[12])},${Math.round(e[13])},${Math.round(e[14])}`;
}

function obstacleCollider(obj, def) {
  const s = obj.scale;
  const scaled = pos => {
    const out = new Float32Array(pos.count * 3);
    for (let n = 0; n < pos.count; n++) {
      out[n * 3] = pos.getX(n) * s.x; out[n * 3 + 1] = pos.getY(n) * s.y; out[n * 3 + 2] = pos.getZ(n) * s.z;
    }
    return out;
  };
  switch (def.type) {
    case 'box':
    case 'wall':
      return RAPIER.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2).setTranslation(0, s.y / 2, 0);
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(s.y / 2, Math.max(s.x, s.z) / 2).setTranslation(0, s.y / 2, 0);
    case 'ramp':
      return RAPIER.ColliderDesc.convexHull(scaled(obj.geometry.attributes.position));
    case 'mesh': {
      const pts = scaled(obj.geometry.attributes.position);
      if (!def.fixed) return RAPIER.ColliderDesc.convexHull(pts);
      return RAPIER.ColliderDesc.trimesh(pts, new Uint32Array(pts.length / 3).map((_, n) => n));
    }
  }
  return null;
}
