// Sunfall City itself: the procedural generation of the street grid, the six districts,
// their buildings, beaches, palms and docks, plus every query the rest of the game asks of
// the city (collision, water, roads, districts, points of interest). Generation is driven
// entirely by the seeded generator passed in, so a seed always builds the same city.
// No drawing and no browser live here; render.js paints what this module describes.
import {
  CITY_H, CITY_W, DISTRICTS, GRID, LANDMARKS, SAND_H, SEA_H, SHOP_NAMES, VEHICLE_TYPES, WORLD,
} from './config.js';

/** Blocks given over to green space instead of buildings, keyed by "col,row". */
const PARKS = { '4,3': 'PALMS CENTRAL PARK', '0,1': 'HILLSIDE GREEN' };

/** Which district owns a block. The east column's southern blocks are marina docks. */
function districtFor(col, row) {
  if (col === 8 && row >= 4) return 'marina';
  if (row <= 1 && col <= 2) return 'hillside';
  if (row <= 2 && col >= 6) return 'portside';
  if (row <= 2 && col >= 3) return 'downtown';
  if (row <= 4 && col <= 2) return 'oldmarket';
  if (row >= 5 && col <= 4) return 'palmbeach';
  if (row >= 4 && col >= 5) return 'marina';
  if (row === 3 && col >= 6) return 'portside';
  return 'downtown';
}

/** True for the marina's water blocks: piers and boats instead of buildings. */
function isDocks(col, row) {
  return col === 8 && row >= 4;
}

