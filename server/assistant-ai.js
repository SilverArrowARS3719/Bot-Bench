// The smart assistant's server side: holds the Gemini API key (never sent to browsers), and passes each turn to
// Gemini with fixed instructions and a fixed set of actions. The actions themselves run in the browser, on the
// 3D model; this only relays. Used by the Vite dev server (vite.config.js) and the production server (server.mjs).
import { GoogleGenAI } from '@google/genai';

export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'; // on the Gemini API free tier (checked 2026-10)
const MAX_BODY = 12 * 1024 * 1024; // a photo or two
// Per visitor, so one person can't use up the free quota for everyone. Messages they type are counted apart from
// the assistant's own follow-up steps (one message can take several steps to carry out).
const LIMITS = { message: { minute: 12, day: 300 }, step: { minute: 90, day: 2500 } };

const SYSTEM = `You are the assistant inside Bot Bench, a web app where students build LEGO robots (SPIKE Prime, EV3, Technic) in 3D from real LEGO parts and test them in a simulated arena. You change the model only through the tools. Every size, weight and motor speed in the app is real.

How to work:
- Speed matters: every round trip makes the student wait many seconds. Plan the whole job first, then do it ALL in ONE reply: one build call with every step in order (later steps can refer to parts added by earlier steps by their name), plus done with the summary, in that same reply. Only take another round if a step reports an error. Each message already lists the robot's parts with ids, so you rarely need look_at_robot.
- When the student sends a picture of a robot, study it, list the parts you can see (hub, motors and their size, wheels, beams, sensors, how they sit), then build it part by part. If something important isn't visible or is ambiguous, ask with ask_user (give short options) instead of guessing.
- If you're not sure of a part's exact name, use find_parts. Prefer common SPIKE Prime / Technic parts.
- Positions are in millimetres from the robot's centre on the floor: right_mm is to the robot's right, up_mm is up, forward_mm is towards the robot's front. 1 stud = 8 mm. A SPIKE hub is 88 x 56 x 32 mm; a large motor about 48 x 32 x 40 mm; a medium motor about 40 x 32 x 24 mm.
- add_parts places parts on top of, under, next to, in front of or behind other parts (by id), or beside the robot. Then use move_parts and turn_parts to fine-tune. Parts don't need pins added; the student can drag to snap them.
- Keep messages short and in plain words (the users are school students). When you're making your last changes, call done in the same round with a one or two sentence summary of what you made and what to check, instead of waiting for another turn.
- Only help with this app: building, testing, driving, coding and understanding the robot. Politely decline anything else.`;

// The actions the model can use. The browser carries them out (src/assistant.js, aiTools).
const ids = { type: 'array', items: { type: 'integer' }, description: 'Part ids from look_at_robot or from earlier results' };
const TOOLS = [
  fn('build', 'Do a whole build in one go: steps run in order, instantly. Give added parts a name to use them as targets in later steps.', {
    steps: { type: 'array', items: { type: 'object', properties: {
      action: { type: 'string', enum: ['add', 'move', 'turn', 'colour', 'delete'] },
      name: { type: 'string', description: 'add: a name for the parts this step adds, e.g. "left motor"' },
      part: { type: 'string', description: 'add: same as add_parts.part' },
      count: { type: 'integer' }, colour: { type: 'string' },
      relation: { type: 'string', enum: ['on', 'under', 'left', 'right', 'front', 'behind'] },
      targets: { type: 'array', items: { type: 'string' }, description: 'Part ids (as text) or names from earlier steps. For add: what it goes on/next to. For move/turn/colour/delete: what to change.' },
      right_mm: { type: 'number' }, up_mm: { type: 'number' }, forward_mm: { type: 'number' },
      axis: { type: 'string', enum: ['vertical', 'tip'] }, quarter_turns: { type: 'integer' },
    }, required: ['action'] } },
  }, ['steps']),
  fn('look_at_robot', 'List every part in the robot with its id, name, part number, colour, centre position and size (mm).', {}),
  fn('find_parts', 'Search the LEGO parts library by name or part number. Returns up to 8 matches.', { query: { type: 'string' } }, ['query']),
  fn('add_parts', 'Add parts to the robot. Without a relation they go beside the robot on the floor.', {
    part: { type: 'string', description: 'These everyday names always work, no search needed: hub, EV3 brick, large motor, medium motor, colour sensor, distance sensor, force sensor, gyro sensor, wheel, castor ball, pin, long pin, "N beam" (N = 3..15), "N axle", "N tooth gear", "angled beam". For anything else, a part number from find_parts.' },
    count: { type: 'integer', description: 'How many (default 1)' },
    colour: { type: 'string', description: 'Optional colour name, e.g. black, white, light grey, red, blue, yellow' },
    relation: { type: 'string', enum: ['on', 'under', 'left', 'right', 'front', 'behind'], description: 'Where, relative to target_ids' },
    target_ids: ids,
  }, ['part']),
  fn('move_parts', 'Move parts by a distance in mm (robot directions).', { ids, right_mm: { type: 'number' }, up_mm: { type: 'number' }, forward_mm: { type: 'number' } }, ['ids']),
  fn('turn_parts', 'Turn parts in 90 degree steps: "vertical" turns about the up axis; "tip" tips them onto their side.', {
    ids, axis: { type: 'string', enum: ['vertical', 'tip'] }, quarter_turns: { type: 'integer' },
  }, ['ids', 'axis']),
  fn('colour_parts', 'Change the colour of parts.', { ids, colour: { type: 'string' } }, ['ids', 'colour']),
  fn('delete_parts', 'Remove parts.', { ids }, ['ids']),
  fn('undo', 'Undo the last change.', {}),
  fn('drive_robot', 'Drive the robot in the test arena as a SPIKE program.', {
    steps: { type: 'array', items: { type: 'object', properties: {
      action: { type: 'string', enum: ['forward', 'back', 'turn_left', 'turn_right', 'wait'] },
      amount: { type: 'number', description: 'cm for forward/back, degrees for turns, seconds for wait' },
    }, required: ['action', 'amount'] } },
  }, ['steps']),
  fn('add_obstacle', 'Add an obstacle to the test arena.', { type: { type: 'string', enum: ['box', 'wall', 'ramp', 'can'] }, count: { type: 'integer' }, in_front_of_robot: { type: 'boolean' } }, ['type']),
  fn('use_picture_as_mat', 'Use the picture the student sent as the arena mat.', {}),
  fn('set_mode', 'Switch between building and testing.', { mode: { type: 'string', enum: ['build', 'test'] } }, ['mode']),
  fn('done', 'Call this in the same round as your final actions, with a one or two sentence summary for the student. It saves a round trip.', { summary: { type: 'string' } }, ['summary']),
  fn('ask_user', 'Ask the student a question and wait for the answer. Give 2-4 short options when you can.', {
    question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } },
  }, ['question']),
];
function fn(name, description, properties, required = []) {
  return { type: 'function', name, description, parameters: { type: 'object', properties, required } };
}

