// Keeps your work in your account: the same things the studio keeps in this browser (robot, arena, code, blocks,
// ports, settings), loaded when the studio opens and saved a few seconds after each change.
import { loadState, saveState } from './library.js';

const KEYS = ['studio.model', 'studio.code', 'studio.blocks', 'studio.codeKind', 'studio.ports', 'studio.roles', 'studio.flips', 'studio.drive', 'studio.theme', 'studio.autoConnect', 'studio.filter', 'studio.lines'];
const ARENA = 'studio.arena'; // kept in IndexedDB (mat pictures are big)
const LIMIT = 850_000;

async function collect() {
  const data = {};
  for (const k of KEYS) { const v = localStorage.getItem(k); if (v !== null) data[k] = v; }
  const arena = await loadState(ARENA).catch(() => null);
  if (arena) {
    const text = JSON.stringify(arena);
    // shortcut: a large mat picture doesn't fit in one account record, so it stays in this browser only; upgrade to Convex file storage if that matters
    data[ARENA] = JSON.stringify(text.length + JSON.stringify(data).length > LIMIT ? { ...arena, mat: null } : arena);
  }
  return data;
}

// Before the studio reads anything: put your saved work in place. A new account keeps what's already in this browser.
export async function restore(auth) {
  const data = await auth.load?.().catch(() => null);
  if (!data || !Object.keys(data).length) return false;
  for (const k of KEYS) if (k in data) localStorage.setItem(k, data[k]); else localStorage.removeItem(k);
  if (data[ARENA]) await saveState(ARENA, JSON.parse(data[ARENA])).catch(() => {});
  return true;
}

export function keepSaved(auth, onState = () => {}) {
  if (!auth.save) return;
  let last = null, busy = false;
  const push = async () => {
    if (busy) return;
    busy = true;
    try {
      const text = JSON.stringify(await collect());
      if (text !== last) { onState('saving'); await auth.save(JSON.parse(text)); last = text; onState('saved'); }
    } catch { onState('error'); } finally { busy = false; }
  };
  collect().then(d => { last = JSON.stringify(d); }); // what was just loaded doesn't need saving again
  setInterval(push, 4000);
  addEventListener('pagehide', push);
}
