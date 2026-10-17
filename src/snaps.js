import * as THREE from 'three';
import { lib, catalog } from './parts.js';

// Connection points ("snaps") come from the LDCad shadow library: cylinders that are male (pins, axles,
// studs) or female (holes). A part inherits the snaps of every subfile it is built from unless its
// shadow file says SNAP_CLEAR. All positions are in LDU, in the part's own frame.
//
// Snap: { gender 'M'|'F', shape 'R' (round) | 'A' (axle) | 'S' | 'ball', r, p (start point), d (unit axis),
//         a, b (core interval along d, from p), caps, rotor (belongs to a motor's spinning output) }

const textCache = new Map();
const fetchText = url => {
  if (!textCache.has(url)) textCache.set(url, fetch(url).then(r => (r.ok ? r.text() : '')).catch(() => ''));
  return textCache.get(url);
};

function attrs(line) {
  const out = {};
  for (const m of line.matchAll(/\[(\w+)=([^\]]*)\]/g)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}
const nums = s => (s ? s.trim().split(/\s+/).map(Number) : null);

// LDraw-style matrix from [pos] and [ori] (ori = 3x3 rows)
function frame(at) {
  const [x, y, z] = nums(at.pos) || [0, 0, 0];
  const [a, b, c, d, e, f, g, h, i] = nums(at.ori) || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return new THREE.Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1);
}

// [grid=C 2 C 2 20 20]: repeat along the snap frame's X and Z, optionally centred.
function gridOffsets(spec) {
  if (!spec) return [[0, 0]];
  const t = spec.split(/\s+/);
  const read = () => {
    const centred = t[0]?.toUpperCase() === 'C';
    if (centred) t.shift();
    return { centred, n: Math.max(1, Math.round(+t.shift())) };
  };
  const gx = read(), gz = read();
  const [sx, sz] = [+t.shift() || 0, +t.shift() || 0];
  const offs = [];
  for (let i = 0; i < gx.n; i++)
    for (let k = 0; k < gz.n; k++)
      offs.push([(gx.centred ? i - (gx.n - 1) / 2 : i) * sx, (gz.centred ? k - (gz.n - 1) / 2 : k) * sz]);
  return offs;
}

function cylinder(at) {
  const t = at.secs.split(/\s+/);
  const segs = [];
  for (let i = 0; i + 2 < t.length; i += 3) segs.push({ shape: t[i].toUpperCase(), r: +t[i + 1], len: +t[i + 2] });
  const total = segs.reduce((s, x) => s + x.len, 0);
  let s = at.center === 'true' ? -total / 2 : 0;
  for (const seg of segs) { seg.a = s; s += seg.len; seg.b = s; }
  // The "core" is the part that decides what fits: axle cross (A) beats round (R) at pin size; else whatever is there.
  const family = sh => (sh.includes('A') ? 'A' : sh.includes('S') ? 'S' : 'R');
  const pinSize = segs.filter(x => x.r >= 5 && x.r <= 7);
  const pick = pinSize.some(x => family(x.shape) === 'A') ? pinSize.filter(x => family(x.shape) === 'A') : pinSize.length ? pinSize : segs;
  if (!pick.length) return null;
  return {
    gender: (at.gender || 'M').toUpperCase(),
    shape: family(pick[0].shape),
    r: pick[0].r,
    a: Math.min(...pick.map(x => x.a)),
    b: Math.max(...pick.map(x => x.b)),
    fa: segs[0].a, fb: segs[segs.length - 1].b, // the whole hole, collars included: where the part's faces are
    caps: (at.caps || 'none').toLowerCase(),
    yOnly: /yonly/i.test(at.scale || ''),
    rotor: false,
  };
}

// Transform a snap by a 4x4 matrix (LDraw subfile placement).
export function transformSnap(s, m) {
  const p = s.p.clone().applyMatrix4(m);
  const dv = s.d.clone().transformDirection(new THREE.Matrix4().extractRotation(m)); // unit
  const stretch = s.yOnly ? new THREE.Vector3().copy(s.d).applyMatrix3(new THREE.Matrix3().setFromMatrix4(m)).length() : 1;
  return { ...s, p, d: dv, a: s.a * stretch, b: s.b * stretch, fa: (s.fa ?? s.a) * stretch, fb: (s.fb ?? s.b) * stretch, yOnly: false };
}

