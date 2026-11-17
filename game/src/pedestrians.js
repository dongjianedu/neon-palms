// Pedestrians: the people of Sunfall City. They stroll the sidewalk rims of the city
// blocks, cross the road at the ends of blocks, run from fast cars and gunfire, and fall
// when a car hits them (a 'hitped' crime for the police of session 2b to hear about).
// When the player steals a car that still has its driver, this module spots it in the
// vehicle registry, raises the 'theft' crime and makes the driver bail out and flee.
// Drawing mirrors player.js's little figure, recoloured per person.
import { AMBIENT, GRID } from './config.js';
import { roundRectPath, shadeColor } from './player.js';
import { emitCrime, onCrime } from './traffic.js';

const RIM_INSET = 9; // Sidewalk line inside the block edge that pedestrians walk.
const SPAWN_RANGE = 780;
const RELOCATE_DIST = 1150;
const PED_RADIUS = 9;

const SHIRTS = ['#e4572e', '#f2f0e6', '#3f7fbf', '#ffc93c', '#7ec850', '#ff8fab', '#8e6cc8', '#12b5a5', '#c8ccd2', '#e88ca0', '#ef8354', '#43aa8b', '#9b5de5'];
const PANTS = ['#31435c', '#5b4636', '#2e4053', '#707a68', '#8c2f39', '#3e5c50'];
const SKINS = ['#e8b08a', '#c68863', '#8d5a3b', '#f2c9a4', '#6e4525'];
const HAIRS = ['#2b2118', '#4a3220', '#101010', '#8a6d3b', '#b8b0a4', '#7a2e2e'];

function rimRect(block) {
  return { x: block.x + RIM_INSET, y: block.y + RIM_INSET, w: block.w - RIM_INSET * 2, h: block.h - RIM_INSET * 2 };
}

function rimPoint(rect, s) {
  const P = 2 * (rect.w + rect.h);
  let d = ((s % P) + P) % P;
  if (d < rect.w) return { x: rect.x + d, y: rect.y, tx: 1, ty: 0 };
  d -= rect.w;
  if (d < rect.h) return { x: rect.x + rect.w, y: rect.y + d, tx: 0, ty: 1 };
  d -= rect.h;
  if (d < rect.w) return { x: rect.x + rect.w - d, y: rect.y + rect.h, tx: -1, ty: 0 };
  d -= rect.w;
  return { x: rect.x, y: rect.y + rect.h - d, tx: 0, ty: -1 };
}

/** The rim parameter nearest to a point (used after a crossing lands on a new block). */
function rimParam(rect, x, y) {
  const P = 2 * (rect.w + rect.h);
  const candidates = [
    { s: Math.min(Math.max(x - rect.x, 0), rect.w), d: Math.abs(y - rect.y) },
    { s: rect.w + Math.min(Math.max(y - rect.y, 0), rect.h), d: Math.abs(x - (rect.x + rect.w)) },
    { s: rect.w + rect.h + Math.min(Math.max(rect.x + rect.w - x, 0), rect.w), d: Math.abs(y - (rect.y + rect.h)) },
    { s: 2 * rect.w + rect.h + Math.min(Math.max(rect.y + rect.h - y, 0), rect.h), d: Math.abs(x - rect.x) },
  ];
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0].s % P;
}

/**
 * The pedestrian manager. `traffic` is the traffic.js manager (its vehicle registry is
 * watched for thefts and used for hit tests); `rng` is a seeded random source.
 */
