// Static tuning for NEON PALMS: world geometry, the six districts of Sunfall City, vehicle
// types, the player, the camera and the shared colour palette. Everything the other modules
// need to agree on lives here; nothing in this file changes at runtime.

/** Fixed simulation step, in seconds: the world always advances in 1/60 s slices. */
export const STEP = 1 / 60;

/** localStorage key the save system (a later session) writes the game state under. */
export const SAVE_KEY = 'neon-palms-save-v1';

/**
 * The street grid. Blocks sit between roads: `cols` x `rows` blocks, each block pitch
 * `pitchX` x `pitchY` apart, with roads `roadW` wide centred on the grid lines. Lane
 * centres sit `laneOff` either side of a road's centre line.
 */
export const GRID = { cols: 9, rows: 7, pitchX: 460, pitchY: 420, roadW: 108, laneOff: 27 };

/** Width of the built-up city in world units (roads and blocks together). */
export const CITY_W = GRID.cols * GRID.pitchX + GRID.roadW;
/** Height of the built-up city; the beach and the sea continue south of it. */
export const CITY_H = GRID.rows * GRID.pitchY + GRID.roadW;
/** Depth of the sand band between the last street and the water. */
export const SAND_H = 170;
/** Depth of the sea band at the south edge of the world. */
export const SEA_H = 260;

/** The whole world rectangle, city plus beach plus sea. */
export const WORLD = { width: CITY_W, height: CITY_H + SAND_H + SEA_H };

/** Sun direction: shadows and pseudo-height wall faces are cast this way, scaled by height. */
export const SUN = { x: 15, y: 19 };

/** Typeface stack for every canvas label, sign and overlay. */
export const FONT = '"Segoe UI", system-ui, -apple-system, Arial, sans-serif';

/** Shared colours that are not owned by one district. */
export const COLORS = {
  waterDeep: '#22779f',
  waterShallow: '#4fb0c4',
  waterFoam: 'rgba(255,255,255,0.5)',
  sand: '#eed49c',
  sandDark: '#e0c184',
  promenade: '#d9c49a',
  asphalt: '#494c54',
  asphaltEdge: '#d8d2c2',
  lanePaint: '#f3e5bb',
  crosswalk: 'rgba(240,238,230,0.55)',
  grass: '#7cb45c',
  grassDark: '#679c4c',
  pierWood: '#9a7648',
  pierWoodDark: '#7d5c36',
  backdrop: '#0d1520',
};

/**
 * The six districts. `ground` fills a block inside its sidewalk rim, `sidewalk` is the rim
 * itself, `roofs` is the palette building roofs are picked from. `labelAt` is the block
 * the district's name is lettered across on the ground.
 */
export const DISTRICTS = {
  downtown: {
    name: 'DOWNTOWN',
    ground: '#a49c8f',
    sidewalk: '#c6bba6',
    roofs: ['#7f9fb5', '#93a8b8', '#6d8ca3', '#a8b6bd', '#87999b', '#b59d78'],
    labelAt: { col: 4, row: 2 },
  },
  hillside: {
    name: 'HILLSIDE HEIGHTS',
    ground: '#86b364',
    sidewalk: '#c2b498',
    roofs: ['#c96f4a', '#d9a05b', '#b8574a', '#e0b184', '#a8643f', '#cf8854'],
    labelAt: { col: 1, row: 0 },
  },
  oldmarket: {
    name: 'OLD MARKET',
    ground: '#b3a58c',
    sidewalk: '#cbbc9e',
    roofs: ['#d98e4a', '#c95f43', '#e3b34e', '#b84e5e', '#7fa653', '#d4743b'],
    labelAt: { col: 1, row: 3 },
  },
  portside: {
    name: 'PORTSIDE',
    ground: '#9b968b',
    sidewalk: '#bcb2a0',
    roofs: ['#8d99a4', '#a39a89', '#7c8b96', '#b0a58e', '#94908a', '#6f8291'],
    labelAt: { col: 7, row: 1 },
  },
  palmbeach: {
    name: 'PALM BEACH',
    ground: '#c2b294',
    sidewalk: '#d6c6a2',
    roofs: ['#f0e3c8', '#eec9a8', '#f5d9d0', '#dcebd8', '#f2dfae', '#e8c8b8'],
    labelAt: { col: 2, row: 5 },
  },
  marina: {
    name: 'MARINA',
    ground: '#a8a58e',
    sidewalk: '#c9bda2',
    roofs: ['#5f8f8a', '#7ba7a0', '#48767d', '#94b8ad', '#6b9089'],
    labelAt: { col: 6, row: 5 },
  },
};

/** Fixed landmark buildings, keyed by "col,row" of their block: sign name and POI kind. */
export const LANDMARKS = {
  '4,1': { name: 'SUNFALL GRAND HOTEL', kind: 'hotel' },
  '3,0': { name: 'MERIDIAN TOWER', kind: 'office' },
  '1,6': { name: 'PALM COURT', kind: 'home' },
  '2,6': { name: 'CORAL REEF RESORT', kind: 'hotel' },
  '7,1': { name: 'DOCKSIDE WAREHOUSE', kind: 'warehouse' },
  '5,3': { name: 'SUNFALL GENERAL HOSPITAL', kind: 'hospital' },
  '6,3': { name: 'HARBOR PRECINCT', kind: 'police' },
  '2,3': { name: 'RIVERA AUTO WORKS', kind: 'garage' },
  '6,5': { name: 'THE SALTY PALM DINER', kind: 'diner' },
  '0,4': { name: 'MERCADO CENTRAL', kind: 'market' },
};

