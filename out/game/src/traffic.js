// Traffic: every vehicle in Sunfall City lives here. This module owns the one vehicle
// registry (parked cars, AI traffic and the player's current car all sit in the same
// array, which main.js exposes as state.cars for rendering depth-sort and collisions),
// drives the AI cars along the world's lane network, and hosts the crime-event registry:
// thefts, hit pedestrians and (from session 2b) gunfire are emitted here, and the police
// system will subscribe to react. Stealing a driven car is noticed by pedestrians.js,
// which watches the registry for a car that gained the player while still flagged with a
// driver, and makes that driver bail out.
import { VEHICLE_TYPES } from './config.js';
import { createCar } from './player.js';

// --- Crime events ---------------------------------------------------------------------
// onCrime(type, handler) subscribes; emitCrime(type, x, y, data) notifies. Handlers run
// synchronously in subscription order. Known types: 'theft', 'hitped', 'gunfire',
// 'crash'. Session 2b's police subscribe here for the wanted level.
const crimeHandlers = new Map();

export function onCrime(type, handler) {
  if (!crimeHandlers.has(type)) crimeHandlers.set(type, []);
  crimeHandlers.get(type).push(handler);
  return () => {
    const list = crimeHandlers.get(type);
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  };
}

export function emitCrime(type, x, y, data = {}) {
  const list = crimeHandlers.get(type);
  if (!list) return;
  const event = { type, x, y, ...data };
  for (const handler of [...list]) handler(event);
}

// --- Tuning -----------------------------------------------------------------------------
const TARGET_TRAFFIC = 13; // AI cars kept alive around the player.
const SPAWN_MIN = 420; // Never materialise a car this close to the player…
const SPAWN_MAX = 1050; // …or farther than this.
const DESPAWN_DIST = 1300;
const FOLLOW_GAP = 30; // Extra clear road an AI car wants ahead of its nose.

function laneLength(lane) {
  return Math.hypot(lane.x2 - lane.x1, lane.y2 - lane.y1);
}

function key(x, y) {
  return `${Math.round(x)},${Math.round(y)}`;
}

/**
 * The traffic manager for one world. `rng` is a seeded random source (see random.js) so a
 * given seed always grows the same city life.
 */
