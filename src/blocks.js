// Block coding: SPIKE-style word blocks. They turn into SPIKE Prime 3 Python, so the program that runs here is
// one you could type into the real hub, and "Copy as Python" shows exactly what each block does.
import * as Blockly from 'blockly';
import { pythonGenerator as g, Order } from 'blockly/python';

const KEY = 'studio.blocks';
const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'];
// the SPIKE app's category colours, so blocks look the way students already know them
const C = { events: '#ffbf00', motors: '#0090f5', movement: '#ff4ccd', light: '#9933ff', sound: '#c061f1', control: '#ffab19', sensors: '#4cbfe6', operators: '#59c059', variables: '#ff8c1a' };

const port = name => ({ type: 'field_dropdown', name, options: PORTS.map(p => [p, p]) });
const pick = (name, options) => ({ type: 'field_dropdown', name, options });
const num = name => ({ type: 'input_value', name, check: 'Number' });
const bool = name => ({ type: 'input_value', name, check: 'Boolean' });
const stmt = (type, colour, message0, args0 = [], tooltip = '') => ({ type, colour, message0, args0, tooltip, previousStatement: null, nextStatement: null, inputsInline: true });
const value = (type, colour, message0, args0, output, tooltip = '') => ({ type, colour, message0, args0, output, tooltip, inputsInline: true });
const COLOURS = [['black', 'BLACK'], ['magenta', 'MAGENTA'], ['blue', 'BLUE'], ['azure', 'AZURE'], ['green', 'GREEN'], ['yellow', 'YELLOW'], ['red', 'RED'], ['white', 'WHITE']];

