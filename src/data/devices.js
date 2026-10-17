// Sensors: what they measure and where their eye/button is (LDU, part frame). Every one faces the part's -Z.
// Ranges are from the LEGO spec sheets: SPIKE distance sensor 40–2000 mm, EV3 ultrasonic 30–2550 mm.
export const SENSORS = {
  '37308.dat': { type: 'color', name: 'Colour Sensor (SPIKE)', eye: [0, 0, -49] },
  '37316.dat': { type: 'distance', name: 'Distance Sensor (SPIKE)', eye: [0, 0, -60], minMm: 40, maxMm: 2000 },
  '37312.dat': { type: 'force', name: 'Force Sensor (SPIKE)', eye: [0, 0, -70], travelMm: 4 },
  '95650.dat': { type: 'color', name: 'EV3 Colour Sensor', eye: [0, -46.5, -70] },
  '95652.dat': { type: 'distance', name: 'EV3 Ultrasonic Sensor', eye: [0, -40, -71], minMm: 30, maxMm: 2550 },
  '95648.dat': { type: 'force', name: 'EV3 Touch Sensor', eye: [0, -40, -80], travelMm: 4 },
  '99380.dat': { type: 'gyro', name: 'EV3 Gyro Sensor', eye: [0, 0, 0] },
};

// The colours a LEGO colour sensor reports (SPIKE 3 color module numbers), with typical RGB as seen by the sensor.
export const SENSOR_COLOURS = [
  { id: 0, name: 'BLACK', rgb: [20, 20, 22] },
  { id: 1, name: 'MAGENTA', rgb: [200, 40, 140] },
  { id: 3, name: 'BLUE', rgb: [30, 70, 180] },
  { id: 4, name: 'AZURE', rgb: [60, 160, 220] },
  { id: 6, name: 'GREEN', rgb: [40, 150, 60] },
  { id: 7, name: 'YELLOW', rgb: [240, 210, 40] },
  { id: 9, name: 'RED', rgb: [200, 40, 40] },
  { id: 10, name: 'WHITE', rgb: [235, 235, 235] },
];