// What a browser may send: its own text, pictures, and the results of actions. Nothing else gets through.
function cleanInput(input) {
  if (!Array.isArray(input) || !input.length || input.length > 40) throw new Error('bad input');
  return input.map(step => {
    if (step.type === 'text' && typeof step.text === 'string') return { type: 'text', text: step.text.slice(0, 8000) };
    if (step.type === 'image' && typeof step.data === 'string' && /^image\/(png|jpeg|webp|heic|heif)$/.test(step.mime_type)) return { type: 'image', data: step.data, mime_type: step.mime_type };
    if (step.type === 'function_result' && typeof step.call_id === 'string' && TOOLS.some(t => t.name === step.name)) {
      return { type: 'function_result', name: step.name, call_id: step.call_id, result: [{ type: 'text', text: String(step.result ?? '').slice(0, 20000) }] };
    }
    throw new Error('bad input');
  });
}

export function createAiHandler({ apiKey, client = apiKey ? new GoogleGenAI({ apiKey }) : null } = {}) {
  const seen = new Map(); // "kind:visitor" -> recent request times
  const limited = (kind, who) => {
    const key = `${kind}:${who}`, now = Date.now(), times = (seen.get(key) || []).filter(t => now - t < 86400e3);
    times.push(now);
    seen.set(key, times);
    return times.filter(t => now - t < 60e3).length > LIMITS[kind].minute || times.length > LIMITS[kind].day;
  };
  const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };

  return async function handle(req, res, next) {
    const url = req.url.split('?')[0];
    if (url === '/api/assistant/status') return send(res, 200, { ai: !!client, model: client ? MODEL : null });
    if (url !== '/api/assistant') return next ? next() : send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    if (!client) return send(res, 503, { error: 'no-key' });
    const who = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'local';
    let body = '';
    try {
      for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) throw new Error('too big'); }
      body = JSON.parse(body);
    } catch { return send(res, 413, { error: 'too-big' }); }
    let input;
    try { input = cleanInput(body.input); } catch { return send(res, 400, { error: 'bad-input' }); }
    const fromStudent = input.some(step => step.type !== 'function_result');
    if (limited('step', who) || (fromStudent && limited('message', who))) return send(res, 429, { error: 'slow-down' });
    try {
      const interaction = await client.interactions.create({
        model: MODEL,
        system_instruction: SYSTEM,
        tools: TOOLS,
        input,
        // plan a new message (or read a photo) carefully; carrying out the plan's steps needs less thought, and is faster
        generation_config: { thinking_level: fromStudent ? 'medium' : 'low' },
        ...(typeof body.interactionId === 'string' && { previous_interaction_id: body.interactionId }),
      }, { retries: { strategy: 'none' } }); // no silent minutes of waiting: when Google is busy the student is told, and the browser retries
      const calls = (interaction.steps || []).filter(s => s.type === 'function_call').map(s => ({ id: s.id, name: s.name, args: s.arguments || {} }));
      return send(res, 200, { id: interaction.id, calls, text: calls.length ? '' : interaction.output_text || '' });
    } catch (err) {
      const status = err?.status || err?.code;
      console.error('[assistant]', status, err?.message);
      // busy (429) or overloaded (503): the browser counts down and tries again, rather than giving up
      return send(res, status === 429 || status === 503 ? 429 : 502, { error: status === 429 || status === 503 ? 'quota' : 'ai-failed' });
    }
  };
}