Blockly.Extensions.register('studio_hat', function () { this.hat = 'cap'; });
// Toolbox categories show their colour as a dot, like the SPIKE app, instead of a stripe down one side.
class DotCategory extends Blockly.ToolboxCategory {
  addColourBorder_(colour) { this.rowDiv_.style.setProperty('--dot', colour); }
}
Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, DotCategory, true);
Blockly.common.defineBlocksWithJsonArray([
  { type: 'spike_start', colour: C.events, message0: 'when program starts', nextStatement: null, extensions: ['studio_hat'], tooltip: 'Blocks under this run when you press Run. Use several to do things at the same time.' },

  stmt('spike_motor_run_for', C.motors, '%1 run %2 for %3 %4', [port('PORT'), pick('DIR', [['clockwise', 'cw'], ['counterclockwise', 'ccw']]), num('AMOUNT'), pick('UNIT', [['rotations', 'rotations'], ['degrees', 'degrees'], ['seconds', 'seconds']])], 'Turns one motor, then stops it.'),
  stmt('spike_motor_go_to', C.motors, '%1 go to position %2', [port('PORT'), num('POSITION')], 'Turns the shortest way to an angle from -180 to 180.'),
  stmt('spike_motor_start', C.motors, '%1 start motor %2', [port('PORT'), pick('DIR', [['clockwise', 'cw'], ['counterclockwise', 'ccw']])], 'Keeps turning until you stop it.'),
  stmt('spike_motor_stop', C.motors, '%1 stop motor', [port('PORT')]),
  stmt('spike_motor_speed', C.motors, '%1 set speed to %2 %%', [port('PORT'), num('SPEED')], 'Speed for this motor\'s other blocks (75 % to start with).'),
  value('spike_motor_position', C.motors, '%1 position', [port('PORT')], 'Number', 'Degrees turned since the program started.'),
  value('spike_motor_velocity', C.motors, '%1 speed', [port('PORT')], 'Number', 'Degrees per second.'),

  stmt('spike_move_motors', C.movement, 'set movement motors to %1 + %2', [port('LEFT'), port('RIGHT')], 'Left wheel motor, then right.'),
  stmt('spike_move_for', C.movement, 'move %1 for %2 %3', [pick('DIR', [['forward', 'fwd'], ['back', 'back']]), num('AMOUNT'), pick('UNIT', [['cm', 'cm'], ['inches', 'in'], ['rotations', 'rotations'], ['degrees', 'degrees'], ['seconds', 'seconds']])]),
  stmt('spike_turn', C.movement, 'turn %1 %2 degrees', [pick('DIR', [['right', 'right'], ['left', 'left']]), num('DEGREES')], 'Turns on the spot using the hub\'s gyro, slowing down near the end so it stops on the angle.'),
  stmt('spike_move_start', C.movement, 'start moving with steering %1', [num('STEER')], '0 = straight, 100 = spin right, -100 = spin left.'),
  stmt('spike_move_tank', C.movement, 'start moving at %1 %% and %2 %%', [num('LEFT'), num('RIGHT')], 'Left and right wheel speeds.'),
  stmt('spike_move_stop', C.movement, 'stop moving'),
  stmt('spike_move_speed', C.movement, 'set movement speed to %1 %%', [num('SPEED')], '50 % to start with.'),
  stmt('spike_move_cm', C.movement, 'set 1 motor rotation to %1 cm moved', [num('CM')], 'Set for you from your robot\'s wheels and gears. Change it only to match a real measurement.'),

  stmt('spike_write', C.light, 'write %1', [{ type: 'input_value', name: 'TEXT' }], 'Shows text on the hub\'s light matrix.'),
  stmt('spike_display_off', C.light, 'turn off pixels'),
  stmt('spike_beep', C.sound, 'beep for %1 seconds', [num('SECONDS')]),

  stmt('spike_wait', C.control, 'wait %1 seconds', [num('SECONDS')]),
  stmt('spike_wait_until', C.control, 'wait until %1', [bool('COND')]),
  { type: 'spike_forever', colour: C.control, message0: 'forever %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null },
  { type: 'spike_repeat_until', colour: C.control, message0: 'repeat until %1 %2', args0: [bool('COND'), { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null },

  value('spike_color_is', C.sensors, '%1 sees %2 ?', [port('PORT'), pick('COLOR', COLOURS)], 'Boolean'),
  value('spike_reflection', C.sensors, '%1 reflected light', [port('PORT')], 'Number', '0 (dark) to 100 (bright white).'),
  value('spike_distance', C.sensors, '%1 distance in cm', [port('PORT')], 'Number', '200 when nothing is in range.'),
  value('spike_closer', C.sensors, '%1 closer than %2 cm?', [port('PORT'), num('CM')], 'Boolean'),
  value('spike_pressed', C.sensors, '%1 is pressed?', [port('PORT')], 'Boolean'),
  value('spike_yaw', C.sensors, 'yaw angle', [], 'Number', 'Degrees turned; turning right counts up.'),
  stmt('spike_reset_yaw', C.sensors, 'set yaw angle to 0'),
]);

// ---- Python ----
const v = (block, name, order = Order.NONE, empty = '0') => g.valueToCode(block, name, order) || empty;
const P = (block, name = 'PORT') => `port.${block.getFieldValue(name)}`;
const helper = (name, code) => { g.definitions_[name] = code; return name; };
const PAIR = 'motor_pair.PAIR_1';
const MOVE_V = "velocity(robot['move_speed'])";

const forBlock = {
  spike_start: () => '',
  spike_motor_run_for(b) {
    const p = P(b), n = v(b, 'AMOUNT', Order.MULTIPLICATIVE), vel = `${b.getFieldValue('DIR') === 'ccw' ? '-' : ''}motor_velocity(${p})`;
    if (b.getFieldValue('UNIT') === 'seconds') return `await motor.run_for_time(${p}, int(${n} * 1000), ${vel})\n`;
    return `await motor.run_for_degrees(${p}, int(${b.getFieldValue('UNIT') === 'rotations' ? `${n} * 360` : n}), ${vel})\n`;
  },
  spike_motor_go_to: b => `await motor.run_to_absolute_position(${P(b)}, int(${v(b, 'POSITION')}), motor_velocity(${P(b)}))\n`,
  spike_motor_start: b => `motor.run(${P(b)}, ${b.getFieldValue('DIR') === 'ccw' ? '-' : ''}motor_velocity(${P(b)}))\n`,
  spike_motor_stop: b => `motor.stop(${P(b)})\n`,
  spike_motor_speed: b => `motor_speed[${P(b)}] = ${v(b, 'SPEED')}\n`,
  spike_motor_position: b => [`motor.relative_position(${P(b)})`, Order.FUNCTION_CALL],
  spike_motor_velocity: b => [`motor.velocity(${P(b)})`, Order.FUNCTION_CALL],

  spike_move_motors: b => `motor_pair.pair(${PAIR}, ${P(b, 'LEFT')}, ${P(b, 'RIGHT')})\n`,
  spike_move_for(b) {
    const n = v(b, 'AMOUNT', Order.MULTIPLICATIVE), vel = `${b.getFieldValue('DIR') === 'back' ? '-' : ''}${MOVE_V}`;
    const unit = b.getFieldValue('UNIT');
    if (unit === 'seconds') return `await motor_pair.move_for_time(${PAIR}, int(${n} * 1000), 0, velocity=${vel})\n`;
    const deg = { cm: `${n} / robot['cm_per_rotation'] * 360`, in: `${n} * 2.54 / robot['cm_per_rotation'] * 360`, rotations: `${n} * 360`, degrees: n }[unit];
    return `await motor_pair.move_for_degrees(${PAIR}, int(${deg}), 0, velocity=${vel})\n`;
  },
  spike_turn(b) {
    helper('turn', `async def turn(degrees):
    # gyro turn on the spot, positive = right; slows down for the last part so it stops on the angle
    motion_sensor.reset_yaw(0)
    direction = 1 if degrees > 0 else -1
    turned, last = 0, 0
    while abs(turned) < abs(degrees) - 0.5:
        yaw = motion_sensor.tilt_angles()[0] / 10
        turned += (last - yaw + 180) % 360 - 180  # the hub counts left as positive
        last = yaw
        speed = max(50, min(${MOVE_V}, int((abs(degrees) - abs(turned)) * 8)))
        motor_pair.move_tank(${PAIR}, direction * speed, -direction * speed, acceleration=4000)
        await runloop.sleep_ms(10)
    motor_pair.stop(${PAIR}, stop=motor.HOLD)`);
    return `await turn(${b.getFieldValue('DIR') === 'left' ? '-' : ''}${v(b, 'DEGREES', Order.UNARY_SIGN)})\n`;
  },
  spike_move_start: b => `motor_pair.move(${PAIR}, int(${v(b, 'STEER')}), velocity=${MOVE_V})\n`,
  spike_move_tank: b => `motor_pair.move_tank(${PAIR}, velocity(${v(b, 'LEFT')}), velocity(${v(b, 'RIGHT')}))\n`,
  spike_move_stop: () => `motor_pair.stop(${PAIR})\n`,
  spike_move_speed: b => `robot['move_speed'] = ${v(b, 'SPEED')}\n`,
  spike_move_cm: b => `robot['cm_per_rotation'] = ${v(b, 'CM')}\n`,

  spike_write: b => `light_matrix.write(str(${v(b, 'TEXT', Order.NONE, "''")}))\n`,
  spike_display_off: () => 'light_matrix.clear()\n',
  spike_beep: b => `await sound.beep(440, int(${v(b, 'SECONDS', Order.MULTIPLICATIVE)} * 1000), 100)\n`,

  spike_wait: b => `await runloop.sleep_ms(int(${v(b, 'SECONDS', Order.MULTIPLICATIVE)} * 1000))\n`,
  spike_wait_until: b => `await runloop.until(lambda: ${v(b, 'COND', Order.NONE, 'True')})\n`,
  // loops wait a moment each time round, like the real hub's runloop, so the robot keeps moving meanwhile
  spike_forever: b => `while True:\n${g.statementToCode(b, 'DO')}${g.INDENT}await runloop.sleep_ms(10)\n`,
  spike_repeat_until: b => `while not ${v(b, 'COND', Order.LOGICAL_NOT, 'False')}:\n${g.statementToCode(b, 'DO')}${g.INDENT}await runloop.sleep_ms(10)\n`,

  spike_color_is: b => [`color_sensor.color(${P(b)}) == color.${b.getFieldValue('COLOR')}`, Order.RELATIONAL],
  spike_reflection: b => [`color_sensor.reflection(${P(b)})`, Order.FUNCTION_CALL],
  spike_distance: b => [`${distanceCm()}(${P(b)})`, Order.FUNCTION_CALL],
  spike_closer: b => [`${distanceCm()}(${P(b)}) < ${v(b, 'CM', Order.RELATIONAL)}`, Order.RELATIONAL],
  spike_pressed: b => [`force_sensor.pressed(${P(b)})`, Order.FUNCTION_CALL],
  spike_yaw: () => [`${helper('yaw', 'def yaw():\n    return -motion_sensor.tilt_angles()[0] / 10  # degrees, turning right counts up')}()`, Order.FUNCTION_CALL],
  spike_reset_yaw: () => 'motion_sensor.reset_yaw(0)\n',
};
const distanceCm = () => helper('distance_cm', 'def distance_cm(p):\n    mm = distance_sensor.distance(p)\n    return mm / 10 if mm >= 0 else 200  # nothing in range: farther than the sensor sees');
Object.assign(g.forBlock, forBlock);
g.INDENT = '    '; // Python's usual four spaces, like the SPIKE app's examples

// The whole program as SPIKE Python, or null when there's no "when program starts" block.
// robot: { left, right } drive ports and cmPerRotation, taken from the robot being tested.
export function toPython(ws, { left = 'A', right = 'B', cmPerRotation = 17.6 } = {}) {
  const hats = ws.getTopBlocks(true).filter(b => b.type === 'spike_start' && b.isEnabled());
  if (!hats.length) return null;
  g.init(ws);
  g.definitions_.import_hub = 'from hub import port, motion_sensor, light_matrix, sound';
  g.definitions_.import_spike = 'import motor, motor_pair, color, color_sensor, distance_sensor, force_sensor, runloop';
  g.definitions_.setup = `robot = {'move_speed': 50, 'cm_per_rotation': ${+cmPerRotation.toFixed(2)}}  # changed by the Movement blocks
motor_speed = {}  # % for each port, changed by "set speed"
motor_pair.pair(${PAIR}, port.${left}, port.${right})


def velocity(percent):
    return int(percent * 10.5)  # % of a SPIKE motor's top speed (about 1050 degrees per second)


def motor_velocity(p):
    return velocity(motor_speed.get(p, 75))`;
  const vars = ws.getAllVariables().map(x => g.getVariableName(x.getId()));
  const programs = hats.map((hat, i) => {
    const body = g.blockToCode(hat);
    return `async def program_${i + 1}():\n${vars.length ? `${g.INDENT}global ${vars.join(', ')}\n` : ''}${body.trim() ? g.prefixLines(body, g.INDENT) : `${g.INDENT}pass\n`}`;
  });
  return g.finish(`${programs.join('\n\n')}\n\nrunloop.run(${hats.map((_, i) => `program_${i + 1}()`).join(', ')})\n`);
}

// ---- toolbox: the ports in it default to the robot's own ---------------------------------------------
const n = x => ({ shadow: { type: 'math_number', fields: { NUM: x } } });
const block = (type, inputs, fields, extra) => ({ kind: 'block', type, ...(inputs && { inputs }), ...(fields && { fields }), ...extra });
function toolbox(p) {
  const m = p.arm || 'C';
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: 'Events', colour: C.events, contents: [block('spike_start')] },
      { kind: 'category', name: 'Movement', colour: C.movement, contents: [
        block('spike_move_for', { AMOUNT: n(10) }), block('spike_turn', { DEGREES: n(90) }),
        block('spike_move_start', { STEER: n(0) }), block('spike_move_tank', { LEFT: n(50), RIGHT: n(50) }), block('spike_move_stop'),
        block('spike_move_speed', { SPEED: n(50) }), block('spike_move_motors', null, { LEFT: p.left || 'A', RIGHT: p.right || 'B' }),
        block('spike_move_cm', { CM: n(+(p.cmPerRotation || 17.6).toFixed(1)) }),
      ] },
      { kind: 'category', name: 'Motors', colour: C.motors, contents: [
        block('spike_motor_run_for', { AMOUNT: n(1) }, { PORT: m }), block('spike_motor_go_to', { POSITION: n(0) }, { PORT: m }),
        block('spike_motor_start', null, { PORT: m }), block('spike_motor_stop', null, { PORT: m }), block('spike_motor_speed', { SPEED: n(75) }, { PORT: m }),
        block('spike_motor_position', null, { PORT: m }), block('spike_motor_velocity', null, { PORT: m }),
      ] },
      { kind: 'category', name: 'Sensors', colour: C.sensors, contents: [
        block('spike_color_is', null, { PORT: p.color || 'C', COLOR: 'BLACK' }), block('spike_reflection', null, { PORT: p.color || 'C' }),
        block('spike_closer', { CM: n(10) }, { PORT: p.distance || 'D' }), block('spike_distance', null, { PORT: p.distance || 'D' }),
        block('spike_pressed', null, { PORT: p.force || 'E' }), block('spike_yaw'), block('spike_reset_yaw'),
      ] },
      { kind: 'category', name: 'Control', colour: C.control, contents: [
        block('spike_wait', { SECONDS: n(1) }), block('controls_repeat_ext', { TIMES: n(4) }), block('spike_forever'),
        block('controls_if'), block('controls_if', null, null, { extraState: { hasElse: true } }),
        block('spike_wait_until'), block('spike_repeat_until'),
      ] },
      { kind: 'category', name: 'Light & sound', colour: C.light, contents: [
        block('spike_write', { TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hello' } } } }), block('spike_display_off'), block('spike_beep', { SECONDS: n(0.2) }),
      ] },
      { kind: 'category', name: 'Operators', colour: C.operators, contents: [
        block('math_arithmetic', { A: n(1), B: n(1) }), block('math_random_int', { FROM: n(1), TO: n(10) }),
        block('logic_compare', { A: n(0), B: n(0) }), block('logic_operation'), block('logic_negate'), block('math_number'),
      ] },
      { kind: 'category', name: 'Variables', colour: C.variables, custom: 'VARIABLE' },
    ],
  };
}

const chain = (...bs) => bs.reduceRight((next, b) => (next ? { ...b, next: { block: next } } : b), null);
export const EXAMPLE = { blocks: { languageVersion: 0, blocks: [{ x: 24, y: 24, ...chain(
  { type: 'spike_start' },
  { type: 'controls_repeat_ext', inputs: { TIMES: n(4), DO: { block: chain(
    { type: 'spike_move_for', fields: { DIR: 'fwd', UNIT: 'cm' }, inputs: { AMOUNT: n(20) } },
    { type: 'spike_turn', fields: { DIR: 'right' }, inputs: { DEGREES: n(90) } },
  ) } } },
  { type: 'spike_write', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'Done' } } } } },
) }] } };

