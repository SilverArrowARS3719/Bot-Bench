// Runs a SPIKE Python program against the simulator. Python lives in a worker (public/spike/worker.js);
// this side forwards its motor commands to the sim and copies sensor readings into shared memory every frame.

export const EXAMPLE_PROGRAM = `from hub import port, motion_sensor
import motor_pair, color_sensor, distance_sensor, runloop

# Drive base: left motor on A, right motor on B (change the ports in the Drive panel to match your robot)
motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)

async def main():
    # drive forward one wheel turn (56 mm wheel = 176 mm)
    await motor_pair.move_for_degrees(motor_pair.PAIR_1, 360, 0, velocity=500)

    # spin right until the gyro says 90 degrees
    motion_sensor.reset_yaw(0)
    motor_pair.move_tank(motor_pair.PAIR_1, 300, -300)
    await runloop.until(lambda: motion_sensor.tilt_angles()[0] <= -900)
    motor_pair.stop(motor_pair.PAIR_1)

    print("yaw is now", motion_sensor.tilt_angles()[0] / 10, "degrees")

runloop.run(main())
`;

export function createRunner({ getSim, onPrint, onState }) {
  let worker = null, booting = null, running = false;
  let shared = null, interrupt = null, written = null;
  // fresh readings for the program, and a nudge for a worker waiting on them (after reset_yaw, for example)
  const publish = sim => {
    sim.api.writeShared(shared);
    Atomics.add(written, 0, 1);
    Atomics.notify(written, 0);
  };

  function boot() {
    if (booting) return booting;
    if (!globalThis.crossOriginIsolated) {
      return Promise.reject(new Error('Running code needs the dev server started with "npm run dev" (it turns on cross-origin isolation).'));
    }
    shared = new Float64Array(new SharedArrayBuffer(8 * 64));
    written = new Int32Array(shared.buffer, 8 * 60, 1); // slots 56–63 are free (public/spike/worker.js reads it there)
    const intBuf = new SharedArrayBuffer(4);
    interrupt = new Int32Array(intBuf);
    worker = new Worker('spike/worker.js');
    booting = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') resolve();
        else if (data.type === 'error' && !running) reject(new Error(data.text));
        else handle(data);
      };
      worker.onerror = e => reject(new Error(e.message || 'Python worker failed to load'));
    });
    worker.postMessage({ type: 'init', shared: shared.buffer, interrupt: intBuf });
    booting.then(() => { worker.onmessage = ({ data }) => handle(data); }, () => { booting = null; worker?.terminate(); worker = null; });
    return booting;
  }

  function handle(data) {
    const sim = getSim();
    if (data.type === 'call') {
      let result;
      try {
        const fn = sim?.api[data.fn];
        if (!fn) throw new Error(sim ? `${data.fn} is not available` : 'The simulation is not running');
        result = fn(...data.args);
      } catch (err) {
        onPrint(String(err.message || err), true);
      }
      if (sim && running) publish(sim);
      if (data.id) Promise.resolve(result).then(value => worker?.postMessage({ type: 'done', id: data.id, value: value ?? null }));
    } else if (data.type === 'print') onPrint(data.text, data.error);
    else if (data.type === 'error') { onPrint(data.text, true); finish(); }
    else if (data.type === 'finished') finish();
  }

  function finish() {
    running = false;
    getSim()?.api.setProgram(false);
    onState('idle');
  }

  return {
    get running() { return running; },
    async run(code) {
      onState('loading');
      try {
        await boot();
      } catch (err) {
        onPrint(err.message, true);
        onState('idle');
        return;
      }
      const sim = getSim();
      if (!sim) { onPrint('Press Play first, then Run.', true); onState('idle'); return; }
      interrupt[0] = 0;
      sim.api.setProgram(true);
      running = true;
      onState('running');
      worker.postMessage({ type: 'run', code });
    },
    stop() {
      if (!running) return;
      interrupt[0] = 2; // SIGINT: raises KeyboardInterrupt inside Python, even in a busy loop
      finish();
    },
    // called every frame: hand the program fresh sensor readings
    frame() {
      const sim = getSim();
      if (running && sim && shared) publish(sim);
    },
  };
}
