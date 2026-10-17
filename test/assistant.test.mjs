import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servePublic } from './serve.mjs';
import { initParts } from '../src/parts.js';
import { parse, kindOf } from '../src/assistant.js';

let srv;
before(async () => { srv = await servePublic(); await initParts(srv.base); });
after(() => srv.close());

test('"add 3 brains on top of 3 medium motors" means hubs on medium motors', () => {
  const c = parse('Add 3 brains on top of 3 medium motors');
  assert.equal(c.do, 'add');
  assert.deepEqual([c.what.count, c.what.words, c.rel, c.target.count, c.target.words], [3, 'brains', 'on', 3, 'medium motors']);
  assert.equal(kindOf(c.what.words).file, '45601c01.dat');
  assert.equal(kindOf(c.target.words).file, '54696p01.dat');
  assert.ok(kindOf(c.target.words).is('u9364c01.dat'), 'any medium motor in the robot counts');
});

test('it asks when a part is unclear', () => {
  assert.ok(kindOf('motor').ask, 'large or medium?');
  assert.ok(kindOf('sensor').ask, 'which sensor?');
  assert.match(kindOf('angle beams').ask[0], /angled beam/, 'an angle beam is not a straight beam');
  const beams = parse('add 2 beams');
  assert.equal(beams.what.count, 2);
  assert.ok(kindOf(beams.what.words).ask, 'how long?');
});

test('sizes, colours and plain part names', () => {
  const c = parse('add 2 red 15 beams next to the hub');
  assert.deepEqual([c.what.count, c.what.colour, c.rel, c.target.words], [2, '4', 'right', 'hub']);
  assert.equal(kindOf(c.what.words).file, '32278.dat');
  assert.equal(kindOf(parse('add a 15 beam').what.words).file, '32278.dat', '"a 15 beam" is one beam, 15 long');
  assert.equal(kindOf('3 axle').file, '4519.dat');
  assert.equal(kindOf('ev3 large motor').file, '95658.dat');
  assert.equal(kindOf('24 tooth gear').file, '3648b.dat');
  assert.equal(kindOf('8 gear').file, '10928.dat');
  assert.equal(parse('put a castor ball under the hub').rel, 'under');
});

test('other requests', () => {
  assert.deepEqual(parse('make the hub black'), { do: 'colour', target: { count: 1, explicit: false, plural: false, colour: null, words: 'hub' }, colour: '0' });
  assert.deepEqual(parse('drive forward 30 cm then turn right').steps, [{ type: 'move', dir: 'fwd', amount: 30, unit: 'cm' }, { type: 'turn', dir: 'right', deg: 90 }]);
  assert.deepEqual(parse('go back 100 mm').steps, [{ type: 'move', dir: 'back', amount: 10, unit: 'cm' }]);
  assert.equal(parse('turn it 180').quarter, 2);
  assert.equal(parse('turn the hub over').tip, true);
  assert.equal(parse('delete the wheels').target.plural, true);
  assert.equal(parse('can you add a box in front of the robot please').rel, 'front');
  assert.equal(parse('dark mode').theme, 'dark');
  assert.equal(parse('How heavy is it?').what, 'mass');
  assert.equal(parse('blorp the flurb'), null);
});

test('a long description is not guessed at: it offers the parts it mentions as steps', async () => {
  const { mentions } = await import('../src/assistant.js');
  const text = 'Make it such that there are two medium motors beside the brain on each side, with one tire on each motor, and the wire is all connected. It\'s basically a small bot. In front of it will be one small motor and one medium motor vertically there, in front of the brain. Around it will be two angle beams on each side to make something like a claw.';
  assert.equal(parse(text).do, 'too-much');
  const steps = mentions(text);
  for (const s of ['add 2 medium motors', 'add 1 wheel', 'add 2 angled beams']) assert.ok(steps.includes(s), `${s} in ${JSON.stringify(steps)}`);
  assert.equal(parse('make it such that there are two medium motors beside the brain on each side').do, 'too-much', 'never "hub on top of the hub"');
});