const style = c => ({ colourPrimary: c });
const theme = Blockly.Theme.defineTheme('studio', {
  base: Blockly.Themes.Classic,
  blockStyles: {
    logic_blocks: style(C.operators), math_blocks: style(C.operators), text_blocks: style(C.operators),
    loop_blocks: style(C.control), variable_blocks: style(C.variables), variable_dynamic_blocks: style(C.variables), procedure_blocks: style('#ff6680'),
  },
  componentStyles: {
    workspaceBackgroundColour: '#f6f7f9', toolboxBackgroundColour: '#ffffff', toolboxForegroundColour: '#1d2430',
    flyoutBackgroundColour: '#eceff3', flyoutForegroundColour: '#1d2430', flyoutOpacity: 1,
    scrollbarColour: '#b9c1cb', scrollbarOpacity: 0.5, insertionMarkerColour: '#000000', insertionMarkerOpacity: 0.18,
  },
  fontStyle: { family: '"Geist Variable", system-ui, -apple-system, "Segoe UI", sans-serif', weight: '600', size: 11 },
});

const darkTheme = Blockly.Theme.defineTheme('studio-dark', {
  base: theme,
  componentStyles: {
    workspaceBackgroundColour: '#15181c', toolboxBackgroundColour: '#191c20', toolboxForegroundColour: '#e6e9ed',
    flyoutBackgroundColour: '#20242a', flyoutForegroundColour: '#e6e9ed', flyoutOpacity: 1,
    scrollbarColour: '#4a515b', scrollbarOpacity: 0.6, insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.2,
  },
});

