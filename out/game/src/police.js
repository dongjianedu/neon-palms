// The law: Harbor PD. This module owns the wanted level and every police unit. It
// subscribes to the crime registry in traffic.js (theft, hit-and-run, gunfire) and turns
// crimes into heat; heat crosses thresholds to become stars, 0 to 5. Police cruisers are
// ordinary cars from player.js's createCar with a police livery flag, registered with
// traffic so they render, collide and can even be stolen; this module drives them with a
// road-aware pursuit model: far away they run the road grid toward the player, close up
// they drive straight at an intercept point to pin him. At three stars and up they also
// throw two-car roadblocks across the road ahead. Heat cools when nobody — unit or
// pedestrian — has eyes on the player. A unit standing over a slow or foot-bound player
// fills the bust meter; a full meter means BUSTED: a cash fine and a drop outside the
// Harbor Precinct. Missions (session 3) can raise heat directly through addHeat.
import { GRID } from './config.js';
import { carForwardSpeed, createCar } from './player.js';
import { onCrime } from './traffic.js';

/** Heat at which each star lights: index is the star count it unlocks. */
const STAR_THRESHOLDS = [0, 40, 140, 260, 420, 620];
/** Heat added per crime type, before any mission-specific addHeat calls. */
const CRIME_HEAT = { theft: 45, hitped: 70, gunfire: 60, crash: 15 };
/** Cruisers the department fields per star count. */
const UNITS_PER_STAR = [0, 1, 2, 3, 4, 6];
const SPAWN_MIN = 640; // Cruisers materialise off-screen…
const SPAWN_MAX = 1080; // …but close enough to join the chase quickly.
const DESPAWN_DIST = 1250;
const SIGHT_RANGE = 430; // A unit this close with line of sight keeps the heat on.
const PED_SIGHT_RANGE = 210;
const COOL_DELAY = 6; // Seconds unseen before heat starts to drain.
const COOL_RATE = 15; // Heat per second once cooling.
const BUST_RANGE = 58;
const BUST_TIME = 1.2; // Seconds of standing over the player to fill the meter.
const BLOCK_MIN_STARS = 3;
const BLOCK_COOLDOWN = 30;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Does any building block the straight line from (x1, y1) to (x2, y2)? */
function lineOfSight(world, x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.floor(dist / 26));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (world.circleBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2)) return false;
  }
  return true;
}

/**
 * The police system for one world. `rng` is a seeded source (random.js) so spawns and
 * roadblocks are reproducible for a given seed.
 */
