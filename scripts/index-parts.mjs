// Builds public/parts.json from the LDraw library in public/ldraw and the LDCad shadow library in public/ldcad.
// parts:   [file, description, category] for every placeable part.
// prims:   every file under p/ (lets the browser fetch primitives on the first try instead of 404-ing through parts/).
// shadow:  LDraw files that have LDCad snap info (pins, holes, axles, studs).
// bearing: LDraw files whose subfile tree contains snap info, so the browser only walks those.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/ldraw/', import.meta.url));
const shadowRoot = fileURLToPath(new URL('../public/ldcad/', import.meta.url));

const parts = [];
for (const file of readdirSync(join(root, 'parts'))) {
  if (!file.endsWith('.dat')) continue;
  const head = readFileSync(join(root, 'parts', file), 'utf8').slice(0, 2000).split(/\r?\n/);
  const desc = head[0].replace(/^0\s+/, '').replace(/\s+/g, ' ').trim();
  // ~ = hidden subpart, = = alias, _ = physical-colour duplicate, "Moved to" = renamed stub
  if (/^[~=_|]/.test(desc) || /^Moved to/i.test(desc)) continue;
  const cat = head.find(l => l.startsWith('0 !CATEGORY'))?.slice(12).trim() || desc.split(' ')[0];
  parts.push([file, desc, cat]);
}
parts.sort((a, b) => a[1].localeCompare(b[1], 'en', { numeric: true }));

const list = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? list(join(dir, e.name), prefix + e.name + '/') : e.name.endsWith('.dat') ? [prefix + e.name.toLowerCase()] : []);
const prims = list(join(root, 'p'));
const primSet = new Set(prims);
const resolve = name => (primSet.has(name) ? 'p/' : 'parts/') + name;

// Which files carry snap info somewhere below them (memoised depth-first walk).
const hasShadow = name => existsSync(join(shadowRoot, resolve(name)));
const memo = new Map();
function bearing(name, depth = 0) {
  if (memo.has(name)) return memo.get(name);
  memo.set(name, false); // guards against reference loops
  const path = join(root, resolve(name));
  let result = hasShadow(name);
  if (existsSync(path) && depth < 20) {
    for (const l of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = l.trim().split(/\s+/);
      if (t[0] !== '1' || t.length < 15) continue;
      if (bearing(t.slice(14).join(' ').toLowerCase().replace(/\\/g, '/'), depth + 1)) result = true;
    }
  }
  memo.set(name, result);
  return result;
}
for (const [file] of parts) bearing(file.toLowerCase());
const shadow = [...memo.keys()].filter(hasShadow).map(resolve);
const bearingList = [...memo].filter(([, v]) => v).map(([k]) => k);

writeFileSync(new URL('../public/parts.json', import.meta.url), JSON.stringify({ parts, prims, shadow, bearing: bearingList }));
console.log(`${parts.length} parts, ${prims.length} primitives, ${shadow.length} with snap info, ${bearingList.length} snap-bearing files`);