export function createWorld(random) {
  const { cols, rows, pitchX, pitchY, roadW, laneOff } = GRID;

  // Road centre lines: one more road than blocks in each direction, framing the grid.
  const vRoads = [];
  for (let i = 0; i <= cols; i += 1) vRoads.push({ x: roadW / 2 + i * pitchX, from: 0, to: CITY_H });
  const hRoads = [];
  for (let j = 0; j <= rows; j += 1) hRoads.push({ y: roadW / 2 + j * pitchY, from: 0, to: CITY_W });
  const intersections = [];
  for (const v of vRoads) for (const h of hRoads) intersections.push({ x: v.x, y: h.y });

  const blockW = pitchX - roadW;
  const blockH = pitchY - roadW;
  const blockX = (col) => roadW + col * pitchX;
  const blockY = (row) => roadW + row * pitchY;

  const buildings = [];
  const blocks = [];
  const pois = [];
  const shopCursor = {};
  function shopName(districtId) {
    const pool = SHOP_NAMES[districtId];
    if (!pool || pool.length === 0) return null;
    const index = shopCursor[districtId] ?? random.int(0, pool.length - 1);
    shopCursor[districtId] = (index + 1) % pool.length;
    return pool[index];
  }

  function addBuilding(block, x, y, w, h, levels, name) {
    const district = DISTRICTS[block.district];
    const building = {
      x, y, w, h, levels,
      name: name ?? null,
      landmark: false,
      district: block.district,
      roof: random.pick(district.roofs),
      seed: random.int(0, 100000),
      block,
    };
    block.buildings.push(building);
    buildings.push(building);
    return building;
  }

  // One builder per district character: towers downtown, warehouses at the port, a warren
  // of small shops in the old market, houses on the hillside, hotels on the beach, sheds
  // at the marina. Every block keeps a clear margin inside its sidewalk rim.
  const builders = {
    downtown(block) {
      const ux = block.x + 20; const uy = block.y + 20;
      const uw = block.w - 40; const uh = block.h - 40;
      if (random.chance(0.45)) {
        const w = uw * 0.44; const gap = uw * 0.12;
        addBuilding(block, ux, uy + random.range(0, uh * 0.18), w, uh * random.range(0.66, 0.84), random.int(4, 8), random.chance(0.5) ? shopName('downtown') : null);
        addBuilding(block, ux + w + gap, uy + random.range(0, uh * 0.18), w, uh * random.range(0.66, 0.84), random.int(4, 8), random.chance(0.5) ? shopName('downtown') : null);
      } else {
        const w = random.range(180, 252); const h = random.range(178, 238);
        addBuilding(block, ux + (uw - w) / 2 + random.range(-14, 14), uy + (uh - h) / 2, w, h, random.int(5, 9), random.chance(0.55) ? shopName('downtown') : null);
      }
    },
    portside(block) {
      const ux = block.x + 20; const uy = block.y + 20;
      const uw = block.w - 40; const uh = block.h - 40;
      if (random.chance(0.5)) {
        const h = random.range(96, 124);
        addBuilding(block, ux + random.range(0, 18), uy, random.range(248, 298), h, random.int(2, 3), random.chance(0.6) ? shopName('portside') : null);
        addBuilding(block, ux + random.range(0, 18), uy + h + 20, random.range(248, 298), h, random.int(2, 3), random.chance(0.6) ? shopName('portside') : null);
      } else {
        addBuilding(block, ux + (uw - 292) / 2, uy + (uh - 158) / 2, 292, 158, random.int(2, 3), random.chance(0.6) ? shopName('portside') : null);
      }
    },
    oldmarket(block) {
      const cellW = (block.w - 32) / 3; const cellH = (block.h - 32) / 2;
      for (let cx = 0; cx < 3; cx += 1) {
        for (let cy = 0; cy < 2; cy += 1) {
          const w = cellW * random.range(0.78, 0.92);
          const h = cellH * random.range(0.7, 0.86);
          const x = block.x + 16 + cx * cellW + (cellW - w) / 2 + random.range(-3, 3);
          const y = block.y + 16 + cy * cellH + (cellH - h) / 2 + random.range(-3, 3);
          addBuilding(block, x, y, w, h, random.int(1, 3), shopName('oldmarket'));
        }
      }
    },
    hillside(block) {
      const count = random.int(3, 4);
      for (let n = 0; n < count; n += 1) {
        for (let attempt = 0; attempt < 14; attempt += 1) {
          const w = random.range(78, 112); const h = random.range(72, 100);
          const x = block.x + random.range(22, block.w - 22 - w);
          const y = block.y + random.range(22, block.h - 22 - h);
          const clear = block.buildings.every((b) => x > b.x + b.w + 16 || x + w + 16 < b.x || y > b.y + b.h + 16 || y + h + 16 < b.y);
          if (clear) {
            addBuilding(block, x, y, w, h, random.int(1, 2), random.chance(0.16) ? shopName('hillside') : null);
            break;
          }
        }
      }
    },
    palmbeach(block) {
      const hotel = addBuilding(block, block.x + random.range(30, 52), block.y + 22, random.range(222, 268), random.range(96, 122), random.int(3, 5), random.chance(0.6) ? shopName('palmbeach') : null);
      addBuilding(block, block.x + random.range(24, 90), block.y + block.h - random.range(96, 116), random.range(132, 182), random.range(68, 90), random.int(2, 3), random.chance(0.4) ? shopName('palmbeach') : null);
      // A pool in the hotel grounds: a prop the renderer paints, not a building.
      block.pool = { x: hotel.x + hotel.w + 14, y: hotel.y + 12, w: 76, h: 44 };
      if (block.pool.x + block.pool.w > block.x + block.w - 12) block.pool = null;
    },
    marina(block) {
      let x = block.x + 22;
      const count = random.int(2, 3);
      for (let n = 0; n < count && x < block.x + block.w - 110; n += 1) {
        const w = random.range(118, 168); const h = random.range(66, 96);
        const y = block.y + random.range(24, block.h - 24 - h);
        addBuilding(block, x, y, w, h, random.int(1, 2), n === 0 ? shopName('marina') : null);
        x += w + random.range(16, 30);
      }
    },
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key = `${col},${row}`;
      const districtId = districtFor(col, row);
      const block = {
        col, row,
        x: blockX(col), y: blockY(row), w: blockW, h: blockH,
        district: districtId,
        kind: 'built',
        buildings: [],
        pool: null,
        park: null,
        docks: null,
      };
      if (isDocks(col, row)) {
        block.kind = 'docks';
        const piers = [];
        for (let p = 0; p < 3; p += 1) {
          piers.push({ x: block.x, y: block.y + 34 + p * 96, w: block.w * 0.68, h: 15 });
        }
        const boats = piers.map((pier) => ({
          x: pier.x + pier.w + 20,
          y: pier.y + pier.h / 2,
          angle: random.range(-0.16, 0.16),
          color: random.pick(['#e8e4da', '#c95f43', '#3f7fbf', '#f2c94c']),
        }));
        block.docks = { piers, boats };
      } else if (PARKS[key]) {
        block.kind = 'park';
        block.park = {
          name: PARKS[key],
          pond: key === '4,3' ? { x: block.x + block.w / 2, y: block.y + block.h / 2, rx: 92, ry: 54 } : null,
        };
        pois.push({ id: `park-${key}`, kind: 'park', name: PARKS[key], x: block.x + block.w / 2, y: block.y + block.h + 22 });
      } else {
        builders[districtId](block);
        const landmark = LANDMARKS[key];
        if (landmark && block.buildings.length > 0) {
          const first = block.buildings[0];
          first.name = landmark.name;
          first.landmark = true;
          pois.push({ id: `${landmark.kind}-${key}`, kind: landmark.kind, name: landmark.name, x: first.x + first.w / 2, y: first.y + first.h + 22 });
        }
      }
      blocks.push(block);
    }
  }

  // --- Greenery and street furniture -------------------------------------------------
  const palms = [];
  function addPalm(x, y) {
    palms.push({ x, y, s: random.range(0.85, 1.28), lean: random.range(-6, 6), phase: random.range(0, Math.PI * 2) });
  }
  // A shady row along the beach, just south of the promenade.
  for (let x = 70; x < WORLD.width - 50; x += random.range(82, 132)) addPalm(x, CITY_H + random.range(52, 84));
  // Palms in the parks, kept out of the central park's pond.
  for (const block of blocks) {
    if (block.kind !== 'park') continue;
    for (let n = 0; n < 11; n += 1) {
      const x = block.x + random.range(18, block.w - 18);
      const y = block.y + random.range(18, block.h - 18);
      if (block.park.pond) {
        const dx = (x - block.park.pond.x) / (block.park.pond.rx + 22);
        const dy = (y - block.park.pond.y) / (block.park.pond.ry + 22);
        if (dx * dx + dy * dy < 1) continue;
      }
      addPalm(x, y);
    }
  }
  // A palm or two on the sidewalk corners of most built blocks.
  for (const block of blocks) {
    if (block.kind !== 'built' || !random.chance(0.6)) continue;
    const spots = random.int(1, 3);
    for (let n = 0; n < spots; n += 1) {
      const corner = random.int(0, 3);
      const x = block.x + (corner % 2 === 0 ? 9 : block.w - 9) + random.range(-3, 3);
      const y = block.y + (corner < 2 ? 9 : block.h - 9) + random.range(-3, 3);
      addPalm(x, y);
    }
  }

  const lamps = [];
  for (const road of vRoads) {
    for (let y = 120; y < CITY_H - 60; y += 214) {
      lamps.push({ x: road.x + ((Math.round(y / 214) % 2 === 0) ? -1 : 1) * (roadW / 2 - 7), y });
    }
  }
  for (const road of hRoads) {
    for (let x = 150; x < CITY_W - 60; x += 236) {
      lamps.push({ x, y: road.y + ((Math.round(x / 236) % 2 === 0) ? 1 : -1) * (roadW / 2 - 7) });
    }
  }

  // --- Spawns -------------------------------------------------------------------------
  // Home is Palm Court, the beachfront block at column 1, row 6: the player starts on the
  // promenade below it, and the player's teal coupe waits on Ocean Drive just east.
  const palmCourt = blocks[6 * cols + 1];
  const playerSpawn = { x: palmCourt.x + palmCourt.w / 2, y: CITY_H + 20, angle: -Math.PI / 2 };
  const carSpawn = { x: playerSpawn.x + 150, y: hRoads[rows].y + laneOff, angle: 0 };

  // --- Parked cars ----------------------------------------------------------------------
  // Kerbside parking along the avenues and streets, kept clear of the spawn corner. These
  // are plain specs; player.js turns them into drivable cars.
  const parkedCars = [];
  for (let n = 0; n < 46; n += 1) {
    const type = random.pick(VEHICLE_TYPES);
    const color = random.pick(type.colors);
    if (random.chance(0.5)) {
      const road = random.pick(vRoads);
      const seg = random.int(0, rows - 1);
      const side = random.sign();
      const x = road.x + side * (roadW / 2 - 16);
      const y = random.range(hRoads[seg].y + roadW / 2 + 56, hRoads[seg + 1].y - roadW / 2 - 56);
      if (Math.hypot(x - carSpawn.x, y - carSpawn.y) < 120) continue;
      parkedCars.push({ typeId: type.id, color, x, y, angle: random.chance(0.5) ? Math.PI / 2 : -Math.PI / 2 });
    } else {
      const road = random.pick(hRoads);
      const seg = random.int(0, cols - 1);
      const side = random.sign();
      const x = random.range(vRoads[seg].x + roadW / 2 + 56, vRoads[seg + 1].x - roadW / 2 - 56);
      const y = road.y + side * (roadW / 2 - 16);
      if (Math.hypot(x - carSpawn.x, y - carSpawn.y) < 120) continue;
      parkedCars.push({ typeId: type.id, color, x, y, angle: random.chance(0.5) ? 0 : Math.PI });
    }
  }

  // --- Lane network for traffic (built now, driven by a later session) -------------------
  // Right-hand traffic: northbound runs up the east side of an avenue, eastbound along the
  // south side of a street. Each lane is a straight segment between two intersections.
  const lanes = [];
  for (let i = 0; i < vRoads.length; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      lanes.push({ x1: vRoads[i].x + laneOff, y1: hRoads[j + 1].y, x2: vRoads[i].x + laneOff, y2: hRoads[j].y, dirX: 0, dirY: -1, axis: 'v', road: i, segment: j });
      lanes.push({ x1: vRoads[i].x - laneOff, y1: hRoads[j].y, x2: vRoads[i].x - laneOff, y2: hRoads[j + 1].y, dirX: 0, dirY: 1, axis: 'v', road: i, segment: j });
    }
  }
  for (let j = 0; j < hRoads.length; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      lanes.push({ x1: vRoads[i].x, y1: hRoads[j].y + laneOff, x2: vRoads[i + 1].x, y2: hRoads[j].y + laneOff, dirX: 1, dirY: 0, axis: 'h', road: j, segment: i });
      lanes.push({ x1: vRoads[i + 1].x, y1: hRoads[j].y - laneOff, x2: vRoads[i].x, y2: hRoads[j].y - laneOff, dirX: -1, dirY: 0, axis: 'h', road: j, segment: i });
    }
  }

  // --- Water, sand and the bay -----------------------------------------------------------
  const bayX = blockX(8);
  const bayY = blockY(4);
  const bayRect = { x: bayX, y: bayY, w: blockW, h: CITY_H - bayY };
  const waterRects = [
    { x: 0, y: CITY_H + SAND_H, w: WORLD.width, h: SEA_H },
    bayRect,
  ];
  const sandRect = { x: 0, y: CITY_H, w: WORLD.width, h: SAND_H };
  pois.push({ id: 'docks', kind: 'docks', name: 'SUNFALL DOCKS', x: bayX + 40, y: bayY + 120 });
  pois.push({ id: 'boardwalk', kind: 'boardwalk', name: 'PALM BEACH BOARDWALK', x: WORLD.width * 0.3, y: CITY_H + 20 });

  // District name labels, centred on each district's label block.
  const districtRegions = Object.entries(DISTRICTS).map(([id, district]) => ({
    id,
    name: district.name,
    x: blockX(district.labelAt.col) + blockW / 2,
    y: blockY(district.labelAt.row) + blockH / 2,
  }));

  // --- Queries ----------------------------------------------------------------------------
  function isWater(x, y) {
    for (const rect of waterRects) {
      if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return true;
    }
    return false;
  }

  function buildingAt(x, y, pad = 0) {
    for (const b of buildings) {
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return b;
    }
    return null;
  }

  /** Solid ground test: the world edge, water and buildings block; sand and roads do not. */
  function pointBlocked(x, y, pad = 0) {
    if (x < pad || y < pad || x > WORLD.width - pad || y > WORLD.height - pad) return true;
    if (isWater(x, y)) return true;
    return buildingAt(x, y, pad) !== null;
  }

  /** A circle is blocked when its centre or any of eight rim points is. */
  function circleBlocked(x, y, r) {
    if (pointBlocked(x, y, 0)) return true;
    const d = r * 0.72;
    return (
      pointBlocked(x + d, y + d, 0) || pointBlocked(x - d, y + d, 0) ||
      pointBlocked(x + d, y - d, 0) || pointBlocked(x - d, y - d, 0) ||
      pointBlocked(x + r, y, 0) || pointBlocked(x - r, y, 0) ||
      pointBlocked(x, y + r, 0) || pointBlocked(x, y - r, 0)
    );
  }

  function isOnRoad(x, y) {
    if (y >= CITY_H || y < 0 || x < 0 || x > CITY_W) return false;
    for (const road of vRoads) if (Math.abs(x - road.x) <= roadW / 2) return true;
    for (const road of hRoads) if (Math.abs(y - road.y) <= roadW / 2) return true;
    return false;
  }

  function blockAt(x, y) {
    if (x < 0 || y < 0 || x >= CITY_W || y >= CITY_H) return null;
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x - roadW) / pitchX)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((y - roadW) / pitchY)));
    return blocks[row * cols + col];
  }

  function districtAt(x, y) {
    if (y >= CITY_H) return x >= bayX ? DISTRICTS.marina : DISTRICTS.palmbeach;
    const block = blockAt(x, y);
    if (block) return DISTRICTS[block.district];
    // On a road: the district of the nearest block, good enough for a HUD label.
    const col = Math.min(cols - 1, Math.max(0, Math.round((x - roadW) / pitchX - 0.5)));
    const row = Math.min(rows - 1, Math.max(0, Math.round((y - roadW) / pitchY - 0.5)));
    return DISTRICTS[districtFor(col, row)];
  }

  return {
    width: WORLD.width,
    height: WORLD.height,
    cityWidth: CITY_W,
    cityHeight: CITY_H,
    blocks,
    buildings,
    palms,
    lamps,
    parkedCars,
    lanes,
    intersections,
    roads: { vertical: vRoads, horizontal: hRoads },
    waterRects,
    bayRect,
    sandRect,
    pois,
    districtRegions,
    playerSpawn,
    carSpawn,
    isWater,
    buildingAt,
    pointBlocked,
    circleBlocked,
    isOnRoad,
    blockAt,
    districtAt,
  };
}