export function createTraffic(world, rng) {
  /** The one vehicle registry. main.js aliases this array as state.cars. */
  const vehicles = [];
  /** AI drivers: { car, lane, t, speed, cruise }. Parked and player cars are not here. */
  const drivers = [];
  // Lanes indexed by their start point, for choosing the next segment at an intersection.
  const lanesFrom = new Map();
  for (const lane of world.lanes) {
    const k = key(lane.x1, lane.y1);
    if (!lanesFrom.has(k)) lanesFrom.set(k, []);
    lanesFrom.get(k).push(lane);
  }

  /** Add any car (the player's coupe, a shot extra) to the registry. Returns the car. */
  function addVehicle(car) {
    if (!vehicles.includes(car)) vehicles.push(car);
    return car;
  }

  /** Turn the world's parked-car specs into real, stealable parked vehicles. */
  function populateParked() {
    for (const spec of world.parkedCars) {
      const car = createCar(spec);
      car.parked = true;
      car.driver = false;
      addVehicle(car);
    }
  }

  function spawnDriver(focus) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const lane = rng.pick(world.lanes);
      const len = laneLength(lane);
      const t = rng.range(0, len);
      const x = lane.x1 + lane.dirX * t;
      const y = lane.y1 + lane.dirY * t;
      const d = Math.hypot(x - focus.x, y - focus.y);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      let blocked = false;
      for (const other of vehicles) {
        if (Math.hypot(other.x - x, other.y - y) < 46) { blocked = true; break; }
      }
      if (blocked) continue;
      const type = rng.pick(VEHICLE_TYPES);
      const car = createCar({
        typeId: type.id,
        color: rng.pick(type.colors),
        x, y,
        angle: Math.atan2(lane.dirY, lane.dirX),
      });
      car.driver = true;
      car.parked = false;
      addVehicle(car);
      drivers.push({ car, lane, t, speed: 0, cruise: type.topSpeed * rng.range(0.34, 0.5) });
      return;
    }
  }

  /** Is something solid on this lane within `ahead` units of travel from (x, y)? */
  function obstructionAhead(state, entry, ahead) {
    const { car, lane } = entry;
    let limit = Infinity;
    // Vehicles: project onto the lane direction; lateral offset must be small.
    for (const other of vehicles) {
      if (other === car) continue;
      const rx = other.x - car.x;
      const ry = other.y - car.y;
      const lon = rx * lane.dirX + ry * lane.dirY;
      if (lon <= 0 || lon > ahead + other.length / 2) continue;
      const lat = Math.abs(-rx * lane.dirY + ry * lane.dirX);
      if (lat < (car.width + other.width) / 2 + 2) limit = Math.min(limit, lon - other.length / 2);
    }
    // Pedestrians on the road ahead: traffic brakes for them rather than run them down.
    const peds = state.pedestrians?.list;
    if (peds) {
      for (const ped of peds) {
        if (ped.mode === 'down') continue;
        const rx = ped.x - car.x;
        const ry = ped.y - car.y;
        const lon = rx * lane.dirX + ry * lane.dirY;
        if (lon <= 0 || lon > ahead) continue;
        const lat = Math.abs(-rx * lane.dirY + ry * lane.dirX);
        if (lat < car.width / 2 + 9) limit = Math.min(limit, lon);
      }
    }
    return limit;
  }

  function updateDriver(state, entry, dt) {
    const { car, lane } = entry;
    const len = laneLength(lane);
    // Desired speed: cruise, unless the road ahead is not clear.
    const lookAhead = car.length / 2 + FOLLOW_GAP + entry.speed * 0.55;
    const clear = obstructionAhead(state, entry, lookAhead);
    let target = entry.cruise;
    if (clear < lookAhead) target = clear < car.length / 2 + 12 ? 0 : entry.cruise * 0.35;
    const accel = target > entry.speed ? car.type.accel * 0.55 : 640;
    const prev = entry.speed;
    entry.speed += Math.max(-accel * dt, Math.min(accel * dt, target - entry.speed));
    car.braking = entry.speed < prev - 4;

    entry.t += entry.speed * dt;
    if (entry.t >= len) {
      // Intersection: continue onto a lane that starts where this one ends.
      const next = lanesFrom.get(key(lane.x2, lane.y2));
      if (!next || next.length === 0) return false; // Dead end of the network: despawn.
      entry.lane = rng.pick(next);
      entry.t = entry.t - len;
    }
    const l = entry.lane;
    car.x = l.x1 + l.dirX * entry.t;
    car.y = l.y1 + l.dirY * entry.t;
    car.angle = Math.atan2(l.dirY, l.dirX);
    car.vx = l.dirX * entry.speed;
    car.vy = l.dirY * entry.speed;
    car.forwardSpeed = entry.speed;
    car.steer = 0;
    return true;
  }

  function removeDriver(entry) {
    const di = drivers.indexOf(entry);
    if (di >= 0) drivers.splice(di, 1);
    const vi = vehicles.indexOf(entry.car);
    if (vi >= 0) vehicles.splice(vi, 1);
  }

  /**
   * Advance traffic by one fixed step. `state` supplies the player (the focus the city
   * life gathers around) and, once pedestrians exist, state.pedestrians.list.
   */
  function update(state, dt) {
    const focus = state.player;
    // The player took a driven car: its driver is gone (pedestrians.js makes him bail),
    // so the AI lets go of the wheel but the car stays in the registry.
    for (let i = drivers.length - 1; i >= 0; i -= 1) {
      if (drivers[i].car.occupied) drivers.splice(i, 1);
    }
    while (drivers.length < TARGET_TRAFFIC) {
      const before = drivers.length;
      spawnDriver(focus);
      if (drivers.length === before) break; // No legal spawn point this step; retry next.
    }
    for (let i = drivers.length - 1; i >= 0; i -= 1) {
      const entry = drivers[i];
      const d = Math.hypot(entry.car.x - focus.x, entry.car.y - focus.y);
      if (d > DESPAWN_DIST) { removeDriver(entry); continue; }
      if (!updateDriver(state, entry, dt)) removeDriver(entry);
    }
  }

  return {
    vehicles,
    drivers,
    addVehicle,
    populateParked,
    update,
    onCrime,
    emitCrime,
  };
}