// A short drive ("forward 30 cm, then turn right 90") as the same SPIKE Python the blocks make.
// steps: { type: 'move', dir: 'fwd' | 'back', amount, unit } | { type: 'turn', dir: 'right' | 'left', deg } | { type: 'wait', s }
export function stepsToPython(steps, robot) {
  const blockOf = st => (st.type === 'turn' ? { type: 'spike_turn', fields: { DIR: st.dir }, inputs: { DEGREES: n(st.deg) } }
    : st.type === 'wait' ? { type: 'spike_wait', inputs: { SECONDS: n(st.s) } }
    : { type: 'spike_move_for', fields: { DIR: st.dir, UNIT: st.unit }, inputs: { AMOUNT: n(st.amount) } });
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [chain({ type: 'spike_start' }, ...steps.map(blockOf))] } }, ws);
    return toPython(ws, robot);
  } finally { ws.dispose(); }
}

export function createBlocks(container, onChange, dark = false) {
  const ws = Blockly.inject(container, {
    toolbox: toolbox({}), renderer: 'zelos', theme: dark ? darkTheme : theme, media: 'blockly-media/', sounds: false, trashcan: false,
    zoom: { controls: false, wheel: true, startScale: 0.7, minScale: 0.35, maxScale: 1.4, pinch: true },
    move: { scrollbars: true, drag: true, wheel: true },
    grid: { spacing: 28, length: 2, colour: '#dde2e8', snap: false },
  });
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* start from the example */ }
  try { Blockly.serialization.workspaces.load(saved || EXAMPLE, ws); } catch { Blockly.serialization.workspaces.load(EXAMPLE, ws); }
  ws.addChangeListener(e => {
    if (e.isUiEvent) return;
    try { localStorage.setItem(KEY, JSON.stringify(Blockly.serialization.workspaces.save(ws))); } catch { /* kept for this session */ }
    onChange?.();
  });
  new ResizeObserver(() => Blockly.svgResize(ws)).observe(container);
  setTimeout(() => { Blockly.svgResize(ws); ws.scrollCenter(); }, 400); // once the panel has finished widening
  let lastPorts = '';
  return {
    toPython: robot => toPython(ws, robot),
    // the toolbox's blocks start on your robot's ports
    setPorts(p) {
      const key = JSON.stringify(p);
      if (key !== lastPorts) { lastPorts = key; ws.updateToolbox(toolbox(p)); }
    },
    example() { ws.clear(); Blockly.serialization.workspaces.load(EXAMPLE, ws); },
    setDark: on => ws.setTheme(on ? darkTheme : theme),
    resize: () => Blockly.svgResize(ws),
  };
}