const fileCache = new Map();
async function fileSnaps(name, depth = 0) {
  name = name.toLowerCase().replace(/\\/g, '/');
  if (!lib.bearingSet.has(name) || depth > 24) return [];
  if (fileCache.has(name)) return fileCache.get(name);
  const job = (async () => {
    const out = [];
    let clear = false;
    if (lib.shadowSet.has(lib.resolve(name))) {
      for (const line of (await fetchText(lib.shadowUrl(name))).split(/\r?\n/)) {
        const m = line.match(/^\s*0\s+!LDCAD\s+(SNAP_\w+)(.*)$/i);
        if (!m) continue;
        const kind = m[1].toUpperCase(), at = attrs(m[2]);
        if (kind === 'SNAP_CLEAR') clear = true;
        else if (kind === 'SNAP_CYL' && at.secs) {
          const c = cylinder(at);
          if (!c) continue;
          const f = frame(at), cols = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
          f.extractBasis(...cols);
          for (const [gx, gz] of gridOffsets(at.grid)) {
            const p = new THREE.Vector3().setFromMatrixPosition(f).addScaledVector(cols[0], gx).addScaledVector(cols[2], gz);
            out.push({ ...c, p, d: cols[1].clone().negate().normalize() }); // cylinders run along the snap's -Y
          }
        } else if (kind === 'SNAP_GEN' && /^sph/i.test(at.bounding || '')) {
          const [x, y, z] = nums(at.pos) || [0, 0, 0];
          out.push({ gender: (at.gender || 'M').toUpperCase(), shape: 'ball', r: +at.bounding.split(/\s+/)[1], p: new THREE.Vector3(x, y, z), d: new THREE.Vector3(0, -1, 0), a: 0, b: 0, caps: 'none', rotor: false });
        } else if (kind === 'SNAP_INCL' && at.ref) {
          const sub = await fileSnaps(at.ref, depth + 1);
          const f = frame(at), cols = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
          f.extractBasis(...cols);
          for (const [gx, gz] of gridOffsets(at.grid)) {
            const g = f.clone().setPosition(new THREE.Vector3().setFromMatrixPosition(f).addScaledVector(cols[0], gx).addScaledVector(cols[2], gz));
            for (const s of sub) out.push(transformSnap(s, g));
          }
        }
      }
    }
    if (!clear) {
      const text = await fetchText(lib.ldrawUrl(name));
      const subs = [];
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim().split(/\s+/);
        if (t[0] !== '1' || t.length < 15) continue;
        const [x, y, z, a, b, c, d, e, f, g, h, i] = t.slice(2, 14).map(Number);
        subs.push({ name: t.slice(14).join(' '), m: new THREE.Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1) });
      }
      const children = await Promise.all(subs.map(s => fileSnaps(s.name, depth + 1)));
      for (let n = 0; n < subs.length; n++) {
        if (!children[n].length) continue;
        // A motor's drive hub is the part that spins: tag everything on it as "rotor"
        const rotor = /drive hub/i.test(await describe(subs[n].name));
        for (const s of children[n]) out.push({ ...transformSnap(s, subs[n].m), rotor: s.rotor || rotor });
      }
    }
    return out;
  })();
  fileCache.set(name, job);
  return job;
}

async function describe(name) {
  const key = name.toLowerCase().replace(/\\/g, '/');
  if (catalog.has(key)) return catalog.get(key).name;
  return (await fetchText(lib.ldrawUrl(key))).split(/\r?\n/, 1)[0].replace(/^0\s+/, '');
}

