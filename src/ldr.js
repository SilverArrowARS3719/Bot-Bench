// LDraw text <-> plain part records. No three.js here, so tests can run it in Node.
// Record: { file, color, m: [x, y, z, a, b, c, d, e, f, g, h, i] } in LDU, LDraw axes (-Y is up).
// m is the LDraw "type 1" line: position, then the 3x3 rotation row by row.

const IDENTITY = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const ROOT_COLOR = '71'; // colour 16 ("inherit") at the top level has no parent; use Light Bluish Grey

export function multiply(p, c) {
  const [px, py, pz, a, b, cc, d, e, f, g, h, i] = p;
  const [x, y, z, A, B, C, D, E, F, G, H, I] = c;
  return [
    a * x + b * y + cc * z + px, d * x + e * y + f * z + py, g * x + h * y + i * z + pz,
    a * A + b * D + cc * G, a * B + b * E + cc * H, a * C + b * F + cc * I,
    d * A + e * D + f * G, d * B + e * E + f * H, d * C + e * F + f * I,
    g * A + h * D + i * G, g * B + h * E + i * H, g * C + h * F + i * I,
  ];
}

// Flattens .ldr and multi-part .mpd files into a list of parts in the main model's frame.
export function parseLdr(text) {
  const lines = text.split(/\r?\n/);
  const files = new Map();
  let main = null;
  if (!lines.some(l => /^\s*0\s+FILE\s/i.test(l))) {
    main = '';
    files.set(main, lines);
  } else {
    let cur = null;
    for (const l of lines) {
      const f = l.match(/^\s*0\s+FILE\s+(.+?)\s*$/i);
      if (f) {
        cur = norm(f[1]);
        files.set(cur, []);
        main ??= cur;
      } else if (/^\s*0\s+NOFILE/i.test(l)) cur = null;
      else if (cur !== null) files.get(cur).push(l);
    }
  }

  const out = [];
  const walk = (name, parent, parentColor, depth) => {
    if (depth > 64) throw new Error(`Submodel nesting too deep at "${name}" (loop?)`);
    for (const l of files.get(name)) {
      const t = l.trim().split(/\s+/);
      if (t[0] !== '1' || t.length < 15) continue;
      const color = t[1] === '16' ? parentColor : t[1];
      const local = t.slice(2, 14).map(Number);
      if (local.some(Number.isNaN)) continue;
      const file = norm(t.slice(14).join(' '));
      const m = multiply(parent, local);
      if (files.has(file)) walk(file, m, color, depth + 1);
      else out.push({ file, color, m });
    }
  };
  walk(main, IDENTITY, ROOT_COLOR, 0);
  return out;
}

export function serializeLdr(parts, name = 'model.ldr') {
  const fmt = n => String(+n.toFixed(4));
  return [
    `0 ${name.replace(/\.\w+$/, '')}`,
    `0 Name: ${name}`,
    '0 Author: LEGO Robot Studio',
    ...parts.map(p => `1 ${p.color} ${p.m.map(fmt).join(' ')} ${p.file}`),
    '',
  ].join('\n');
}

function norm(name) {
  return name.trim().replace(/\\/g, '/').toLowerCase();
}
