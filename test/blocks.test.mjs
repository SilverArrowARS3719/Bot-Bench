import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as Blockly from 'blockly';
import { toPython, EXAMPLE } from '../src/blocks.js';

const load = json => {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(json, ws);
  return ws;
};
const n = x => ({ shadow: { type: 'math_number', fields: { NUM: x } } });

test('blocks become SPIKE Python that uses the robot\'s own ports and wheel size', () => {
  const py = toPython(load(EXAMPLE), { left: 'C', right: 'D', cmPerRotation: 17.59 });
  assert.match(py, /motor_pair\.pair\(motor_pair\.PAIR_1, port\.C, port\.D\)/);
  assert.match(py, /'cm_per_rotation': 17\.59/);
  assert.match(py, /for count in range\(4\):/);
  assert.match(py, /await motor_pair\.move_for_degrees\(motor_pair\.PAIR_1, int\(20 \/ robot\['cm_per_rotation'\] \* 360\), 0, velocity=velocity\(robot\['move_speed'\]\)\)/);
  assert.match(py, /await turn\(90\)/);
  assert.match(py, /async def turn\(degrees\):/);
  assert.match(py, /runloop\.run\(program_1\(\)\)/);
});

test('every block makes valid Python', () => {
  const all = ['spike_motor_run_for', 'spike_motor_go_to', 'spike_motor_start', 'spike_motor_stop', 'spike_motor_speed',
    'spike_move_motors', 'spike_move_for', 'spike_turn', 'spike_move_start', 'spike_move_tank', 'spike_move_stop', 'spike_move_speed', 'spike_move_cm',
    'spike_write', 'spike_display_off', 'spike_beep', 'spike_wait', 'spike_wait_until', 'spike_reset_yaw'];
  const inputs = { AMOUNT: n(2), POSITION: n(90), SPEED: n(60), DEGREES: n(45), STEER: n(20), LEFT: n(30), RIGHT: n(40), CM: n(17), SECONDS: n(0.5),
    TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi' } } }, COND: { block: { type: 'spike_closer', fields: { PORT: 'D' }, inputs: { CM: n(10) } } } };
  const chain = (...bs) => bs.reduceRight((next, b) => (next ? { ...b, next: { block: next } } : b), null);
  // give each block only the inputs it has
  const probe = new Blockly.Workspace();
  const body = all.map(type => { const blk = probe.newBlock(type); return { type, inputs: Object.fromEntries(Object.entries(inputs).filter(([k]) => blk.getInput(k))) }; });
  const loop = { type: 'spike_forever', inputs: { DO: { block: chain({ type: 'controls_if', inputs: { IF0: { block: { type: 'spike_color_is', fields: { PORT: 'C', COLOR: 'RED' } } }, DO0: { block: { type: 'spike_motor_stop' } } } }) } } };
  const py = toPython(load({ blocks: { languageVersion: 0, blocks: [chain({ type: 'spike_start' }, ...body, { type: 'spike_repeat_until', inputs: { COND: { block: { type: 'spike_pressed', fields: { PORT: 'E' } } }, DO: { block: { type: 'spike_wait', inputs: { SECONDS: n(0.1) } } } } }, loop)] } }));
  for (const name of ['run_for_degrees', 'run_to_absolute_position', 'move_tank', 'light_matrix.write', 'sound.beep', 'runloop.until', 'distance_cm', 'force_sensor.pressed', 'color.RED', 'while True:']) {
    assert.ok(py.includes(name), `${name} in\n${py}`);
  }
  const python = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: py, encoding: 'utf8' });
  if (python.error) return; // no Python here: the checks above still ran
  assert.equal(python.status, 0, `${python.stderr}\n${py}`);
});

test('no "when program starts" block means nothing to run', () => {
  assert.equal(toPython(load({ blocks: { languageVersion: 0, blocks: [{ type: 'spike_move_stop' }] } })), null);
});
