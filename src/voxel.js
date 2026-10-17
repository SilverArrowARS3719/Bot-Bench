// Turns a part's triangle mesh into a handful of boxes that keep its holes open.
// 1) voxelise: a voxel is solid if rays along X, Y and Z mostly agree it's inside (robust to small mesh gaps)
// 2) greedily merge solid voxels into the fewest boxes we can find quickly
// tris: Float32Array of xyz triples (3 per triangle), box: {min, max}. Units: LDU. Returns [cx,cy,cz,hx,hy,hz, ...].

export function boxDecompose(tris, box, voxel = 4, maxBoxes = 96) {
  const min = [box.min.x, box.min.y, box.min.z];
  const n = [0, 1, 2].map(a => Math.max(1, Math.ceil(([box.max.x, box.max.y, box.max.z][a] - min[a]) / voxel)));
  const votes = new Uint8Array(n[0] * n[1] * n[2]);
  const idx = (i, j, k) => i + n[0] * (j + n[1] * k);
  const triCount = tris.length / 9;

  // For each axis, cast a ray through every voxel column centre and flip inside/outside at each crossing.
  for (const axis of [0, 1, 2]) {
    const [u, w] = [0, 1, 2].filter(a => a !== axis);
    // bucket triangles by the column cells they could cross
    const buckets = new Map();
    for (let t = 0; t < triCount; t++) {
      const o = t * 9;
      const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (let v = 0; v < 3; v++) {
        const pu = tris[o + v * 3 + u], pw = tris[o + v * 3 + w];
        lo[0] = Math.min(lo[0], pu); hi[0] = Math.max(hi[0], pu);
        lo[1] = Math.min(lo[1], pw); hi[1] = Math.max(hi[1], pw);
      }
      for (let a = Math.max(0, Math.floor((lo[0] - min[u]) / voxel - 0.5)); a <= Math.min(n[u] - 1, Math.ceil((hi[0] - min[u]) / voxel - 0.5)); a++)
        for (let b = Math.max(0, Math.floor((lo[1] - min[w]) / voxel - 0.5)); b <= Math.min(n[w] - 1, Math.ceil((hi[1] - min[w]) / voxel - 0.5)); b++) {
          const key = a * 100000 + b;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(t);
        }
    }
    for (const [key, list] of buckets) {
      const a = Math.floor(key / 100000), b = key % 100000;
      const cu = min[u] + (a + 0.5) * voxel + 1e-3, cw = min[w] + (b + 0.5) * voxel + 2e-3; // nudged off exact edges
      const hits = [];
      for (const t of list) {
        const o = t * 9;
        const x0 = tris[o + u], y0 = tris[o + w], x1 = tris[o + 3 + u], y1 = tris[o + 3 + w], x2 = tris[o + 6 + u], y2 = tris[o + 6 + w];
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-9) continue;
        const l0 = ((y1 - y2) * (cu - x2) + (x2 - x1) * (cw - y2)) / d;
        const l1 = ((y2 - y0) * (cu - x2) + (x0 - x2) * (cw - y2)) / d;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        hits.push(l0 * tris[o + axis] + l1 * tris[o + 3 + axis] + l2 * tris[o + 6 + axis]);
      }
      hits.sort((p, q) => p - q);
      const uniq = hits.filter((h, i) => i === 0 || h - hits[i - 1] > 1e-3);
      for (let h = 0; h + 1 < uniq.length; h += 2) {
        const c0 = Math.max(0, Math.ceil((uniq[h] - min[axis]) / voxel - 0.5));
        const c1 = Math.min(n[axis] - 1, Math.floor((uniq[h + 1] - min[axis]) / voxel - 0.5));
        for (let c = c0; c <= c1; c++) {
          const ijk = [0, 0, 0];
          ijk[axis] = c; ijk[u] = a; ijk[w] = b;
          votes[idx(...ijk)]++;
        }
      }
    }
  }

  const solid = votes.map(v => (v >= 2 ? 1 : 0));
  const boxes = [];
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    if (!solid[idx(i, j, k)]) continue;
    let i1 = i;
    while (i1 + 1 < n[0] && solid[idx(i1 + 1, j, k)]) i1++;
    const rowFull = (jj, kk) => { for (let x = i; x <= i1; x++) if (!solid[idx(x, jj, kk)]) return false; return true; };
    let j1 = j;
    while (j1 + 1 < n[1] && rowFull(j1 + 1, k)) j1++;
    let k1 = k;
    const slabFull = kk => { for (let y = j; y <= j1; y++) if (!rowFull(y, kk)) return false; return true; };
    while (k1 + 1 < n[2] && slabFull(k1 + 1)) k1++;
    for (let z = k; z <= k1; z++) for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) solid[idx(x, y, z)] = 0;
    boxes.push(
      min[0] + ((i + i1 + 1) / 2) * voxel, min[1] + ((j + j1 + 1) / 2) * voxel, min[2] + ((k + k1 + 1) / 2) * voxel,
      ((i1 - i + 1) * voxel) / 2, ((j1 - j + 1) * voxel) / 2, ((k1 - k + 1) * voxel) / 2,
    );
  }
  if (boxes.length / 6 > maxBoxes) return voxel < 16 ? boxDecompose(tris, box, voxel * 2, maxBoxes) : null;
  return boxes.length ? new Float32Array(boxes) : null;
}
