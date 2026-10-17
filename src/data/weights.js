// Part weights in grams. Plain plastic parts don't need an entry: their mass comes from the
// part's solid volume × ABS density (checked against BrickLink weights in test/parts.test.mjs).
// Electronics are hollow and hold batteries/metal, so they use BrickLink catalogue weights
// (motors and sensors include their cable). You can also weigh your own part and type the grams
// into the properties panel; that override is saved in this browser and used everywhere.
export const ABS_DENSITY = 1.05; // g/cm³
// Technic pins and axles are moulded in POM (acetal), which is denser than ABS.
// Without this, axle 6L comes out 0.61 g against BrickLink's 0.86 g.
export const POM_DENSITY = 1.41;
const isPom = info => /^Technic (Axle|Pin)\b/.test(info.name || '');

const SPIKE_HUB = 63.12; // BrickLink 53444c01, no battery
const SPIKE_BATTERY = 86.7; // BrickLink 55422c01
const EV3_BRICK = 180; // BrickLink 95646c01, no batteries
const EV3_BATTERY = 131.3; // BrickLink 95656

export const WEIGHTS = {
  // SPIKE Prime / Robot Inventor hubs
  '45601.dat': [SPIKE_HUB, 'BrickLink 53444c01'],
  '67718.dat': [SPIKE_HUB, 'BrickLink 53444c01 (same body)'],
  '45610.dat': [SPIKE_BATTERY, 'BrickLink 55422c01'],
  '45601c01.dat': [SPIKE_HUB + SPIKE_BATTERY, 'BrickLink hub + battery'],
  '45601p01.dat': [SPIKE_HUB + SPIKE_BATTERY, 'BrickLink hub + battery'],
  '45601p02.dat': [SPIKE_HUB + SPIKE_BATTERY, 'BrickLink hub + battery'],
  '67718c01.dat': [SPIKE_HUB + SPIKE_BATTERY, 'BrickLink hub + battery'],
  // SPIKE / Inventor motors (with cable)
  '54675.dat': [70.98, 'BrickLink 54675c01'],
  '69730.dat': [70.8, 'BrickLink 54675c02'],
  'u9367c01.dat': [70.98, 'BrickLink 54675c01'],
  'u9367c02.dat': [70.8, 'BrickLink 54675c02'],
  'u9364c01.dat': [49.53, 'BrickLink 54696c01'],
  'u9364c02.dat': [49.53, 'BrickLink 54696c01'],
  '54675c01.dat': [70.98, 'BrickLink 54675c01'],
  '69730c01.dat': [70.8, 'BrickLink 54675c02'],
  '54696p01.dat': [49.53, 'BrickLink 54696c01'],
  '54696p02.dat': [49.53, 'BrickLink 54696c01'],
  '54696p01c01.dat': [49.53, 'BrickLink 54696c01'],
  '54696p02c01.dat': [49.53, 'BrickLink 54696c01'],
  '68488.dat': [23, 'BrickLink 68488c01'],
  // SPIKE sensors
  '37308.dat': [12.85, 'BrickLink 37308c01'],
  '37316.dat': [34.38, 'BrickLink 37316c01'],
  '37312.dat': [18.81, 'BrickLink 37312c01'],
  // EV3
  '95646.dat': [EV3_BRICK, 'BrickLink 95646c01 (no batteries)'],
  '95646c01.dat': [EV3_BRICK + EV3_BATTERY, 'BrickLink brick + rechargeable battery'],
  '95656.dat': [EV3_BATTERY, 'BrickLink 95656'],
  '95658.dat': [80.7, 'BrickLink 95658'],
  '99455.dat': [38.3, 'BrickLink 99455'],
  '95650.dat': [13.7, 'BrickLink 95650'],
  '95652.dat': [24, 'BrickLink 95652'],
  '95654.dat': [19.4, 'BrickLink 95654'],
  '99380.dat': [12.6, 'BrickLink 99380'],
  '95648.dat': [14.9, 'BrickLink 95648'],
  // NXT
  '53787.dat': [80.5, 'BrickLink 53787'],
  '53788.dat': [159.3, 'BrickLink 53788 (no batteries)'],
};

const OVERRIDE_KEY = 'studio.weightOverrides';
let overrides = {};
try { overrides = JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {}; } catch { /* no storage: tests, private mode */ }

export function setWeightOverride(file, grams) {
  if (grams > 0) overrides[file] = grams;
  else delete overrides[file];
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides)); } catch { /* kept for this session only */ }
}

// Where a part's weight comes from, for the properties panel.
export function weightSource(info) {
  if (overrides[info.file]) return 'your measurement';
  if (WEIGHTS[info.file]) return WEIGHTS[info.file][1];
  return `solid volume × ${isPom(info) ? 'POM' : 'ABS'} density`;
}

const warned = new Set();
export function massGrams(info) {
  if (overrides[info.file]) return overrides[info.file];
  if (WEIGHTS[info.file]) return WEIGHTS[info.file][0];
  if (info.cat === 'Electric' && !warned.has(info.file)) {
    warned.add(info.file);
    console.warn(`No real weight for ${info.file} (${info.name}); using plastic volume. Weigh it and set it in the properties panel.`);
  }
  const s = info.box.max.clone().sub(info.box.min);
  const boxMm3 = s.x * s.y * s.z * 0.064;
  let mm3 = info.volumeMm3;
  // shortcut: a part whose triangles don't close up gives a nonsense volume; fall back to 35% of its box (typical for Technic)
  if (!(mm3 > boxMm3 * 0.02 && mm3 < boxMm3)) mm3 = boxMm3 * 0.35;
  return (mm3 / 1000) * (isPom(info) ? POM_DENSITY : ABS_DENSITY);
}
