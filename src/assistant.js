// The assistant: type what you want ("add 3 hubs on top of 3 medium motors") and it does it with the app's own tools.
// No AI service: it understands a set of everyday phrasings, asks when something is unclear, and offers buttons to answer.
import * as THREE from 'three';
import { catalog, partInfo, isWheelPart, isCasterBall } from './parts.js';
import { MOTORS } from './data/motors.js';
import { SENSORS } from './data/devices.js';
import { isHub } from './mechanism.js';

// ---------------------------------------------------------------- words
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, pair: 2 };
export const COLOURS = {
  'dark grey': '72', 'dark gray': '72', 'light grey': '71', 'light gray': '71', grey: '71', gray: '71', 'dark red': '320', 'dark blue': '272',
  'light blue': '322', azure: '322', 'dark green': '288', 'dark orange': '484', black: '0', white: '15', red: '4', blue: '1', yellow: '14',
  green: '2', orange: '25', tan: '19', brown: '70', lime: '27', purple: '85', pink: '5', teal: '3', 'bright green': '10',
};
const COLOUR_RE = new RegExp(`\\b(${Object.keys(COLOURS).sort((a, b) => b.length - a.length).join('|')})\\b`);
const info = f => catalog.get(f) || { name: '' };
const motorName = f => MOTORS[f]?.name || '';

// Parts people ask for by everyday name. `is` finds them in the robot; `file` is what gets added.
const KINDS = [
  { re: /\bev3(?: (?:hub|brain|brick|controller|computer))?s?\b(?!.*\b(?:motor|sensor))/, label: 'EV3 brick', file: '95646c01.dat', is: f => /^95646/.test(f) },
  { re: /\b(?:hub|brain|controller|computer|spike prime|prime)s?\b/, label: 'hub', file: '45601c01.dat', is: f => isHub(info(f)) },
  { re: /\b(?:medium|small|little|mid) (?:size )?motors?\b/, label: 'medium motor', file: '54696p01.dat', ev3: '99455.dat', is: f => /Medium/.test(motorName(f)) },
  { re: /\b(?:large|big) motors?\b/, label: 'large motor', file: '54675.dat', ev3: '95658.dat', is: f => /Large|NXT/.test(motorName(f)) },
  { re: /\bmotors?\b/, label: 'motor', is: f => !!MOTORS[f], ask: ['Which motor?', [['Large motor', '54675.dat', 'large motor'], ['Medium motor', '54696p01.dat', 'medium motor']]] },
  { re: /\b(?:colou?r|light) sensors?\b/, label: 'colour sensor', file: '37308.dat', ev3: '95650.dat', is: f => SENSORS[f]?.type === 'color' },
  { re: /\b(?:distance|ultrasonic|ultra sound) sensors?\b|\beyes\b/, label: 'distance sensor', file: '37316.dat', ev3: '95652.dat', is: f => SENSORS[f]?.type === 'distance' },
  { re: /\b(?:force|touch|push|press) sensors?\b|\bbuttons?\b/, label: 'force sensor', file: '37312.dat', ev3: '95648.dat', is: f => SENSORS[f]?.type === 'force' },
  { re: /\bgyro(?:scope)?(?: sensors?)?\b/, label: 'gyro sensor', file: '99380.dat', is: f => SENSORS[f]?.type === 'gyro' },
  { re: /\bsensors?\b/, label: 'sensor', is: f => !!SENSORS[f], ask: ['Which sensor?', [['Colour sensor', '37308.dat', 'colour sensor'], ['Distance sensor', '37316.dat', 'distance sensor'], ['Force sensor', '37312.dat', 'force sensor']]] },
  { re: /\b(?:ball )?cast[eo]r(?: balls?)?s?\b|\bballs?\b|\bskids?\b/, label: 'castor ball', file: '52629.dat', is: f => isCasterBall(info(f)) },
  { re: /\b(?:wheels?|tyres?|tires?)\b/, label: 'wheel', file: '39367p02.dat', is: f => isWheelPart(info(f)) },
  { re: /\b(?:angle[ds]?|bent|l[ -]?shaped?|corner) (?:beams?|liftarms?)\b/, label: 'angled beam', is: f => /^Technic Beam .*Bent/.test(info(f).name),
    ask: ['Which angled beam?', [['L shape, 3 x 5', '32526.dat', 'L-shaped beam'], ['Bent, 4 x 6 (claw arm)', '6629.dat', 'bent beam'], ['Bent, 3 x 7', '32271.dat', 'bent beam'], ['Double bent, 3 x 7', '32009.dat', 'double bent beam']]] },
  { re: /\blong pins?\b/, label: 'long pin', file: '6558.dat', is: f => f === '6558.dat' },
  { re: /\bpins?\b/, label: 'pin', file: '2780.dat', is: f => /^Technic Pin/.test(info(f).name) },
];
// Numbered families: "15 beam", "beam 7", "a 3 axle", "24 tooth gear"
const FAMILIES = [
  { re: /\b(?:beam|liftarm|lift arm)s?\b/, label: n => `${n} beam`, name: n => `Technic Beam ${n}`, any: /^Technic Beam/, sizes: [3, 5, 7, 9, 11, 13, 15], noun: 'beam' },
  { re: /\baxles?\b/, label: n => `${n} axle`, name: n => `Technic Axle ${n}`, any: /^Technic Axle/, sizes: [2, 3, 4, 5, 6, 8], noun: 'axle' },
  // the gears in robotics sets (several sizes have look-alikes, like the 24 tooth clutch gear)
  { re: /\bgears?\b|\bcogs?\b/, label: n => `${n} tooth gear`, file: { 8: '10928.dat', 12: '32270.dat', 16: '94925.dat', 20: '32269.dat', 24: '3648b.dat', 36: '32498.dat', 40: '3649.dat' }, any: /^Technic Gear/, sizes: [8, 12, 16, 20, 24, 36, 40], noun: 'gear' },
];
const OBSTACLES = { box: 'box', boxes: 'box', cube: 'box', block: 'box', wall: 'wall', walls: 'wall', ramp: 'ramp', ramps: 'ramp', can: 'cylinder', cans: 'cylinder', cylinder: 'cylinder', cylinders: 'cylinder', obstacle: 'box', obstacles: 'box' };
const STOP = new Set(['a', 'an', 'the', 'of', 'some', 'my', 'new', 'more', 'technic', 'lego', 'part', 'parts', 'piece', 'pieces', 'please']);