export function createPedestrians(world, traffic, rng) {
  const list = [];
  let time = 0;

  function makePed() {
    return {
      x: 0, y: 0, angle: 0, vx: 0, vy: 0, walkPhase: rng.range(0, 6),
      block: null, s: 0, dirSign: 1, speed: rng.range(52, 82),
      mode: 'rim', target: null, threat: null, threatUntil: 0, downT: 0,
      crossIn: rng.range(6, 26),
      shirt: rng.pick(SHIRTS), pants: rng.pick(PANTS), skin: rng.pick(SKINS), hair: rng.pick(HAIRS),
    };
  }

  function placeOnRim(ped, focus) {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const block = rng.pick(world.blocks);
      if (!block) continue;
      const cx = block.x + block.w / 2;
      const cy = block.y + block.h / 2;
      if (Math.hypot(cx - focus.x, cy - focus.y) > SPAWN_RANGE) continue;
      if (world.isWater(cx, cy)) continue;
      const rect = rimRect(block);
      ped.block = block;
      ped.s = rng.range(0, 2 * (rect.w + rect.h));
      ped.dirSign = rng.chance(0.5) ? 1 : -1;
      const p = rimPoint(rect, ped.s);
      ped.x = p.x; ped.y = p.y;
      ped.mode = 'rim';
      ped.target = null;
      ped.threat = null;
      return true;
    }
    return false;
  }

  /** Send a pedestrian running from (x, y) for `dur` seconds. */
  function flee(ped, x, y, dur) {
    if (ped.mode === 'down') return;
    ped.mode = 'flee';
    ped.threat = { x, y };
    ped.threatUntil = time + dur;
    ped.target = null;
  }

  function notifyGunfire(x, y) {
    for (const ped of list) {
      if (Math.hypot(ped.x - x, ped.y - y) < 300) flee(ped, x, y, 3.2);
    }
  }

  // Gunfire reported through the crime registry scatters everyone nearby.
  onCrime('gunfire', (event) => notifyGunfire(event.x, event.y));

  function tryCross(ped) {
    if (!ped.block) return;
    const rect = rimRect(ped.block);
    const gapX = GRID.pitchX - ped.block.w;
    const gapY = GRID.pitchY - ped.block.h;
    const onTop = Math.abs(ped.y - rect.y) < 2;
    const onBottom = Math.abs(ped.y - (rect.y + rect.h)) < 2;
    const onLeft = Math.abs(ped.x - rect.x) < 2;
    const onRight = Math.abs(ped.x - (rect.x + rect.w)) < 2;
    let target = null;
    if (onTop) target = { x: ped.x, y: ped.block.y - gapY - RIM_INSET };
    else if (onBottom) target = { x: ped.x, y: ped.block.y + ped.block.h + gapY + RIM_INSET };
    else if (onLeft) target = { x: ped.block.x - gapX - RIM_INSET, y: ped.y };
    else if (onRight) target = { x: ped.block.x + ped.block.w + gapX + RIM_INSET, y: ped.y };
    if (!target) return;
    const dest = world.blockAt(target.x, target.y);
    if (!dest || world.isWater(target.x, target.y)) return;
    if (world.isWater((ped.x + target.x) / 2, (ped.y + target.y) / 2)) return;
    ped.mode = 'cross';
    ped.target = target;
    ped.crossBlock = dest;
  }

  function updateRim(ped, dt) {
    ped.crossIn -= dt;
    if (ped.crossIn <= 0) {
      ped.crossIn = rng.range(9, 29);
      tryCross(ped);
      if (ped.mode !== 'rim') return;
    }
    ped.s += ped.dirSign * ped.speed * dt;
    const p = rimPoint(rimRect(ped.block), ped.s);
    ped.x = p.x; ped.y = p.y;
    ped.angle = Math.atan2(p.ty * ped.dirSign, p.tx * ped.dirSign);
    ped.walkPhase += ped.speed * dt * 0.06;
  }

  function moveToward(ped, tx, ty, speed, dt) {
    const dx = tx - ped.x;
    const dy = ty - ped.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) return true;
    const step = Math.min(d, speed * dt);
    const nx = ped.x + (dx / d) * step;
    const ny = ped.y + (dy / d) * step;
    if (!world.circleBlocked(nx, ped.y, PED_RADIUS)) ped.x = nx;
    if (!world.circleBlocked(ped.x, ny, PED_RADIUS)) ped.y = ny;
    ped.angle = Math.atan2(dy, dx);
    ped.walkPhase += speed * dt * 0.06;
    return d <= step + 4;
  }

  function update(state, dt) {
    time += dt;
    const focus = state.player;

    // Keep the crowd gathered around the player.
    while (list.length < AMBIENT.pedestrians) {
      const ped = makePed();
      if (!placeOnRim(ped, focus)) break;
      list.push(ped);
    }
    for (const ped of list) {
      if (ped.mode !== 'down' && Math.hypot(ped.x - focus.x, ped.y - focus.y) > RELOCATE_DIST) {
        placeOnRim(ped, focus);
      }
    }

    // Theft watch: a registry car the player is driving that still has its driver loses
    // him here — he bails out beside the car and runs, and the theft becomes a crime.
    for (const car of traffic.vehicles) {
      if (car.occupied && car.driver) {
        car.driver = false;
        emitCrime('theft', car.x, car.y, { car: car.name });
        const perp = car.angle + Math.PI / 2;
        const ped = makePed();
        ped.x = car.x + Math.cos(perp) * (car.width / 2 + 14);
        ped.y = car.y + Math.sin(perp) * (car.width / 2 + 14);
        ped.block = world.blockAt(ped.x, ped.y);
        flee(ped, car.x, car.y, 3.4);
        list.push(ped);
      }
    }

    for (const ped of list) {
      if (ped.mode === 'down') {
        ped.downT -= dt;
        if (ped.downT <= 0) placeOnRim(ped, focus); // Quietly replaced across town.
        continue;
      }
      // Hit test against every moving vehicle in the registry.
      let hit = null;
      for (const car of traffic.vehicles) {
        const speed = Math.hypot(car.vx, car.vy);
        if (speed < 70) continue;
        const dx = ped.x - car.x;
        const dy = ped.y - car.y;
        const cos = Math.cos(-car.angle);
        const sin = Math.sin(-car.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        if (Math.abs(lx) < car.length / 2 + 5 && Math.abs(ly) < car.width / 2 + 5) { hit = car; break; }
      }
      if (hit) {
        ped.mode = 'down';
        ped.downT = 4.5;
        emitCrime('hitped', ped.x, ped.y, { speed: Math.round(Math.hypot(hit.vx, hit.vy)) });
        continue;
      }
      // A fast car bearing down scares people off the road and sidewalk alike.
      if (ped.mode === 'rim' || ped.mode === 'cross') {
        for (const car of traffic.vehicles) {
          const speed = Math.hypot(car.vx, car.vy);
          if (speed < 195) continue;
          if (Math.hypot(car.x - ped.x, car.y - ped.y) < 88) { flee(ped, car.x, car.y, 1.7); break; }
        }
      }
      if (ped.mode === 'flee') {
        if (time >= ped.threatUntil) {
          // Head back to the nearest block rim and resume the stroll.
          const block = world.blockAt(ped.x, ped.y) ?? ped.block;
          if (block) {
            ped.block = block;
            const rect = rimRect(block);
            ped.s = rimParam(rect, ped.x, ped.y);
            ped.mode = 'rim';
          } else {
            ped.threatUntil = time + 0.5;
          }
        } else {
          const dx = ped.x - ped.threat.x;
          const dy = ped.y - ped.threat.y;
          const d = Math.hypot(dx, dy) || 1;
          moveToward(ped, ped.x + (dx / d) * 120, ped.y + (dy / d) * 120, 178, dt);
        }
      } else if (ped.mode === 'cross') {
        if (moveToward(ped, ped.target.x, ped.target.y, ped.speed * 1.25, dt)) {
          ped.block = ped.crossBlock;
          ped.s = rimParam(rimRect(ped.block), ped.x, ped.y);
          ped.mode = 'rim';
        }
      } else {
        updateRim(ped, dt);
      }
    }
    // Bailed drivers leave the crowd once they have run their panic out (list hygiene:
    // fleeing extras beyond the target count are dropped when calm and far away).
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list.length <= AMBIENT.pedestrians) break;
      const ped = list[i];
      if (ped.mode === 'rim' && Math.hypot(ped.x - focus.x, ped.y - focus.y) > 500) list.splice(i, 1);
    }
  }

  return { list, update, notifyGunfire, flee };
}