// All snaps of a part in its own frame, with duplicates (same spot, same axis) removed.
const partCache = new Map();
export function partSnaps(file) {
  if (!partCache.has(file)) {
    partCache.set(file, fileSnaps(file).then(list => {
      const seen = new Set();
      return list.filter(s => {
        const k = [s.gender, s.shape, s.p.x, s.p.y, s.p.z, s.d.x, s.d.y, s.d.z].map(v => (typeof v === 'number' ? Math.round(v * 10) : v)).join();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }));
  }
  return partCache.get(file);
}

// ---------------------------------------------------------------- matching
const isFriction = name => /friction/i.test(name || '');

// Does male snap m fit female snap f (both in the same frame)? Returns the kind of joint or null.
export function fit(m, f, mName = '') {
  if (m.gender !== 'M' || f.gender !== 'F' || m.shape === 'ball' || f.shape === 'ball') return null;
  if (Math.abs(m.r - f.r) > 1) return null;
  const dot = m.d.dot(f.d);
  if (Math.abs(dot) < 0.995) return null;
  const rel = f.p.clone().sub(m.p);
  const along = rel.dot(m.d);
  if (rel.addScaledVector(m.d, -along).length() > 1) return null; // not on the same axis line
  // f's core interval expressed along m's axis
  const fa = along + f.a * dot, fb = along + f.b * dot;
  const lo = Math.max(m.a, Math.min(fa, fb)), hi = Math.min(m.b, Math.max(fa, fb));
  if (hi - lo < 2) return null;
  let kind;
  if (m.shape === 'A' && f.shape === 'A') kind = 'fixed'; // axle in axle hole: locked
  else if (m.shape === 'A' && f.shape === 'R') kind = 'hinge'; // axle spins in a round hole
  else if (m.shape === 'R' && f.shape === 'R') kind = isFriction(mName) || (m.caps === 'one' && m.b - m.a <= 4.5) ? 'fixed' : 'hinge';
  else return null; // a round pin doesn't go into an axle hole
  const mid = (lo + hi) / 2;
  return { kind, point: m.p.clone().addScaledVector(m.d, mid), axis: m.d.clone() };
}

// entries: [{ snaps (already in a shared frame), name }] -> connections between entries.
export function findConnections(entries) {
  const CELL = 20;
  const key = v => `${Math.round(v.x / CELL)},${Math.round(v.y / CELL)},${Math.round(v.z / CELL)}`;
  const samples = s => {
    const pts = [];
    for (let t = s.a; t <= s.b + 0.01; t += Math.max(5, (s.b - s.a) / 8)) pts.push(s.p.clone().addScaledVector(s.d, t));
    if (!pts.length) pts.push(s.p.clone());
    return pts;
  };
  const grid = new Map();
  entries.forEach((e, ei) => e.snaps.forEach((s, si) => {
    if (s.gender !== 'F') return;
    for (const p of samples(s)) {
      const k = key(p);
      if (!grid.has(k)) grid.set(k, new Set());
      grid.get(k).add(ei * 100000 + si);
    }
  }));
  const out = [], seen = new Set();
  entries.forEach((e, ei) => e.snaps.forEach((m, mi) => {
    if (m.gender !== 'M') return;
    const cands = new Set();
    for (const p of samples(m)) for (const c of grid.get(key(p)) || []) cands.add(c);
    for (const c of cands) {
      const fe = Math.floor(c / 100000), fi = c % 100000;
      if (fe === ei) continue;
      const pairKey = `${ei}:${mi}:${fe}:${fi}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const f = entries[fe].snaps[fi];
      const j = fit(m, f, e.name);
      if (j) out.push({ a: ei, b: fe, ...j, rotorA: m.rotor, rotorB: f.rotor });
    }
  }));
  return out;
}

// ---------------------------------------------------------------- build-mode snapping
// Given the moving part's snaps (in model frame, at its current pose) and a spatial index of everyone
// else's, find the closest pair that could click together and the matrix that makes it click.
export function buildIndex(entries) {
  const CELL = 20, grid = new Map();
  const add = (k, v) => { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); };
  for (const e of entries) for (const s of e.snaps) {
    if (s.shape === 'ball') continue;
    for (let t = s.a; t <= s.b + 0.01; t += Math.max(5, (s.b - s.a) / 8)) {
      const p = s.p.clone().addScaledVector(s.d, t);
      add(`${Math.round(p.x / CELL)},${Math.round(p.y / CELL)},${Math.round(p.z / CELL)}`, s);
    }
  }
  return { grid, CELL };
}

export function snapPose(moving, index, reach = 14) {
  const { grid, CELL } = index;
  let best = null;
  for (const m of moving) {
    if (m.shape === 'ball') continue;
    const mid = m.p.clone().addScaledVector(m.d, (m.a + m.b) / 2);
    const cx = Math.round(mid.x / CELL), cy = Math.round(mid.y / CELL), cz = Math.round(mid.z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const s of grid.get(`${cx + i},${cy + j},${cz + k}`) || []) {
        if (s.gender === m.gender || s.shape === 'ball') continue;
        const [male, female] = m.gender === 'M' ? [m, s] : [s, m];
        if (Math.abs(male.r - female.r) > 1 || (male.shape === 'R' && female.shape === 'A')) continue;
        // distance from the moving snap's middle to the other snap's axis segment
        const smid = s.p.clone().addScaledVector(s.d, THREE.MathUtils.clamp(mid.clone().sub(s.p).dot(s.d), s.a, s.b));
        const dist = smid.distanceTo(mid);
        if (dist > reach) continue;
        const angle = Math.acos(Math.min(1, Math.abs(m.d.dot(s.d))));
        const score = dist + angle * 12;
        if (!best || score < best.score) best = { score, m, s };
      }
    }
  }
  if (!best) return null;
  const { m, s } = best;
  // 1) turn the moving part so its snap axis lines up with the other one (shortest way round)
  const target = m.d.dot(s.d) >= 0 ? s.d.clone() : s.d.clone().negate();
  const q = new THREE.Quaternion().setFromUnitVectors(m.d, target);
  const rot = new THREE.Matrix4().makeTranslation(m.p.x, m.p.y, m.p.z)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeTranslation(-m.p.x, -m.p.y, -m.p.z));
  const p = m.p.clone(); // unchanged by the rotation about itself
  // 2) slide onto the other axis, then along it in half-module steps so the shorter part sits fully inside the longer
  const dir = s.d;
  const sgn = target.dot(dir) > 0 ? 1 : -1;
  const rel = p.clone().sub(s.p);
  const along = rel.dot(dir);
  const shiftPerp = rel.clone().addScaledVector(dir, -along).negate();
  // moving core in s-coordinates: [along + m.a*sgn, along + m.b*sgn]
  const mLo = Math.min(m.a * sgn, m.b * sgn), mHi = Math.max(m.a * sgn, m.b * sgn);
  const lenM = mHi - mLo, lenS = s.b - s.a;
  // allowed range of "along" so the shorter interval is inside the longer one
  const [minA, maxA] = lenM >= lenS ? [s.b - mHi, s.a - mLo] : [s.a - mLo, s.b - mHi];
  let t = THREE.MathUtils.clamp(Math.round(along / 10) * 10, Math.min(minA, maxA), Math.max(minA, maxA));
  if (t < Math.min(minA, maxA) - 0.01 || t > Math.max(minA, maxA) + 0.01) t = THREE.MathUtils.clamp(along, Math.min(minA, maxA), Math.max(minA, maxA));
  const shift = shiftPerp.addScaledVector(dir, t - along);
  return { matrix: new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z).multiply(rot), point: s.p.clone().addScaledVector(dir, (s.a + s.b) / 2), from: m, to: s };
}

// ---------------------------------------------------------------- auto-connect
// Pins, axles and bushes are meant to sit inside other parts; everything else shouldn't overlap.
export const isConnector = name => /^Technic (Pin|Axle|Bush)\b/i.test(name || '');

// two round pin holes face to face can be joined by adding a pin
const pinnable = (m, s) => m.gender === 'F' && s.gender === 'F' && m.shape === 'R' && s.shape === 'R' && Math.abs(m.r - 6) < 0.6 && Math.abs(s.r - 6) < 0.6;

const compatible = (m, s) => {
  if (pinnable(m, s)) return true;
  if (m.gender === s.gender || m.shape === 'ball' || s.shape === 'ball' || m.shape === 'S' || s.shape === 'S') return false;
  const [male, female] = m.gender === 'M' ? [m, s] : [s, m];
  return Math.abs(male.r - female.r) <= 1 && !(male.shape === 'R' && female.shape === 'A');
};

// Finds the best way to click the moving part onto something near the cursor.
//   moving:   snaps in the moving part's own frame (for a group: in the grabbed part's frame)
//   statics:  snaps of everything else, in the model frame (each with .owner)
//   rotation: the moving part's current rotation (Matrix4), project: model point -> screen {x, y} | null
//   cursor:   screen point, ray: cursor ray in the model frame, centre: the moving part's middle (own frame)
//   clash:    pose -> penalty for overlapping other parts (0 when clear)
// Returns { matrix (the moving part's new pose), point, to, from, key } or null.
// height: where the part is now (LDraw y); connections that would make it jump up or down cost extra,
// so a light sideways drag doesn't drop a part into a hole lower down.
export function autoConnect({ moving, statics, rotation, project, cursor, ray, centre, clash = () => 0, reachPx = 60, previous = null, height = null }) {
  const segPx = s => {
    const a = project(s.p.clone().addScaledVector(s.d, s.a)), b = project(s.p.clone().addScaledVector(s.d, s.b));
    if (!a || !b) return Infinity;
    const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((cursor.x - a.x) * vx + (cursor.y - a.y) * vy) / len2));
    return Math.hypot(a.x + vx * t - cursor.x, a.y + vy * t - cursor.y);
  };
  const near = statics.map((s, idx) => ({ s, idx, px: segPx(s) })).filter(c => c.px < reachPx).sort((x, y) => x.px - y.px).slice(0, 12);
  if (!near.length) return null;
  const q0 = new THREE.Quaternion().setFromRotationMatrix(rotation);
  let best = null;
  const tmpQ = new THREE.Quaternion();
  for (const { s, idx } of near) {
    for (const [mi, m] of moving.entries()) {
      if (!compatible(m, s)) continue;
      for (const sign of [1, -1]) {
        const D = s.d.clone().multiplyScalar(sign);
        const dmNow = m.d.clone().applyQuaternion(q0);
        const q1 = new THREE.Quaternion().setFromUnitVectors(dmNow, D).multiply(q0);
        for (let k = 0; k < 4; k++) {
          const q = new THREE.Quaternion().setFromAxisAngle(D, (k * Math.PI) / 2).multiply(q1);
          const turn = 2 * Math.acos(Math.min(1, Math.abs(tmpQ.copy(q).dot(q0)))); // how far it has to turn
          const pm = m.p.clone().applyQuaternion(q);
          const lo = Math.min(sign * m.a, sign * m.b), hi = Math.max(sign * m.a, sign * m.b);
          const pin = pinnable(m, s);
          const depths = [];
          if (pin) {
            // hole against hole: the two parts sit face to face, on either side
            const flo = Math.min(sign * m.fa, sign * m.fb), fhi = Math.max(sign * m.fa, sign * m.fb);
            depths.push(s.fb - flo, s.fa - fhi);
          } else {
            const lenM = hi - lo, lenS = s.b - s.a;
            // insertion depths that put the shorter of the two cylinders fully inside the longer, in half-module steps
            const [u0, u1] = lenM >= lenS ? [s.b - hi, s.a - lo] : [s.a - lo, s.b - hi];
            const [umin, umax] = [Math.min(u0, u1), Math.max(u0, u1)];
            // depths on the half-module lattice, counted from the two cylinders' centres lining up
            const centred = (s.a + s.b) / 2 - (lo + hi) / 2;
            for (let k = Math.ceil((umin - centred) / 10 - 1e-6); centred + k * 10 <= umax + 1e-6 && depths.length < 6; k++) depths.push(centred + k * 10);
            if (!depths.length) depths.push(Math.min(umax, Math.max(umin, centred)));
          }
          for (const u of depths) {
            const T = s.p.clone().addScaledVector(s.d, u).sub(pm);
            const pose = new THREE.Matrix4().compose(T, q, new THREE.Vector3(1, 1, 1));
            const mid = pin ? (u + Math.min(sign * m.fa, sign * m.fb) === s.fb ? s.fb : s.fa) : (Math.max(u + lo, s.a) + Math.min(u + hi, s.b)) / 2;
            const point = s.p.clone().addScaledVector(s.d, mid);
            const sp = project(point);
            if (!sp) continue;
            const key = `${idx}:${mi}:${sign}:${k}:${Math.round(u)}`;
            let score = Math.hypot(sp.x - cursor.x, sp.y - cursor.y) + turn * 30 + ray.distanceToPoint(centre.clone().applyMatrix4(pose)) * 0.15;
            if (height !== null) score += Math.abs(pose.elements[13] - height) * 0.35; // 0.35 px per LDU: one brick up is ~8 px
            if (key === previous) score -= 14; // stickiness so it doesn't flicker between equal choices so it doesn't flicker between equal choices
            if (best && score >= best.score) continue;
            score += clash(pose); // only worth checking for a candidate that could win
            if (pin) score += 6; // a direct fit wins a tie against needing a pin
            if (!best || score < best.score) best = { score, matrix: pose, point, to: s, from: m, key, pin };
          }
        }
      }
    }
  }
  return best;
}

// Penalty for a pose that makes the moving part(s) overlap others. Boxes are in each part's own frame;
// a pin or axle may sit inside a beam, but two beams (or two pins) may not share space.
//   statics: [{ box (model frame, Box3), connector }], moving: [{ box (own frame), offset (Matrix4 to grabbed frame), connector }]
export function clashChecker(statics, moving) {
  const shrunk = statics.map(s => ({ box: s.box.clone().expandByScalar(-1), connector: s.connector }));
  const tmp = new THREE.Box3(), m = new THREE.Matrix4();
  return pose => {
    let penalty = 0;
    for (const mv of moving) {
      tmp.copy(mv.box).applyMatrix4(m.multiplyMatrices(pose, mv.offset));
      const own = (tmp.max.x - tmp.min.x) * (tmp.max.y - tmp.min.y) * (tmp.max.z - tmp.min.z) || 1;
      for (const st of shrunk) {
        if (st.connector !== mv.connector) continue;
        const x = Math.min(tmp.max.x, st.box.max.x) - Math.max(tmp.min.x, st.box.min.x);
        const y = Math.min(tmp.max.y, st.box.max.y) - Math.max(tmp.min.y, st.box.min.y);
        const z = Math.min(tmp.max.z, st.box.max.z) - Math.max(tmp.min.z, st.box.min.z);
        if (x > 0 && y > 0 && z > 0) penalty += ((x * y * z) / own) * 2000;
      }
    }
    return penalty;
  };
}

// Where two parts' round holes now face each other flush, ready for a pin: [{ point (the faces' junction), d }].
// moving / statics: snaps in the model frame.
export function pinSpots(moving, statics) {
  const spots = [];
  for (const m of moving) for (const s of statics) {
    if (!pinnable(m, s) || Math.abs(m.d.dot(s.d)) < 0.995) continue;
    const rel = m.p.clone().sub(s.p), along = rel.dot(s.d);
    if (rel.clone().addScaledVector(s.d, -along).length() > 1) continue;
    const sign = Math.sign(m.d.dot(s.d));
    const mlo = along + Math.min(sign * m.fa, sign * m.fb), mhi = along + Math.max(sign * m.fa, sign * m.fb);
    const at = Math.abs(mlo - s.fb) < 1 ? s.fb : Math.abs(mhi - s.fa) < 1 ? s.fa : null;
    if (at !== null) spots.push({ point: s.p.clone().addScaledVector(s.d, at), d: s.d.clone() });
  }
  return spots;
}