// "3 red medium motors" -> { count: 3, explicit: true, plural: true, colour: '4', words: 'medium motors' }
export function phrase(text) {
  let s = ` ${text.trim()} `.replace(/\s+/g, ' ');
  let colour = null;
  const c = s.match(COLOUR_RE);
  if (c) { colour = COLOURS[c[1]]; s = s.replace(c[0], ' '); }
  s = s.trim().replace(/^(?:all(?: of)?|both(?: of)?|these|those|some|more|another)\s+/, '').replace(/^(?:the|my)\s+/, '');
  let count = 1, explicit = false;
  const m = s.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple of|a pair of|a|an)\s+(.*)$/);
  // "15 beam" is a size; "2 beams" is a count
  if (m && !/^\d+\s+(?:hole |long |l )?(?:beam|liftarm|axle|gear|tooth)\b(?!s)/.test(s)) {
    const w = m[1].replace(/^a (couple|pair) of$/, '$1');
    if (w !== 'a' && w !== 'an') { count = +w || NUMBER_WORDS[w]; explicit = true; }
    s = m[2];
  }
  const words = s.trim();
  const plural = explicit ? count > 1 : /[^s]s$/.test(words.split(' ').pop());
  return { count, explicit, plural, colour, words };
}

// What kind of part a phrase means: { label, file, is } to add or find, { ask } when it needs a choice, or null.
export function kindOf(words) {
  const ev3 = /\bev3\b/.test(words);
  for (const k of KINDS) {
    if (!k.re.test(words)) continue;
    if (k.ask) return { label: k.label, is: k.is, ask: k.ask };
    return { label: ev3 && k.ev3 ? `EV3 ${k.label}` : k.label, file: ev3 && k.ev3 ? k.ev3 : k.file, is: k.is };
  }
  for (const fam of FAMILIES) {
    if (!fam.re.test(words)) continue;
    const n = +(words.match(/\b(\d+)\b/)?.[1] || 0);
    const fileOf = z => (fam.file ? fam.file[z] : [...catalog.values()].find(p => p.name === fam.name(z))?.file);
    const file = n && fileOf(n);
    if (file) return { label: fam.label(n), file, is: f => f === file };
    return { label: fam.noun, is: f => fam.any.test(info(f).name), ask: [`How long a ${fam.noun}?`, fam.sizes.map(z => [fam.label(z), fileOf(z), fam.label(z)]).filter(o => o[1])] };
  }
  // anything else: search the part names (Technic and electric parts first, shortest names first)
  const terms = words.split(/\s+/).map(w => w.replace(/s$/, '')).filter(w => w.length > 1 && !STOP.has(w));
  if (!terms.length) return null;
  const hits = [...catalog.values()].filter(p => terms.every(t => p.name.toLowerCase().includes(t) || p.file.startsWith(t)))
    .sort((a, b) => (/^(Technic|Electric)/.test(b.name) - /^(Technic|Electric)/.test(a.name)) || a.name.length - b.name.length);
  if (!hits.length) return null;
  if (hits.length === 1 || hits[0].name.toLowerCase() === terms.join(' ')) return { label: hits[0].name, file: hits[0].file, is: f => f === hits[0].file };
  return { label: words, is: f => hits.some(h => h.file === f), ask: [`I found ${hits.length} parts like that. Which one?`, hits.slice(0, 4).map(h => [h.name, h.file, h.name])] };
}

const RELATIONS = [
  ['on', /\s+(?:on top of|on to|onto|on|above|over|atop)\s+/],
  ['under', /\s+(?:under(?:neath)?|below|beneath)\s+/],
  ['left', /\s+(?:to the left of|on the left of|left of)\s+/],
  ['right', /\s+(?:to the right of|on the right of|right of|next to|beside|by)\s+/],
  ['front', /\s+(?:in front of|at the front of)\s+/],
  ['behind', /\s+(?:behind|at the back of)\s+/],
];
const THEM = /^(?:it|them|that|this|those|these|those parts|the selection|selection|selected(?: parts?)?|what i selected)$/;
const ALL = /^(?:the )?(?:robot|model|bot|everything|whole thing|whole robot|it all|all)$/;

function driveSteps(t) {
  if (!/^(?:drive|move|go|run|turn (?:left|right)|spin|reverse|back up)\b/.test(t) || /^(?:move|turn) (?:it|them|the|that|this)\b/.test(t)) return null;
  const steps = [];
  for (const part of t.split(/\s*(?:,|\bthen\b|\band then\b|\band\b)\s*/).filter(Boolean)) {
    let m;
    if ((m = part.match(/turn (left|right)(?: by)?(?: (\d+(?:\.\d+)?))?/))) steps.push({ type: 'turn', dir: m[1], deg: +(m[2] || 90) });
    else if (/spin(?: around)?|turn around/.test(part)) steps.push({ type: 'turn', dir: 'right', deg: 180 });
    else if ((m = part.match(/wait(?: for)? (\d+(?:\.\d+)?)/))) steps.push({ type: 'wait', s: +m[1] });
    else {
      const dir = part.match(/\b(forwards?|ahead|straight|backwards?|back|reverse)\b/);
      const num = part.match(/(\d+(?:\.\d+)?) ?(cm|centimet(?:er|re)s?|mm|millimet(?:er|re)s?|m|met(?:er|re)s?|inch(?:es)?|in|rotations?|turns?|degrees?|seconds?|secs?|s)?\b/);
      if (!dir && !num) return null; // a piece we don't understand: better to ask than to guess
      const w = (num?.[2] || 'cm').replace(/(?<=.)s$/, '');
      const unit = /^(?:inche?|inch|in)$/.test(w) ? 'in' : /^(?:rotation|turn)$/.test(w) ? 'rotations' : w === 'degree' ? 'degrees' : /^(?:s|sec|second)$/.test(w) ? 'seconds' : 'cm';
      const scale = unit === 'cm' ? ({ mm: 0.1, millimeter: 0.1, millimetre: 0.1, m: 100, meter: 100, metre: 100 })[w] ?? 1 : 1;
      steps.push({ type: 'move', dir: /back|reverse/.test(dir?.[1] || '') ? 'back' : 'fwd', amount: +(+(num?.[1] || 20) * scale).toFixed(1), unit });
    }
  }
  return steps.length ? steps : null;
}

