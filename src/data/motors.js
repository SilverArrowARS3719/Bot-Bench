// Output-shaft motor specs: rpm = no-load speed, stallNcm = stall torque.
// Sources: LEGO Education SPIKE Prime technical sheets (measured at 7.2 V);
// LEGO 45502 / 45503 EV3 product sheets; NXT figures from LEGO's NXT motor data at 9 V.
const LARGE_ANGULAR = { name: 'Large Angular Motor (SPIKE / Inventor)', rpm: 175, stallNcm: 25 };
const MEDIUM_ANGULAR = { name: 'Medium Angular Motor (SPIKE / Inventor)', rpm: 185, stallNcm: 18 };
const EV3_LARGE = { name: 'EV3 Large Motor', rpm: 170, stallNcm: 40 };
const EV3_MEDIUM = { name: 'EV3 Medium Motor', rpm: 250, stallNcm: 12 };
const NXT = { name: 'NXT Motor', rpm: 170, stallNcm: 50 };

export const MOTORS = {
  '54675.dat': LARGE_ANGULAR,
  '69730.dat': LARGE_ANGULAR,
  'u9367c01.dat': LARGE_ANGULAR,
  'u9367c02.dat': LARGE_ANGULAR,
  '54675c01.dat': LARGE_ANGULAR, // with coiled cable
  '69730c01.dat': LARGE_ANGULAR,
  '54696p01.dat': MEDIUM_ANGULAR, // the SPIKE Medium Motor as sold
  '54696p02.dat': MEDIUM_ANGULAR,
  '54696p01c01.dat': MEDIUM_ANGULAR,
  '54696p02c01.dat': MEDIUM_ANGULAR,
  'u9364c01.dat': MEDIUM_ANGULAR,
  'u9364c02.dat': MEDIUM_ANGULAR,
  '95658.dat': EV3_LARGE,
  '99455.dat': EV3_MEDIUM,
  '53787.dat': NXT,
};

// Used when a model has wheels but no motor parts (e.g. a plain Technic chassis).
export const DEFAULT_MOTOR = LARGE_ANGULAR;

// shortcut: gearbox + rotor inertia isn't published; assume a 30 ms mechanical time constant
// (typical for small geared DC motors). Reflected inertia at the output = τ·stall / ω0.
export const TIME_CONSTANT_S = 0.03;

export const motorPhysics = m => {
  const w0 = (m.rpm * 2 * Math.PI) / 60; // rad/s
  const stall = m.stallNcm / 100; // N·m
  return { w0, stall, inertia: (TIME_CONSTANT_S * stall) / w0 };
};