export function createPolice(world, traffic, rng) {
  let heat = 0;
  let stars = 0;
  /** Active units: { car, mode: 'pursue'|'block', speed, blockT }. */
  const units = [];
  let unseenFor = 0;
  let sighted = false;
  let bustProgress = 0;
  let blockCooldown = 8; // A short grace before the first roadblock.
  let lastCrimeAt = { x: 0, y: 0 };

  const precinct = world.pois.find((poi) => poi.kind === 'police') ?? { x: world.playerSpawn.x, y: world.playerSpawn.y };

  function computeStars() {
    let s = 0;
    for (let i = 1; i < STAR_THRESHOLDS.length; i += 1) if (heat >= STAR_THRESHOLDS[i]) s = i;
    return s;
  }

  /** Raise the heat (and remember where the crime happened). Used by crimes and missions. */
  function addHeat(amount, x, y) {
    heat = Math.min(STAR_THRESHOLDS[STAR_THRESHOLDS.length - 1] + 260, heat + amount);
    if (Number.isFinite(x) && Number.isFinite(y)) lastCrimeAt = { x, y };
    stars = computeStars();
  }

  /** Set the heat outright — deterministic staging for the screenshot scenes. */
  function setHeat(value) {
    heat = value;
    stars = computeStars();
  }

  for (const [type, amount] of Object.entries(CRIME_HEAT)) {
    onCrime(type, (event) => addHeat(amount, event.x, event.y));
  }

  function removeUnit(unit) {
    const ui = units.indexOf(unit);
    if (ui >= 0) units.splice(ui, 1);
    const vi = traffic.vehicles.indexOf(unit.car);
    if (vi >= 0) traffic.vehicles.splice(vi, 1);
  }

  /** Field every unit at once (busted, wasted, or the heat simply died). */
  function clearWanted() {
    heat = 0;
    stars = 0;
    bustProgress = 0;
    unseenFor = 0;
    for (let i = units.length - 1; i >= 0; i -= 1) removeUnit(units[i]);
  }

  /**
   * Put one cruiser on a lane off-screen and set it hunting. Also used by shots.js to
   * stage the chase scene, with explicit position and angle. Returns the unit or null.
   */
  function stageUnit(state, x, y, angle) {
    const car = createCar({ typeId: 'cruiser', color: '#eef1f4', x, y, angle });
    car.police = true;
    car.driver = false;
    car.parked = false;
    car.lightPhase = rng.range(0, 1);
    traffic.addVehicle(car);
    const unit = { car, mode: 'pursue', speed: 0, blockT: 0 };
    units.push(unit);
    return unit;
  }

  function spawnUnit(state) {
    const focus = state.player;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const lane = rng.pick(world.lanes);
      const len = Math.hypot(lane.x2 - lane.x1, lane.y2 - lane.y1);
      const t = rng.range(0, len);
      const x = lane.x1 + lane.dirX * t;
      const y = lane.y1 + lane.dirY * t;
      const d = Math.hypot(x - focus.x, y - focus.y);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      let blocked = false;
      for (const other of traffic.vehicles) {
        if (Math.hypot(other.x - x, other.y - y) < 52) { blocked = true; break; }
      }
      if (blocked) continue;
      const unit = stageUnit(state, x, y, Math.atan2(lane.dirY, lane.dirX));
      if (unit) unit.speed = 130;
      return;
    }
  }

  /** Two cruisers parked across both lanes of the road the player is running on. */
  function placeRoadblock(state) {
    const { player } = state;
    const fx = Math.cos(player.angle);
    const fy = Math.sin(player.angle);
    const aheadX = player.x + fx * 430;
    const aheadY = player.y + fy * 430;
    const vertical = Math.abs(fx) < Math.abs(fy); // Running along a vertical road.
    let roadX = null;
    let roadY = null;
    for (const road of world.roads.vertical) if (roadX === null || Math.abs(road.x - aheadX) < Math.abs(roadX - aheadX)) roadX = road.x;
    for (const road of world.roads.horizontal) if (roadY === null || Math.abs(road.y - aheadY) < Math.abs(roadY - aheadY)) roadY = road.y;
    const faceAngle = player.angle + Math.PI;
    const spots = vertical
      ? [{ x: roadX - GRID.laneOff, y: aheadY }, { x: roadX + GRID.laneOff, y: aheadY }]
      : [{ x: aheadX, y: roadY - GRID.laneOff }, { x: aheadX, y: roadY + GRID.laneOff }];
    for (const spot of spots) {
      if (world.circleBlocked(spot.x, spot.y, 16)) continue;
      const unit = stageUnit(state, spot.x, spot.y, faceAngle);
      if (unit) { unit.mode = 'block'; unit.blockT = 13; unit.speed = 0; }
    }
  }

  /** Steer one unit for a step: lane-run when far, direct intercept when close. */
  function driveUnit(state, unit, dt) {
    const { player, world: w } = state;
    const car = unit.car;
    car.lightPhase = (car.lightPhase ?? 0) + dt * 1.6;

    if (unit.mode === 'block') {
      unit.blockT -= dt;
      car.vx = 0; car.vy = 0; car.forwardSpeed = 0;
      const passed = Math.hypot(car.x - player.x, car.y - player.y) > 560;
      if (unit.blockT <= 0 || passed) unit.mode = 'pursue';
      return;
    }

    // Intercept point: where the player will be shortly, led by his velocity.
    const dist = Math.hypot(player.x - car.x, player.y - car.y);
    const lead = clamp(dist / 340, 0, 0.85);
    let tx = player.x + player.vx * lead;
    let ty = player.y + player.vy * lead;
    if (dist > 300) {
      // Road-aware approach: aim at the intersection nearest the player first, so the
      // cruiser runs the grid instead of grinding across blocks.
      let gx = null;
      let gy = null;
      for (const road of w.roads.vertical) if (gx === null || Math.abs(road.x - tx) < Math.abs(gx - tx)) gx = road.x;
      for (const road of w.roads.horizontal) if (gy === null || Math.abs(road.y - ty) < Math.abs(gy - ty)) gy = road.y;
      // Only route via the intersection while it is still ahead of the cruiser.
      if (Math.hypot(gx - car.x, gy - car.y) > 60) { tx = gx; ty = gy; }
    }

    const desired = Math.atan2(ty - car.y, tx - car.x);
    const turn = clamp(angleDelta(car.angle, desired), -car.type.turn * dt, car.type.turn * dt);
    car.angle += turn;

    // Target speed: full chase pace, rubber-banded when far, eased right at the player
    // so the cruiser pins and shoves instead of orbiting at full throttle.
    let target = car.type.topSpeed * (0.82 + stars * 0.045);
    if (dist > 620) target = car.type.topSpeed * 1.12;
    if (dist < 74) target = Math.min(target, 120);
    if (dist < 46) target = 0; // On top of him: stop and cover him (feeds the bust meter).
    if (car.tirePopped) target *= 0.55;
    // Something solid right ahead: check the nose before committing to the speed.
    const noseX = car.x + Math.cos(car.angle) * car.length * 0.62;
    const noseY = car.y + Math.sin(car.angle) * car.length * 0.62;
    if (w.circleBlocked(noseX, noseY, car.width * 0.5)) target = 0;
    const accel = target > unit.speed ? car.type.accel : 620;
    unit.speed += clamp(target - unit.speed, -accel * dt * 2.2, accel * dt);

    const prevX = car.x;
    const prevY = car.y;
    car.x += Math.cos(car.angle) * unit.speed * dt;
    car.y += Math.sin(car.angle) * unit.speed * dt;
    if (w.circleBlocked(car.x, car.y, car.width * 0.5)) {
      car.x = prevX;
      car.y = prevY;
      unit.speed *= -0.25; // Back off a wall and let the steering pick a new line.
    }
    car.vx = Math.cos(car.angle) * unit.speed;
    car.vy = Math.sin(car.angle) * unit.speed;
    car.forwardSpeed = unit.speed;
    car.steer = clamp(angleDelta(car.angle, desired) * 1.4, -1, 1);
  }

  /** BUSTED: fine the player, clear the heat, drop him outside the precinct. */
  function bustPlayer(state) {
    const { player } = state;
    const fine = Math.max(50, Math.round(player.cash * 0.1));
    player.cash = Math.max(0, player.cash - fine);
    if (player.mode === 'car' && player.car) {
      player.car.occupied = false;
      player.car = null;
      player.mode = 'foot';
    }
    player.x = precinct.x;
    player.y = precinct.y + 26;
    player.vx = 0;
    player.vy = 0;
    player.angle = Math.PI / 2;
    clearWanted();
    state.pendingAnnounce = `BUSTED — Harbor PD fine $${fine}. Released outside the Harbor Precinct.`;
  }

  /** Advance the whole system one fixed step. */
  function update(state, dt) {
    const { player } = state;
    blockCooldown -= dt;

    // Units the player has stolen are his problem now, not the department's.
    for (let i = units.length - 1; i >= 0; i -= 1) {
      if (units[i].car.occupied) units.splice(i, 1);
    }

    // Field strength follows the stars; surplus units peel off when far away.
    const wanted = UNITS_PER_STAR[stars];
    let guard = 0;
    while (units.length < wanted && guard < 3) { spawnUnit(state); guard += 1; }
    for (let i = units.length - 1; i >= 0; i -= 1) {
      const unit = units[i];
      const d = Math.hypot(unit.car.x - player.x, unit.car.y - player.y);
      if (units.length > wanted && d > 480) { removeUnit(unit); continue; }
      if (stars === 0 && d > DESPAWN_DIST) { removeUnit(unit); continue; }
      driveUnit(state, unit, dt);
    }

    // Roadblocks once the chase is serious and the player is actually running.
    if (stars >= BLOCK_MIN_STARS && blockCooldown <= 0 && player.mode === 'car'
      && Math.abs(carForwardSpeed(player.car)) > 70) {
      placeRoadblock(state);
      blockCooldown = BLOCK_COOLDOWN;
    }

    // Eyes on the player: any unit close with line of sight, or a pedestrian nearby.
    sighted = false;
    if (stars > 0) {
      for (const unit of units) {
        const d = Math.hypot(unit.car.x - player.x, unit.car.y - player.y);
        if (d < SIGHT_RANGE && lineOfSight(world, unit.car.x, unit.car.y, player.x, player.y)) { sighted = true; break; }
      }
      if (!sighted && state.pedestrians) {
        for (const ped of state.pedestrians.list) {
          if (ped.mode !== 'down' && Math.hypot(ped.x - player.x, ped.y - player.y) < PED_SIGHT_RANGE) { sighted = true; break; }
        }
      }
    }
    if (sighted) unseenFor = 0;
    else {
      unseenFor += dt;
      if (unseenFor > COOL_DELAY && heat > 0) {
        heat = Math.max(0, heat - COOL_RATE * dt);
        stars = computeStars();
      }
    }

    // The bust meter: a cruiser standing over a player who cannot run fills it.
    const playerSpeed = Math.hypot(player.vx, player.vy);
    let covered = false;
    if (stars > 0 && (player.mode === 'foot' || playerSpeed < 26)) {
      for (const unit of units) {
        if (Math.hypot(unit.car.x - player.x, unit.car.y - player.y) < BUST_RANGE) { covered = true; break; }
      }
    }
    if (covered) {
      bustProgress = Math.min(1, bustProgress + dt / BUST_TIME);
      if (bustProgress >= 1) bustPlayer(state);
    } else {
      bustProgress = Math.max(0, bustProgress - dt * 1.8);
    }
  }

  return {
    get heat() { return heat; },
    get stars() { return stars; },
    get sighted() { return sighted; },
    get bustProgress() { return bustProgress; },
    units,
    addHeat,
    setHeat,
    clearWanted,
    stageUnit,
    update,
  };
}