/** Draw one pedestrian: player.js's little figure in this person's own colours. */
export function drawPedestrian(ctx, ped) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.fillStyle = 'rgba(18,22,18,0.25)';
  ctx.beginPath();
  ctx.ellipse(3, 5, 10, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (ped.mode === 'down') {
    // Flat on the ground: body stretched out, head at one end.
    ctx.rotate(ped.angle);
    ctx.fillStyle = ped.pants;
    roundRectPath(ctx, -13, -3.5, 11, 7, 3);
    ctx.fill();
    ctx.fillStyle = ped.shirt;
    roundRectPath(ctx, -3, -5, 12, 10, 4);
    ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath();
    ctx.arc(13, 0, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.rotate(ped.angle);
  const swing = Math.sin(ped.walkPhase) * 2.8;
  ctx.fillStyle = ped.pants;
  roundRectPath(ctx, -7.5, -6.5 + swing * 0.4, 6.5, 4.6, 2);
  ctx.fill();
  roundRectPath(ctx, -7.5, 2 - swing * 0.4, 6.5, 4.6, 2);
  ctx.fill();
  ctx.fillStyle = shadeColor(ped.shirt, 0.82);
  ctx.beginPath();
  ctx.arc(2 - swing * 0.5, -9.4, 3, 0, Math.PI * 2);
  ctx.arc(2 + swing * 0.5, 9.4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.shirt;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(1.4, 0, 5.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.hair;
  ctx.beginPath();
  ctx.arc(-0.5, 0, 3.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