/** Shop sign names handed out to ordinary buildings, per district. */
export const SHOP_NAMES = {
  oldmarket: [
    'FLORERIA LUZ', 'PANADERIA SOL', 'TALLER RIVERA', 'JOYERIA MAR', 'CAFE CANELA',
    'PESCADERIA AZUL', 'LIBROS DEL PUERTO', 'SANDALO SHOES', 'FARMACIA VIDA', 'DULCE COCO',
  ],
  downtown: [
    'MERIDIAN BANK', 'SOLSTICE GALLERY', 'HOTEL MIRAMAR', 'NEON NOODLE BAR', 'VISTA RECORDS',
    'PALM & CO. LAW', 'AZURE FITNESS', 'THE DAILY SUNFALL', 'ORO JEWELLERS', 'SKYLINE COFFEE',
  ],
  palmbeach: [
    'COCO LOCO BEACH BAR', 'SUNFALL SURF SHOP', 'HELADERIA BRISA', 'PALM COURT SPA',
    'BOARDWALK BIKES', 'THE GOLDEN CONCH', 'BRISA BOUTIQUE', 'TIKI TORCH GRILL',
  ],
  marina: [
    'HARBOUR TACKLE', 'SUNFALL BOAT RENTALS', 'NET & ANCHOR', 'MARINA DELI',
    'TIDE TABLES', 'CAPTAIN SOL CHARTERS',
  ],
  portside: [
    'SUNFALL FREIGHT CO.', 'CRATE & BARREL MOVERS', 'PORTSIDE COLD STORAGE',
    'HARBOR MACHINE SHOP', 'BALLAST BROS. SHIPPING',
  ],
  hillside: [
    'HILLSIDE MARKET', 'VISTA VERDE NURSERY', 'THE LOOKOUT CAFE',
  ],
};

/**
 * Vehicle types. Lengths and widths are world units; `topSpeed` and `accel` are units per
 * second (and per second squared); `grip` is how fast sideways slide bleeds off per second;
 * `turn` is the steering rate at full lock. `colors` is the paint palette for the type.
 */
export const VEHICLE_TYPES = [
  { id: 'coupe', name: 'Solstice Coupe', length: 48, width: 24, topSpeed: 355, accel: 305, grip: 9.5, turn: 3.1, colors: ['#12b5a5', '#ff6b4a', '#ffc93c', '#e8e4da', '#3f7fbf', '#8e6cc8', '#e04f7a'] },
  { id: 'sedan', name: 'Harbor Sedan', length: 54, width: 25, topSpeed: 305, accel: 240, grip: 9, turn: 2.7, colors: ['#c8ccd2', '#5b6b7c', '#8c2f39', '#2e4053', '#d9d4c5', '#7a4a2b', '#4a6741'] },
  { id: 'taxi', name: 'SunCab Taxi', length: 52, width: 25, topSpeed: 295, accel: 235, grip: 9, turn: 2.7, colors: ['#ffb81c'] },
  { id: 'hatch', name: 'Brisa Hatch', length: 42, width: 23, topSpeed: 275, accel: 225, grip: 9.5, turn: 3.2, colors: ['#7ec850', '#ff8fab', '#64b6e8', '#f2f0e6', '#ffa94d', '#c0c6ce', '#5e548e'] },
  { id: 'pickup', name: 'Dune Runner Pickup', length: 56, width: 27, topSpeed: 285, accel: 230, grip: 8, turn: 2.5, colors: ['#b8574a', '#707a68', '#3e5c50', '#c8b28a', '#2f6db3', '#946b3a'] },
  { id: 'van', name: 'Portside Van', length: 58, width: 28, topSpeed: 250, accel: 195, grip: 8, turn: 2.3, colors: ['#e8e6df', '#9db4c0', '#d9a441', '#77878f', '#7fb069', '#b56576'] },
  { id: 'cruiser', name: 'Harbor PD Cruiser', length: 56, width: 26, topSpeed: 338, accel: 275, grip: 9, turn: 2.9, colors: ['#eef1f4'] },
];

/** Look a vehicle type up by id; falls back to the first type. */
export function vehicleType(id) {
  for (const type of VEHICLE_TYPES) if (type.id === id) return type;
  return VEHICLE_TYPES[0];
}

/** The player character on foot: size, speeds, and the colours of the drawn figure. */
export const PLAYER = {
  radius: 11,
  walkSpeed: 158,
  runSpeed: 268,
  turnRate: 14,
  jacket: '#0f766e',
  skin: '#e8b08a',
  hair: '#2b2118',
  pants: '#31435c',
};

/** Ambient city life: how many AI-driven cars and pedestrians are kept around the player. */
export const AMBIENT = { trafficCars: 20, pedestrians: 34 };

/** Shared car-handling numbers not tied to one vehicle type. */
export const CAR_TUNING = {
  brake: 430,
  reverseTopSpeed: 118,
  reverseAccel: 170,
  drag: 0.55,
  handbrakeGripScale: 0.22,
  handbrakeDrag: 1.4,
  enterRange: 56,
  exitSpeed: 26,
};

/** Camera behaviour: follow stiffness, speed lookahead time and its cap in world units. */
export const CAMERA = {
  follow: 5.2,
  lookAheadTime: 0.38,
  lookAheadMax: 132,
  titleZoom: 1,
};