// The parts a longer description mentions, as one-step requests: "two medium motors ... one tire" ->
// ["add 2 medium motors", "add 1 wheel"]. Offered as buttons when a message is more than I can follow.
const COUNT = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)';
export function mentions(text) {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `, out = [];
  const nouns = [...KINDS.filter(k => !k.ask || k.label === 'angled beam').map(k => [k.re, k.label]), ...FAMILIES.map(f => [f.re, f.noun])];
  for (const [re, label] of nouns) {
    for (const m of t.matchAll(new RegExp(`\\b${COUNT}\\s+((?:\\w+\\s+){0,2}?)(${re.source.replace(/\\b/g, '')})`, 'g'))) {
      const n = +m[1] || NUMBER_WORDS[m[1]] || 1;
      const words = `${m[2]}${m[3]}`.trim();
      if (kindOf(words)?.label !== label && label !== 'angled beam' && !FAMILIES.some(f => f.noun === label)) continue; // e.g. "medium motor" is not a plain "motor"
      out.push(`add ${n} ${n === 1 ? label : `${label}s`}`);
    }
  }
  return [...new Set(out)];
}

// One sentence -> what to do. Pure: no app state, so it can be tested on its own.
export function parse(raw) {
  if (raw.trim().split(/\s+/).length > 22) return { do: 'too-much', text: raw };
  let t = raw.toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:hey|hi|ok|okay|please|now|so|and|then)\s+/g, '').replace(/^(?:can|could|would) you\s+/, '').replace(/^(?:i want(?: you)? to|i'd like to|let's|lets)\s+/, '').replace(/\s+please$/, '');
  if (!t) return null;
  if (/^(?:hi|hello|hey|yo|sup|good (?:morning|afternoon|evening))$/.test(t)) return { do: 'hello' };
  if (/^(?:help|what can you do|commands|how do (?:i|you) use (?:this|you)|\?)/.test(t)) return { do: 'help' };
  if (/^(?:undo|oops|take (?:that|it) back)\b|^go back$/.test(t)) return { do: 'undo' };
  if (/^redo\b/.test(t)) return { do: 'redo' };
  if (/\b(?:dark|night) (?:mode|theme)\b|^(?:make it |go |switch to )?dark$|turn off the lights/.test(t)) return { do: 'theme', theme: 'dark' };
  if (/\b(?:light|day) (?:mode|theme)\b|^(?:make it |go |switch to )?light$/.test(t)) return { do: 'theme', theme: 'light' };
  if (/^(?:clear|start (?:over|again|fresh)|new robot|reset the robot|delete (?:it all|everything)|remove everything|clear (?:it|all|everything|the robot))$/.test(t)) return { do: 'clear' };
  if (/\bexample\b/.test(t)) return { do: 'example' };
  if (/^(?:go to |switch to |open |back to )?(?:test|testing)(?: mode)?$|^let me test|^test it$/.test(t)) return { do: 'mode', mode: 'test' };
  if (/^(?:go to |switch to |open |back to )?(?:build|building)(?: mode)?$/.test(t)) return { do: 'mode', mode: 'build' };
  if (/^(?:play|start|go|run it|start (?:it|the sim(?:ulation)?|driving))$/.test(t)) return { do: 'play' };
  if (/^(?:pause|stop|stop it|freeze)$/.test(t)) return { do: 'pause' };
  if (/^(?:reset|restart|put it back)$/.test(t)) return { do: 'reset' };
  if (/\b(?:fit|frame|zoom out|show (?:me )?(?:everything|the (?:whole )?robot)|centre|center)\b/.test(t) && !/\badd\b/.test(t)) return { do: 'fit' };
  if (/how (?:heavy|much does (?:it|the robot) weigh)|\bweight\b|\bmass\b/.test(t)) return { do: 'info', what: 'mass' };
  if (/how many (?:parts|pieces)/.test(t)) return { do: 'info', what: 'count' };
  if (/\b(?:wro|fll)\b|how (?:big|tall|wide|long)|\bsize\b|dimensions/.test(t)) return { do: 'info', what: 'size' };

  const steps = driveSteps(t);
  if (steps) return { do: 'drive', steps };

  let m;
  const colourAt = t.match(new RegExp(`^(?:colou?r|paint|make|turn|change)\\s+(.*?)\\s+(?:to\\s+|in\\s+|into\\s+)?(?:the colou?r\\s+)?${COLOUR_RE.source}$`));
  if (colourAt) return { do: 'colour', target: phrase(colourAt[1] || 'it'), colour: COLOURS[colourAt[2]] };
  if ((m = t.match(/^(?:delete|remove|take (?:off|away)|get rid of|throw away)\s+(.+)$/))) return { do: 'remove', target: phrase(m[1]) };
  if ((m = t.match(/^(?:select|pick|choose|highlight|show me|where(?: is|'s| are)|find)\s+(.+)$/))) return { do: 'select', target: phrase(m[1]) };
  if ((m = t.match(/^(?:turn|rotate|spin|flip|tip)\s+(.+?)(?:\s+(?:by\s+)?(90|180|270)\s*(?:degrees?|°)?)?(?:\s+(over|on (?:to )?its side|upside down|sideways))?$/))) {
    return { do: 'turn', target: phrase(m[1]), quarter: m[2] ? +m[2] / 90 : 1, tip: !!m[3] || /^(?:flip|tip)/.test(t) };
  }
  if ((m = t.match(/^(?:add|put|place|attach|stick|mount|fix|build|give (?:it|me|the robot)|i need|make|insert|connect)\s+(.+)$/))) {
    let what = m[1], rel = null, target = null;
    for (const [name, re] of RELATIONS) {
      const at = what.search(re);
      if (at > 0) { rel = name; target = phrase(what.slice(at).replace(re, '')); what = what.slice(0, at); break; }
    }
    what = what.replace(/\s+(?:to|on) (?:it|the robot|my robot)$/, '');
    // a part name is a few words; anything longer is a description I'd only half understand
    if (what.split(' ').length > 5 || (target && target.words.split(' ').length > 5)) return { do: 'too-much', text: raw };
    return { do: 'add', what: phrase(what), rel, target };
  }
  return null;
}

// ---------------------------------------------------------------- doing it
const EXAMPLES = ['add a hub on top of 2 large motors', 'add 2 wheels next to the motors', 'make the hub black', 'turn it', 'drive forward 30 cm then turn right', 'how heavy is it?'];
const HELLO = 'Hi! Tell me what to build or test, or give me a picture or a LEGO file (the clip button, or drop it here). For example:';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /s$/.test(word) ? '' : 's'}`;

// app: the bits of Robot Studio the assistant may use (see main.js)
export function createAssistant(root, app) {
  const chat = root.querySelector('.chat'), form = root.querySelector('form'), input = form.querySelector('input');
  let pending = null; // the question waiting for an answer: [{ label, run }]
  let lastAdded = [];

  const bubble = (text, who) => {
    const el = document.createElement('div');
    el.className = `msg ${who}`;
    el.textContent = text;
    chat.append(el);
    chat.scrollTop = chat.scrollHeight;
    return el;
  };
  const say = text => bubble(text, 'bot');
  // ask with buttons; typing one of the answers works too
  function ask(question, options) {
    say(question);
    const row = document.createElement('div');
    row.className = 'choices';
    pending = options.concat({ label: 'Cancel', run: () => say('Okay, I left it as it was.') });
    pending.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.label;
      if (i === 0) b.className = 'primary';
      b.addEventListener('click', () => answer(o));
      row.append(b);
    });
    chat.append(row);
    chat.scrollTop = chat.scrollHeight;
  }
  async function answer(o) {
    chat.querySelectorAll('.choices').forEach(r => r.remove());
    pending = null;
    bubble(o.label, 'me');
    try { await o.run(); } catch (err) { say(`That didn't work: ${err.message}`); console.error(err); }
  }
  function suggest(lines = EXAMPLES) {
    const row = document.createElement('div');
    row.className = 'try';
    for (const line of lines) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = line;
      b.addEventListener('click', () => { row.remove(); send(line); });
      row.append(b);
    }
    chat.append(row);
    chat.scrollTop = chat.scrollHeight;
  }

  // ---- finding parts in the robot ----
  const partsOf = kind => app.editor.parts().filter(o => kind.is(o.userData.file));
  const byX = objs => objs.slice().sort((a, b) => a.position.x - b.position.x);
  async function targets(t) {
    if (THEM.test(t.words)) {
      const sel = app.selection();
      return { objs: sel.length ? sel : lastAdded.filter(o => o.parent), label: sel.length ? 'what you selected' : 'the last parts I added', them: true };
    }
    if (ALL.test(t.words)) return { objs: app.editor.parts(), label: 'the whole robot', them: true };
    const kind = kindOf(t.words);
    if (!kind) return null;
    return { kind, objs: byX(partsOf(kind)), label: kind.label };
  }

  // ---- placing new parts ----
  const boxOf = async o => { o.updateMatrix(); return (await partInfo(o.userData.file)).box.clone().applyMatrix4(o.matrix); }; // LDraw units, -Y up
  const overlapXZ = (a, b) => a.min.x < b.max.x - 1 && a.max.x > b.min.x + 1 && a.min.z < b.max.z - 1 && a.max.z > b.min.z + 1;
  const snap = v => Math.round(v / 10) * 10; // half a stud

  // minWidth: space them at least this far apart (LDraw units), e.g. to fit what will go on top
  async function place(file, count, colour, rel, onto, minWidth = 0) {
    const local = (await partInfo(file)).box, size = local.getSize(new THREE.Vector3()), mid = local.getCenter(new THREE.Vector3());
    const all = app.editor.parts();
    const boxes = await Promise.all(all.map(boxOf));
    const union = list => list.reduce((u, b) => u.union(b), new THREE.Box3());
    const U = onto?.length ? union(await Promise.all(onto.map(boxOf))) : boxes.length ? union(boxes) : null;
    const gap = 8, spanX = Math.max(size.x, minWidth) + gap, spanZ = size.z + gap;
    let centres = [];
    if ((rel === 'on' || rel === 'under') && onto.length === count) {
      centres = await Promise.all(onto.map(async o => (await boxOf(o)).getCenter(new THREE.Vector3())));
      // one each, unless they'd overlap each other: then side by side over all of them
      if (centres.some((c, i) => i && Math.abs(c.x - centres[i - 1].x) < size.x && Math.abs(c.z - centres[i - 1].z) < size.z)) centres = [];
    }
    if (!centres.length) {
      const c = U ? U.getCenter(new THREE.Vector3()) : new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        const along = (i - (count - 1) / 2) * spanX;
        if (rel === 'on' || rel === 'under') centres.push(new THREE.Vector3(c.x + along, 0, c.z));
        else if (rel === 'left') centres.push(new THREE.Vector3(U.min.x - size.x / 2 - 4 - i * spanX, 0, c.z));
        else if (rel === 'front') centres.push(new THREE.Vector3(c.x, 0, U.min.z - size.z / 2 - 4 - i * spanZ)); // the robot's front is -Z in LDraw
        else if (rel === 'behind') centres.push(new THREE.Vector3(c.x, 0, U.max.z + size.z / 2 + 4 + i * spanZ));
        else if (U) centres.push(new THREE.Vector3(U.max.x + size.x / 2 + (rel === 'right' ? 4 : 24) + i * spanX, 0, c.z)); // beside it, or beside the robot
        else centres.push(new THREE.Vector3(along, 0, 0));
      }
    }
    const placed = [], records = [];
    for (const c of centres) {
      const x = snap(c.x - mid.x), z = snap(c.z - mid.z);
      const foot = local.clone().translate(new THREE.Vector3(x, 0, z));
      let y;
      if (rel === 'on') { // rest on the highest thing under it
        const below = boxes.filter(b => overlapXZ(b, foot));
        y = Math.min(U.min.y, ...below.map(b => b.min.y)) - local.max.y;
      } else if (rel === 'under') y = U.max.y - local.min.y;
      else if (rel && U) y = U.max.y - local.max.y; // beside it, standing at the same level
      else y = -local.max.y; // on the floor
      placed.push(local.clone().translate(new THREE.Vector3(x, y, z)));
      const isElectric = info(file).cat === 'Electric';
      records.push({ file, color: colour || (isElectric ? '15' : '71'), m: [x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1] });
    }
    // anything now below the floor (parts added underneath): lift the whole robot so it stands on the floor
    const lowest = Math.max(...placed.map(b => b.max.y));
    const objs = await app.editor.insert(records, { commit: false });
    if (lowest > 0) for (const o of app.editor.parts()) { o.position.y -= lowest; o.updateMatrix(); }
    await app.drop(objs);
    lastAdded = objs;
    return objs;
  }

  // ---- what each request does ----
  async function addParts(cmd, kind) {
    const { what, rel, target } = cmd;
    if (app.mode() !== 'build') { await app.setMode('build'); }
    let onto = null;
    if (rel) {
      const found = await targets(target);
      if (!found) return say(`I don't know which part "${target.words}" is. Try "the hub", "the motors" or "it" (what you selected).`);
      let objs = found.objs;
      if (!objs.length && found.them) return say('Select a part first (click it), or name it, like "on top of the hub".');
      if (!objs.length) {
        const k = found.kind;
        if (!k.file) return say(`There's no ${k.label} on your robot yet. Add one first, then ask again.`);
        const need = target.explicit ? target.count : 1;
        return ask(`Your robot has no ${k.label} yet. Shall I add ${plural(need, k.label)} first, then put the ${plural(what.count, kind.label).replace(/^1 /, '')} ${relWords(rel)} ${need === 1 ? 'it' : 'them'}?`, [
          { label: `Yes, add both`, run: async () => { const base = await place(k.file, need, null, null, null, (await partInfo(kind.file)).box.getSize(new THREE.Vector3()).x); return finishAdd(cmd, kind, base, k.label); } },
        ]);
      }
      if (target.explicit && objs.length < target.count) {
        const k = found.kind, missing = target.count - objs.length;
        const options = [{ label: `Use the ${objs.length} there`, run: () => finishAdd(cmd, kind, objs, found.label) }];
        if (k?.file) options.unshift({ label: `Add ${missing} more first`, run: async () => finishAdd(cmd, kind, [...objs, ...(await place(k.file, missing, null, 'right', objs))], found.label) });
        return ask(`Your robot has only ${plural(objs.length, found.label)}, not ${target.count}.`, options);
      }
      if (target.explicit && objs.length > target.count) objs = objs.slice(0, target.count);
      if (!target.explicit && !target.plural && !found.them && objs.length > 1) {
        return ask(`There are ${objs.length} ${found.label}s. Which one?`, [
          { label: `All ${objs.length}`, run: () => finishAdd(cmd, kind, objs, found.label) },
          { label: 'The left one', run: () => finishAdd(cmd, kind, [objs[0]], found.label) },
          { label: 'The right one', run: () => finishAdd(cmd, kind, [objs[objs.length - 1]], found.label) },
        ]);
      }
      onto = objs;
      return finishAdd(cmd, kind, onto, found.label);
    }
    return finishAdd(cmd, kind, onto);
  }
  async function finishAdd(cmd, kind, onto, ontoLabel) {
    const objs = await place(kind.file, cmd.what.count, cmd.what.colour, cmd.rel, onto);
    app.editor.commit();
    app.select(objs);
    const of = onto && (/^(?:what|the (?:last|whole))/.test(ontoLabel) ? ontoLabel : onto.length === 1 ? `the ${ontoLabel}` : `the ${plural(onto.length, ontoLabel)}`);
    say(`Added ${plural(objs.length, kind.label)}${cmd.rel ? ` ${relWords(cmd.rel)} ${of}` : ''}. ${objs.length === 1 ? 'It\'s' : 'They\'re'} selected: use the buttons under the view to turn or move ${objs.length === 1 ? 'it' : 'them'}, or Undo to take ${objs.length === 1 ? 'it' : 'them'} away.`);
  }
  const relWords = rel => ({ on: 'on top of', under: 'under', left: 'to the left of', right: 'next to', front: 'in front of', behind: 'behind' })[rel];

  async function add(cmd) {
    const word = cmd.what.words.split(' ').pop();
    if (OBSTACLES[word] && !/\bbeams?\b/.test(cmd.what.words)) { // test-arena things
      const n = cmd.what.count;
      for (let i = 0; i < n; i++) await app.addObstacle(OBSTACLES[word], i, cmd.rel);
      return say(`Added ${plural(n, OBSTACLES[word] === 'cylinder' ? 'can' : OBSTACLES[word])} to the arena${cmd.rel === 'front' ? ' in front of the robot' : ''}. Drag it to move it; its size is on the left.`);
    }
    const kind = kindOf(cmd.what.words);
    if (!kind) return say(`I don't know a part called "${cmd.what.words}". Try its name or number, like "15 beam", "medium motor" or "32278", or search the list on the left.`);
    if (kind.ask) {
      const [q, opts] = kind.ask;
      return ask(q, opts.map(([label, file, short]) => ({ label, run: () => addParts(cmd, { label: short, file, is: f => f === file }) })));
    }
    return addParts(cmd, kind);
  }

  async function withTargets(t, what, fn) {
    const found = await targets(t);
    if (!found) return say(`I don't know which part "${t.words}" is.`);
    if (!found.objs.length) return say(found.them ? `Select a part first (click it), then ask me to ${what} it.` : `Your robot has no ${found.label}.`);
    let objs = found.objs;
    if (t.explicit) objs = objs.slice(0, t.count);
    else if (!t.plural && !found.them && objs.length > 1) {
      return ask(`There are ${objs.length} ${found.label}s. Which?`, [
        { label: `All ${objs.length}`, run: () => fn(objs, found) },
        { label: 'The left one', run: () => fn([objs[0]], found) },
        { label: 'The right one', run: () => fn([objs[objs.length - 1]], found) },
      ]);
    }
    return fn(objs, found);
  }

  async function run(cmd) {
    switch (cmd.do) {
      case 'hello': say(HELLO); return suggest();
      case 'help':
        say('I can add parts and put them on top of, under, or next to other parts; colour, turn, select and delete parts; drive the robot; add obstacles; use pictures (as a mat, or pinned up to copy from) and LEGO files; switch dark or light; and tell you the robot\'s weight and size. When something is unclear I ask.');
        return suggest();
      case 'undo': await app.editor.undo(); return say('Undone.');
      case 'redo': await app.editor.redo(); return say('Redone.');
      case 'theme': app.setTheme(cmd.theme); return say(`${cmd.theme === 'dark' ? 'Dark' : 'Light'} it is.`);
      case 'example': app.openExample(); return say('Opened the example drive base: a hub, two large motors with wheels, and a castor ball.');
      case 'mode': await app.setMode(cmd.mode); return say(cmd.mode === 'test' ? 'Test mode: press Play (or ask me to drive).' : 'Back to building.');
      case 'play': if (app.mode() !== 'test') await app.setMode('test'); await app.play(true); return say('Running. Drive with W A S D, or ask me, like "drive forward 30 cm".');
      case 'pause': app.play(false); return say('Paused.');
      case 'reset': app.reset(); return say('Everything is back where it started.');
      case 'fit': app.fit(); return say('There you go.');
      case 'clear':
        if (!app.editor.parts().length) return say('There\'s nothing to clear.');
        return ask(`Remove all ${app.editor.parts().length} parts? Undo can bring them back.`, [{ label: 'Yes, clear it', run: () => { app.editor.clear(); app.select([]); say('Cleared. Start with "open the example" or "add a hub".'); } }]);
      case 'info': {
        const s = await app.stats();
        if (!s.parts) return say('There\'s nothing built yet.');
        if (cmd.what === 'mass') return say(`Your robot weighs ${s.grams.toFixed(0)} g (${s.parts} parts).`);
        if (cmd.what === 'count') return say(`${s.parts} parts.`);
        const [w, l, h] = s.size;
        return say(`It's ${w} mm wide, ${l} mm long and ${h} mm tall.\nWRO (fits in 250 mm): ${Math.max(w, l, h) <= 250 ? 'yes' : 'no'}. FLL (305 mm tall): ${h <= 305 ? 'yes' : 'no'}.`);
      }
      case 'drive': {
        const text = cmd.steps.map(s => (s.type === 'turn' ? `turn ${s.dir} ${s.deg}°` : s.type === 'wait' ? `wait ${s.s} s` : `${s.dir === 'back' ? 'back' : 'forward'} ${s.amount} ${s.unit}`)).join(', then ');
        say(`Driving: ${text}.`);
        const err = await app.drive(cmd.steps);
        return err && say(err);
      }
      case 'add': return add(cmd);
      case 'too-much': {
        const steps = mentions(cmd.text);
        say(steps.length
          ? 'That\'s more than I can follow in one go. I understand one step at a time. Here are the parts you mentioned; tap them one by one, then move each into place (or say "on top of the hub", "next to the motors"):'
          : 'That\'s more than I can follow in one go. Tell me one step at a time, for example:');
        return suggest(steps.length ? steps : EXAMPLES);
      }
      case 'remove': return withTargets(cmd.target, 'delete', objs => { app.editor.remove(objs); app.select([]); say(`Deleted ${plural(objs.length, 'part')}. Undo brings ${objs.length === 1 ? 'it' : 'them'} back.`); });
      case 'select': return withTargets(cmd.target, 'select', objs => { app.select(objs); say(`Selected ${plural(objs.length, 'part')}.`); });
      case 'colour': return withTargets(cmd.target, 'colour', async objs => { for (const o of objs) await app.editor.recolor(o, cmd.colour); app.select(objs); say('Done.'); });
      case 'turn': return withTargets(cmd.target, 'turn', objs => {
        app.select(objs);
        for (let i = 0; i < (cmd.tip ? 1 : cmd.quarter); i++) app.turn(cmd.tip);
        say(cmd.tip ? 'Tipped it onto its side.' : `Turned ${cmd.quarter * 90}°.`);
      });
    }
  }

  // ---------------------------------------------------------------- the smart assistant (Google Gemini, via our server)
  // When the server has a Gemini key, messages and pictures go to Gemini, which answers by calling the actions
  // below. They run here, on the 3D model. Without a key (or when the free quota runs out) the offline parser answers.
  const ai = { on: false, id: null, picture: null, waiting: null, held: [] }; // waiting: a question Gemini asked; held: results to send with the next message
  const MM = 0.4; // mm per LDraw unit
  const round = v => Math.round(v * 10) / 10;
  const COLOUR_NAME = Object.fromEntries(Object.entries(COLOURS).reverse().map(([n, c]) => [c, n]));
  const colourCode = name => (name ? COLOURS[String(name).toLowerCase()] ?? (/^\d+$/.test(name) ? String(name) : null) : null);
  const byIds = list => app.editor.parts().filter(o => (list || []).includes(o.id));
  async function facts(objs = app.editor.parts()) {
    return Promise.all(objs.slice(0, 200).map(async o => {
      const b = await boxOf(o), c = b.getCenter(new THREE.Vector3()), z = b.getSize(new THREE.Vector3());
      return {
        id: o.id, name: info(o.userData.file).name || o.userData.file, part: o.userData.file.replace(/\.dat$/, ''), colour: COLOUR_NAME[o.userData.color] || o.userData.color,
        centre_mm: { right: round(c.x * MM), up: round(-c.y * MM), forward: round(-c.z * MM) }, size_mm: { across: round(z.x * MM), tall: round(z.y * MM), long: round(z.z * MM) },
      };
    }));
  }
  const partNamed = name => {
    const file = String(name).toLowerCase().replace(/\.dat$/, '') + '.dat';
    return catalog.has(file) ? { file, label: info(file).name } : kindOf(String(name).toLowerCase());
  };
  let touched = [], edited = false;
  const aiTools = {
    look_at_robot: async () => ({ mode: app.mode(), parts: await facts() }),
    find_parts: ({ query }) => {
      const terms = String(query).toLowerCase().split(/\s+/).filter(t => t && !STOP.has(t));
      return { matches: [...catalog.values()].filter(p => terms.every(t => p.name.toLowerCase().includes(t) || p.file.startsWith(t)))
        .sort((a, b) => (/^(Technic|Electric)/.test(b.name) - /^(Technic|Electric)/.test(a.name)) || a.name.length - b.name.length)
        .slice(0, 8).map(p => ({ part: p.file.replace(/\.dat$/, ''), name: p.name })) };
    },
    async add_parts({ part, count = 1, colour, relation, target_ids }) {
      const kind = partNamed(part);
      if (!kind) return { error: `No part called "${part}". Use find_parts.` };
      if (kind.ask) return { error: `"${part}" could be: ${kind.ask[1].map(o => `${o[0]} (part ${o[1].replace(/\.dat$/, '')})`).join(', ')}. Ask the student or pick one by part number.` };
      const onto = byIds(target_ids);
      if (relation && !onto.length) return { error: 'relation needs target_ids of parts that are in the robot' };
      if (app.mode() !== 'build') await app.setMode('build');
      const objs = await place(kind.file, Math.min(Math.max(1, count | 0), 12), colourCode(colour), relation || null, onto.length ? onto : null);
      touched.push(...objs);
      edited = true;
      return { added: await facts(objs) };
    },
    move_parts({ ids, right_mm = 0, up_mm = 0, forward_mm = 0 }) {
      const objs = byIds(ids);
      for (const o of objs) { o.position.x += right_mm / MM; o.position.y -= up_mm / MM; o.position.z -= forward_mm / MM; o.updateMatrix(); }
      touched.push(...objs);
      edited = true;
      return { moved: objs.map(o => o.id) };
    },
    turn_parts({ ids, axis, quarter_turns = 1 }) {
      const objs = byIds(ids);
      if (!objs.length) return { error: 'no parts with those ids' };
      app.select(objs);
      for (let i = 0; i < ((quarter_turns | 0) % 4 + 4) % 4; i++) app.turn(axis === 'tip');
      touched.push(...objs);
      return { turned: objs.map(o => o.id) };
    },
    async colour_parts({ ids, colour }) {
      const code = colourCode(colour);
      if (!code) return { error: `I don't know the colour "${colour}". Try: ${Object.keys(COLOURS).join(', ')}` };
      const objs = byIds(ids);
      for (const o of objs) await app.editor.recolor(o, code);
      return { coloured: objs.map(o => o.id) };
    },
    delete_parts({ ids }) { const objs = byIds(ids); app.editor.remove(objs); touched = touched.filter(o => !objs.includes(o)); return { deleted: objs.map(o => o.id) }; },
    async undo() { await app.editor.undo(); return { done: true }; },
    async drive_robot({ steps }) {
      const plan = (steps || []).map(st => (st.action === 'wait' ? { type: 'wait', s: +st.amount || 1 }
        : st.action.startsWith('turn') ? { type: 'turn', dir: st.action === 'turn_left' ? 'left' : 'right', deg: +st.amount || 90 }
        : { type: 'move', dir: st.action === 'back' ? 'back' : 'fwd', amount: +st.amount || 20, unit: 'cm' }));
      const err = await app.drive(plan);
      return err ? { error: err } : { started: true };
    },
    async add_obstacle({ type, count = 1, in_front_of_robot }) {
      for (let i = 0; i < Math.min(count | 0 || 1, 6); i++) await app.addObstacle(type === 'can' ? 'cylinder' : type, i, in_front_of_robot ? 'front' : null);
      return { added: count };
    },
    async use_picture_as_mat() {
      if (!ai.picture) return { error: 'no picture was sent' };
      if (app.mode() !== 'test') await app.setMode('test');
      return (await app.upload(ai.picture.file)) ? { done: true } : { error: 'could not read the picture' };
    },
    async set_mode({ mode }) { await app.setMode(mode); return { mode }; },
  };

  async function askAI(input, text = '') {
    const thinking = say('Thinking…');
    thinking.classList.add('thinking');
    try {
      for (let turn = 0; turn < 15; turn++) {
        const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interactionId: ai.id, input }) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) return trouble(out.error, text);
        ai.id = out.id;
        if (!out.calls.length) { if (out.text) say(out.text); return; }
        const results = [];
        let question = null, finished = null;
        for (const c of out.calls) {
          if (c.name === 'ask_user') { question = c; continue; }
          if (c.name === 'done') { finished = c; continue; }
          let value;
          try { value = aiTools[c.name] ? await aiTools[c.name](c.args || {}) : { error: 'unknown action' }; } catch (err) { value = { error: err.message }; console.error(err); }
          results.push({ type: 'function_result', name: c.name, call_id: c.id, result: JSON.stringify(value) });
        }
        if (question) return askFromAI(question, results);
        // finished, and everything worked: show its summary now instead of another trip to Google;
        // the results go along with the next message (the conversation needs them)
        if (finished && !results.some(r => r.result.includes('"error"'))) {
          say(finished.args.summary || 'Done.');
          ai.held = [...results, { type: 'function_result', name: 'done', call_id: finished.id, result: '{"shown":true}' }];
          return;
        }
        if (finished) results.push({ type: 'function_result', name: 'done', call_id: finished.id, result: '{"shown":false,"note":"an action failed; fix it first"}' });
        input = results;
      }
      say('That took too many steps, so I stopped. Tell me what to do next.');
    } catch (err) {
      console.error(err);
      trouble('offline', text);
    } finally {
      thinking.remove();
      if (edited) app.editor.commit();
      const alive = touched.filter(o => o.parent);
      if (alive.length) app.select([...new Set(alive)]);
      touched = []; edited = false;
    }
  }
  // Gemini asked something: show its options as buttons; the answer goes back with the held action results.
  function askFromAI(call, results) {
    say(call.args.question || 'Which one?');
    ai.waiting = { call, results };
    const opts = (call.args.options || []).slice(0, 5);
    if (!opts.length) return;
    const row = document.createElement('div');
    row.className = 'choices';
    opts.forEach(label => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => send(label));
      row.append(b);
    });
    chat.append(row);
    chat.scrollTop = chat.scrollHeight;
  }
  function answerAI(text) {
    const { call, results } = ai.waiting;
    ai.waiting = null;
    chat.querySelectorAll('.choices').forEach(r => r.remove());
    return askAI([...results, { type: 'function_result', name: 'ask_user', call_id: call.id, result: JSON.stringify({ answer: text }) }]);
  }
  function trouble(error, text) {
    if (error === 'slow-down') return say('That\'s a lot of messages at once. Wait a minute, then try again.');
    if (error === 'quota') say('Google\'s free limit is used up for now, so I\'ve switched to the simple offline assistant until it resets.');
    else say('The smart assistant isn\'t answering right now, so I\'ve switched to the simple offline one.');
    ai.on = false;
    ai.id = null;
    ai.held = [];
    if (text) return offline(text); // still answer what was asked
  }
  // a picture, made smaller (fewer tokens, faster) and turned into JPEG so any format works
  async function shrink(file) {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(img.src);
    return cv.toDataURL('image/jpeg', 0.85);
  }
  fetch('/api/assistant/status').then(r => r.json()).then(st => {
    if (!st.ai) return;
    ai.on = true;
    input.placeholder = 'Ask anything, or give me a picture…';
    say('I\'m connected to Google Gemini, so talk to me normally and send photos of robots to copy. (What you send goes to Google, which may use it to improve its products.)');
  }).catch(() => { /* no server: offline only */ });

  async function send(text) {
    text = text.trim();
    if (!text && !(ai.on && ai.picture?.fresh)) return;
    if (ai.on) {
      if (ai.waiting) { bubble(text, 'me'); return answerAI(text); }
      chat.querySelectorAll('.choices, .try').forEach(r => r.remove());
      pending = null;
      if (text) bubble(text, 'me');
      // the robot's parts come with the message, so Gemini doesn't spend a round trip looking
      const parts = (await facts()).slice(0, 80).map(p => `${p.id} ${p.name} (part ${p.part}, ${p.colour}) at right ${p.centre_mm.right}, up ${p.centre_mm.up}, forward ${p.centre_mm.forward} mm; size ${p.size_mm.across} x ${p.size_mm.long} x ${p.size_mm.tall} mm`);
      const message = [{ type: 'text', text: `${text || 'Here is a picture.'}\n\n[App: ${app.mode()} mode. Robot parts (id name, centre, size):${parts.length ? `\n${parts.join('\n')}` : ' none yet'}]` }];
      if (ai.picture?.fresh) { message.push({ type: 'image', data: ai.picture.data, mime_type: 'image/jpeg' }); ai.picture.fresh = false; }
      const held = ai.held;
      ai.held = [];
      return askAI([...held, ...message], text);
    }
    if (pending) { // an answer to the question: match it to one of the buttons
      const t = text.toLowerCase();
      const pick = /^(?:y|yes|yeah|yep|sure|ok|okay|do it|go ahead)\b/.test(t) ? pending[0]
        : /^(?:n|no|nope|cancel|stop|never ?mind)\b/.test(t) ? pending[pending.length - 1]
        : pending.find((o, i) => o.label.toLowerCase().includes(t) || t.includes(o.label.toLowerCase()) || t === String(i + 1));
      if (pick) { chat.querySelectorAll('.choices').forEach(r => r.remove()); pending = null; bubble(text, 'me'); try { await pick.run(); } catch (err) { say(`That didn't work: ${err.message}`); } return; }
      chat.querySelectorAll('.choices').forEach(r => r.remove());
      pending = null;
    }
    bubble(text, 'me');
    return offline(text);
  }
  // the offline assistant: set phrasings, one step at a time
  async function offline(text) {
    const pieces = text.split(/(?<=[.;!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
    if (pieces.length > 1) {
      const cmds = pieces.map(parse);
      if (cmds.every(c => c && c.do !== 'too-much')) {
        for (const c of cmds) { try { await run(c); } catch (err) { say(`That didn't work: ${err.message}`); } if (pending) return; } // stop at a question
        return;
      }
    }
    const cmd = parse(text);
    if (!cmd) { say('Sorry, I didn\'t get that. Here are things I understand:'); return suggest(); }
    try { await run(cmd); } catch (err) { say(`That didn't work: ${err.message}`); console.error(err); }
  }

  form.addEventListener('submit', e => { e.preventDefault(); const t = input.value; input.value = ''; send(t); });

  // ---- pictures and files: attach, drop or paste them ----
  const fileInput = root.querySelector('[data-file]');
  root.querySelector('[data-attach]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) takeFile(f); });
  root.addEventListener('dragover', e => { e.preventDefault(); root.classList.add('drop-target'); });
  root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop-target'); });
  root.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation(); // not also a drop on the panel underneath
    root.classList.remove('drop-target');
    const f = e.dataTransfer.files[0];
    if (f) takeFile(f);
  });
  input.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); takeFile(f); } });

  async function takeFile(file) {
    chat.querySelectorAll('.choices').forEach(r => r.remove());
    pending = null;
    if (file.type.startsWith('image/') && ai.on) { // Gemini looks at it with the next message
      const src = await shrink(file);
      bubble('', 'me').append(Object.assign(new Image(), { src, alt: file.name }));
      app.showReference(src);
      ai.picture = { file, data: src.split(',')[1], fresh: true };
      if (input.value.trim()) { const t = input.value; input.value = ''; return send(t); }
      return say('Got it, it\'s pinned in the corner of the view too. What should I do with it? (For example "build this robot", or "use it as the mat".)');
    }
    if (file.type.startsWith('image/')) {
      const src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
      bubble('', 'me').append(Object.assign(new Image(), { src, alt: file.name }));
      // shortcut: no image recognition offline; it asks what the picture is for instead of guessing
      return ask('I can\'t tell what\'s in a picture, but I can use it. What is it?', [
        { label: 'A robot to copy', run: () => { app.showReference(src); say('It\'s pinned in the corner of the view (click it to make it bigger). Tell me the parts you see, like "add a hub on top of 2 large motors", and I\'ll add them.'); } },
        { label: 'A mat for the arena', run: async () => {
          if (app.mode() !== 'test') await app.setMode('test');
          const rec = await app.upload(file);
          say(rec ? 'It\'s down as the mat, at FLL size (2362 mm wide). Change the width under Mat on the left if yours is different.' : 'I couldn\'t read that picture.');
        } },
      ]);
    }
    bubble(file.name, 'me');
    const rec = await app.upload(file);
    if (!rec) return say('I couldn\'t use that file. I can take LEGO models (.ldr, .mpd, .io), part files (.dat), 3D models (.stl, .obj, .glb) and pictures.');
    await app.useModel(rec);
    say(rec.kind === 'mesh' ? `${rec.name} is in the arena. Drag it where you want it.`
      : app.mode() === 'build' ? `${rec.name} is following your cursor: click in the view to put it down. It connects to pins and holes on its own.`
      : `${rec.name} is in the arena.`);
  }
  say(HELLO);
  suggest();
  return { send, focus: () => input.focus() };
}
