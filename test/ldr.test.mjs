import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLdr, serializeLdr } from '../src/ldr.js';

test('save -> open round trip keeps parts, positions and colours', () => {
  const parts = [
    { file: '32278.dat', color: '0', m: [10, -20, 30, 0, 0, 1, 0, 1, 0, -1, 0, 0] },
    { file: '54675.dat', color: '15', m: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
    { file: '6558.dat', color: '0x2FF8800', m: [1.25, 2.5, -3.75, 1, 0, 0, 0, -1, 0, 0, 0, -1] },
  ];
  assert.deepEqual(parseLdr(serializeLdr(parts)), parts);
});

test('MPD submodels are flattened with their transforms and inherited colour', () => {
  const mpd = [
    '0 FILE main.ldr',
    '1 4 100 0 0 1 0 0 0 1 0 0 0 1 Wheel Assy.ldr',
    '1 72 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
    '0 NOFILE',
    '0 FILE wheel assy.ldr',
    '1 16 0 0 20 0 0 1 0 1 0 -1 0 0 32278.DAT',
    '0 NOFILE',
  ].join('\r\n');
  assert.deepEqual(parseLdr(mpd), [
    { file: '32278.dat', color: '4', m: [100, 0, 20, 0, 0, 1, 0, 1, 0, -1, 0, 0] },
    { file: '3001.dat', color: '72', m: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
  ]);
});

test('submodel loop throws instead of hanging', () => {
  assert.throws(() => parseLdr('0 FILE a.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 a.ldr\n'), /loop/);
});
