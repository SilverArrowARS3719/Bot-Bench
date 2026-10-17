// Runs your SPIKE Python program in Pyodide, off the main thread so a busy loop can't freeze the 3D view.
// Commands go to the simulator by postMessage; sensor readings come back through shared memory.
/* global importScripts, loadPyodide */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');

let pyodide = null;
let shared = null; // Float64Array written by the main thread every frame
let written = null; // Int32 counter the main thread bumps each time it writes `shared`
const pending = new Map();
let nextId = 1;
// After these, the next reading must come from after the reset (on the hub, reset_yaw(0) then reading the yaw gives 0)
const RESETS = new Set(['resetYaw', 'motorResetPosition']);
const WRITTEN_AT = 8 * 60; // byte offset of the counter: after the 56 readings (see writeShared in sim.js)
let mustSee = null;

self._bridge = {
  call(fn, args) {
    if (RESETS.has(fn) && written) mustSee = Atomics.load(written, 0);
    postMessage({ type: 'call', fn, args: args.toJs ? args.toJs() : args });
  },
  callAsync(fn, args) {
    const id = nextId++;
    postMessage({ type: 'call', fn, args: args.toJs ? args.toJs() : args, id });
    return new Promise(resolve => pending.set(id, resolve));
  },
  read(i) {
    if (mustSee !== null) { Atomics.wait(written, 0, mustSee, 250); mustSee = null; } // a few ms at most
    return shared ? shared[i] : 0;
  },
};

async function boot(interrupt) {
  pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
  pyodide.setStdout({ batched: text => postMessage({ type: 'print', text }) });
  pyodide.setStderr({ batched: text => postMessage({ type: 'print', text, error: true }) });
  pyodide.setInterruptBuffer(interrupt);
  const api = await (await fetch('spike.py')).text();
  await pyodide.runPythonAsync(api);
}

// Stop raises KeyboardInterrupt; Pyodide's event loop reports it a second time as unhandled. That one is expected.
self.addEventListener('unhandledrejection', e => { if (String(e.reason).includes('KeyboardInterrupt')) e.preventDefault(); });

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    shared = new Float64Array(data.shared);
    written = new Int32Array(data.shared, WRITTEN_AT, 1);
    try {
      await boot(new Int32Array(data.interrupt));
      postMessage({ type: 'ready' });
    } catch (err) {
      postMessage({ type: 'error', text: `Couldn't start Python: ${err.message}` });
    }
  } else if (data.type === 'done') {
    pending.get(data.id)?.(data.value);
    pending.delete(data.id);
  } else if (data.type === 'run') {
    try {
      pyodide.globals.get('_reset')();
      // a fresh namespace every run, like a real hub: nothing leaks over from the previous program
      const ns = pyodide.globals.get('dict')();
      ns.set('__name__', '__main__');
      await pyodide.runPythonAsync(data.code, { filename: 'program.py', globals: ns });
      ns.destroy();
      await pyodide.runPythonAsync('await _wait_all()');
      postMessage({ type: 'finished' });
    } catch (err) {
      const msg = String(err.message || err);
      postMessage({ type: msg.includes('KeyboardInterrupt') ? 'finished' : 'error', text: tidy(msg) });
    }
    for (const resolve of pending.values()) resolve();
    pending.clear();
  }
};

// Keep only the part of a Python traceback that points at the student's program.
function tidy(msg) {
  const lines = msg.split('\n');
  const start = lines.findIndex(l => l.includes('File "program.py"'));
  return (start >= 0 ? ['Traceback (most recent call last):', ...lines.slice(start)] : lines).join('\n').trim();
}
