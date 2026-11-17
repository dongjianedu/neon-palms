// The player: Marlo Reyes on foot and behind the wheel. Owns the character's movement and
// collision, the arcade driving model (throttle, steering, drift, bounce), getting in and
// out of cars, and the drawing of both the figure and every car. Traffic, police and
// pedestrians arrive in a later session and will reuse createCar and the driving model.
import { CAR_TUNING, PLAYER, vehicleType } from './config.js';

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Turn `angle` toward `target` by at most `maxStep`, taking the short way round. */
function turnToward(angle, target, maxStep) {
  let delta = (target - angle) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return angle + clamp(delta, -maxStep, maxStep);
}

/** Lighten (f > 1) or darken (f < 1) a #rrggbb colour. */
export function shadeColor(hex, f) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

/** Path of a rounded rectangle, ready to fill or stroke. */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** The player character, spawned by main.js at the world's playerSpawn. */
export function createPlayer(world) {
  return {
    x: world.playerSpawn.x,
    y: world.playerSpawn.y,
    angle: world.playerSpawn.angle,
    vx: 0,
    vy: 0,
    mode: 'foot',
    car: null,
    walkPhase: 0,
    health: 100,
    maxHealth: 100,
    cash: 250,
  };
}

/**
 * A car from a spec of {typeId, color, x, y, angle}: parked cars from the world builder
 * and the player's own coupe both come through here, so every car drives the same way.
 */
export function createCar(spec) {
  const type = vehicleType(spec.typeId);
  return {
    typeId: type.id,
    type,
    name: type.name,
    color: spec.color ?? type.colors[0],
    length: type.length,
    width: type.width,
    x: spec.x,
    y: spec.y,
    angle: spec.angle ?? 0,
    vx: 0,
    vy: 0,
    steer: 0,
    forwardSpeed: 0,
    braking: false,
    occupied: false,
  };
}

/** Signed speed along the car's nose, in units per second. */
export function carForwardSpeed(car) {
  return car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
}

/** The closest car to a point within `range`, or null. */
export function nearestCar(cars, x, y, range) {
  let best = null;
  let bestDist = range;
  for (const car of cars) {
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best;
}

function updateOnFoot(state, input, dt) {
  const { world, player } = state;
  const axis = input.axis();
  const moving = axis.x !== 0 || axis.y !== 0;
  if (moving) {
    const len = Math.hypot(axis.x, axis.y);
    const speed = input.running() ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const dx = (axis.x / len) * speed * dt;
    const dy = (axis.y / len) * speed * dt;
    // Axis-separated movement slides along walls instead of sticking to them.
    if (!world.circleBlocked(player.x + dx, player.y, PLAYER.radius)) player.x += dx;
    if (!world.circleBlocked(player.x, player.y + dy, PLAYER.radius)) player.y += dy;
    player.angle = turnToward(player.angle, Math.atan2(axis.y, axis.x), PLAYER.turnRate * dt);
    player.walkPhase += speed * dt * 0.055;
    player.vx = (axis.x / len) * speed;
    player.vy = (axis.y / len) * speed;
  } else {
    player.vx = 0;
    player.vy = 0;
  }
  if (input.wasPressed('KeyF')) {
    const car = nearestCar(state.cars, player.x, player.y, CAR_TUNING.enterRange);
    if (car) {
      player.mode = 'car';
      player.car = car;
      car.occupied = true;
      player.x = car.x;
      player.y = car.y;
      player.angle = car.angle;
    }
  }
}

function exitCar(state) {
  const { world, player } = state;
  const car = player.car;
  const perp = car.angle + Math.PI / 2;
  for (const side of [1, -1]) {
    const nx = car.x + Math.cos(perp) * side * (car.width / 2 + PLAYER.radius + 7);
    const ny = car.y + Math.sin(perp) * side * (car.width / 2 + PLAYER.radius + 7);
    if (!world.circleBlocked(nx, ny, PLAYER.radius)) {
      player.x = nx;
      player.y = ny;
      player.angle = car.angle;
      player.mode = 'foot';
      player.car = null;
      car.occupied = false;
      return;
    }
  }
}

function updateDriving(state, input, dt) {
  const { world, player } = state;
  const car = player.car;
  const type = car.type;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let vf = car.vx * fx + car.vy * fy;
  let vl = -car.vx * fy + car.vy * fx;

  car.braking = false;
  if (input.down('KeyW') || input.down('ArrowUp')) vf += type.accel * dt;
  if (input.down('KeyS') || input.down('ArrowDown')) {
    if (vf > 12) {
      vf -= CAR_TUNING.brake * dt;
      car.braking = true;
    } else {
      vf -= CAR_TUNING.reverseAccel * dt;
    }
  }
  const handbrake = input.handbrake();
  vf -= vf * (CAR_TUNING.drag + (handbrake ? CAR_TUNING.handbrakeDrag : 0)) * dt;
  vf = clamp(vf, -CAR_TUNING.reverseTopSpeed, type.topSpeed);

  const steerIn =
    (input.down('KeyA') || input.down('ArrowLeft') ? -1 : 0) +
    (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0);
  car.steer += (steerIn - car.steer) * Math.min(1, dt * 11);
  const authority = clamp(Math.abs(vf) / 130, 0, 1);
  if (vf !== 0) car.angle += car.steer * type.turn * authority * dt * Math.sign(vf);

  const nfx = Math.cos(car.angle);
  const nfy = Math.sin(car.angle);
  const grip = type.grip * (handbrake ? CAR_TUNING.handbrakeGripScale : 1);
  vl *= Math.exp(-grip * dt);
  car.vx = nfx * vf - nfy * vl;
  car.vy = nfy * vf + nfx * vl;

  const prevX = car.x;
  const prevY = car.y;
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  // Buildings and water: nose, tail and centre are all tested; a hit bounces the car off.
  const r = car.width * 0.55;
  const noseX = car.x + nfx * car.length * 0.42;
  const noseY = car.y + nfy * car.length * 0.42;
  const tailX = car.x - nfx * car.length * 0.42;
  const tailY = car.y - nfy * car.length * 0.42;
  if (world.circleBlocked(noseX, noseY, r) || world.circleBlocked(tailX, tailY, r) || world.circleBlocked(car.x, car.y, r)) {
    car.x = prevX;
    car.y = prevY;
    car.vx *= -0.28;
    car.vy *= -0.28;
  }

  // Other cars are solid too, as rectangles: resolve along whichever axis penetrates
  // least, so a side scrape slides along a parked car while a true block stops the car.
  for (const other of state.cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const cos = Math.cos(-car.angle);
    const sin = Math.sin(-car.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const overlapX = (car.length + other.length) / 2 - 2 - Math.abs(lx);
    const overlapY = (car.width + other.width) / 2 - 2 - Math.abs(ly);
    if (overlapX <= 0 || overlapY <= 0) continue;
    let pushX = 0;
    let pushY = 0;
    if (overlapX < overlapY) pushX = lx > 0 ? -overlapX : overlapX;
    else pushY = ly > 0 ? -overlapY : overlapY;
    const wcos = Math.cos(car.angle);
    const wsin = Math.sin(car.angle);
    const wx = pushX * wcos - pushY * wsin;
    const wy = pushX * wsin + pushY * wcos;
    car.x += wx;
    car.y += wy;
    const d = Math.hypot(wx, wy) || 1;
    const ux = wx / d;
    const uy = wy / d;
    const vn = car.vx * ux + car.vy * uy;
    if (vn < 0) {
      car.vx -= vn * ux;
      car.vy -= vn * uy;
    }
  }

  car.forwardSpeed = carForwardSpeed(car);
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.vx = car.vx;
  player.vy = car.vy;

  if (input.wasPressed('KeyF') && Math.abs(car.forwardSpeed) <= CAR_TUNING.exitSpeed) exitCar(state);
}

/** Advance the player (and the car being driven) by one fixed step. */
export function updatePlayer(state, input, dt) {
  if (state.player.mode === 'car') updateDriving(state, input, dt);
  else updateOnFoot(state, input, dt);
}

/** Draw one car: shadow, turning front wheels, body, glass, lights and type details. */
export function drawCar(ctx, car) {
  const L = car.length;
  const W = car.width;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.fillStyle = 'rgba(18,22,18,0.28)';
  roundRectPath(ctx, -L / 2 + 5, -W / 2 + 7, L, W, 7);
  ctx.fill();
  ctx.rotate(car.angle);

  // Police light glow goes UNDER the body: drawn over it, the translucent red
  // phase washed the white cruiser pink and it read as a plain red car.
  if (car.police && car.lightsOn !== false) {
    const phase = (car.lightPhase ?? 0) % 1;
    ctx.fillStyle = phase < 0.5 ? 'rgba(255,59,48,0.20)' : 'rgba(59,130,246,0.20)';
    ctx.beginPath();
    ctx.arc(0, 0, W * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wheels; the front pair turns with the steering.
  ctx.fillStyle = '#17181c';
  const wheelW = 10;
  const wheelH = 5;
  const wx = L * 0.31;
  const wy = W / 2 - 1;
  ctx.fillRect(-wx - wheelW / 2, -wy - wheelH / 2, wheelW, wheelH);
  ctx.fillRect(-wx - wheelW / 2, wy - wheelH / 2, wheelW, wheelH);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(wx, side * wy);
    ctx.rotate(car.steer * 0.42);
    ctx.fillRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
    ctx.restore();
  }

  // Body and its lighter crown.
  roundRectPath(ctx, -L / 2, -W / 2, L, W, 6);
  ctx.fillStyle = car.color;
  ctx.fill();
  roundRectPath(ctx, -L / 2 + 3, -W / 2 + 3, L - 6, W - 6, 4);
  ctx.fillStyle = shadeColor(car.color, 1.1);
  ctx.fill();

  // Load bed for the pickup, a sign for the taxi.
  if (car.typeId === 'pickup') {
    ctx.fillStyle = shadeColor(car.color, 0.72);
    ctx.fillRect(-L / 2 + 4, -W / 2 + 4, L * 0.34, W - 8);
  }
  // Cabin glass, windshield and rear window.
  ctx.fillStyle = '#22303c';
  roundRectPath(ctx, -L * 0.1, -W * 0.37, L * 0.36, W * 0.74, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,200,225,0.75)';
  ctx.fillRect(L * 0.17, -W * 0.33, L * 0.07, W * 0.66);
  ctx.fillRect(-L * 0.13, -W * 0.33, L * 0.05, W * 0.66);
  // Roof panel between the glass.
  ctx.fillStyle = shadeColor(car.color, 1.16);
  roundRectPath(ctx, -L * 0.05, -W * 0.3, L * 0.17, W * 0.6, 3);
  ctx.fill();

  // Harbor PD livery: black door band, PD marks and a light bar whose red and blue
  // halves alternate with car.lightPhase (advanced by police.js; frozen in shots).
  if (car.police) {
    ctx.fillStyle = '#20242a';
    ctx.fillRect(-L * 0.08, -W / 2 + 2, L * 0.4, 4);
    ctx.fillRect(-L * 0.08, W / 2 - 6, L * 0.4, 4);
    ctx.fillStyle = '#20242a';
    ctx.font = `700 ${Math.round(W * 0.34)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PD', L * 0.02, 0);
    const phase = (car.lightPhase ?? 0) % 1;
    const redOn = phase < 0.5;
    ctx.fillStyle = '#2a2d33';
    roundRectPath(ctx, -8, -W * 0.33, 16, W * 0.66, 3);
    ctx.fill();
    ctx.fillStyle = redOn ? '#ff2d20' : '#8f1d16';
    roundRectPath(ctx, -7, -W * 0.31, 14, W * 0.29, 2);
    ctx.fill();
    ctx.fillStyle = redOn ? '#1d4f9e' : '#2f7bff';
    roundRectPath(ctx, -7, W * 0.02, 14, W * 0.29, 2);
    ctx.fill();
  }
  if (car.typeId === 'taxi') {
    ctx.fillStyle = '#fff3cf';
    roundRectPath(ctx, -4, -5, 9, 10, 2);
    ctx.fill();
    ctx.fillStyle = '#8a6d1c';
    ctx.fillRect(-4, -1, 9, 2);
  }

  // Lights: pale headlights at the nose, tail lights that flare under braking.
  ctx.fillStyle = '#fff3b8';
  ctx.beginPath();
  ctx.arc(L / 2 - 2, -W * 0.31, 2.3, 0, Math.PI * 2);
  ctx.arc(L / 2 - 2, W * 0.31, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = car.braking ? '#ff5040' : '#c23a30';
  ctx.fillRect(-L / 2, -W * 0.34, 3, 4.4);
  ctx.fillRect(-L / 2, W * 0.34 - 4.4, 3, 4.4);

  roundRectPath(ctx, -L / 2, -W / 2, L, W, 6);
  ctx.strokeStyle = 'rgba(10,12,14,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Draw Marlo on foot: a shadow, swinging arms, a teal jacket and a cap of dark hair. */
export function drawPlayer(ctx, player) {
  if (player.mode === 'car') return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = 'rgba(18,22,18,0.25)';
  ctx.beginPath();
  ctx.ellipse(3, 5, 11, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(player.angle);
  const swing = Math.sin(player.walkPhase) * 3;
  // Legs in step.
  ctx.fillStyle = PLAYER.pants;
  roundRectPath(ctx, -8, -7 + swing * 0.4, 7, 5, 2);
  ctx.fill();
  roundRectPath(ctx, -8, 2 - swing * 0.4, 7, 5, 2);
  ctx.fill();
  // Arms swinging against the legs.
  ctx.fillStyle = shadeColor(PLAYER.jacket, 0.8);
  ctx.beginPath();
  ctx.arc(2 - swing * 0.5, -10, 3.2, 0, Math.PI * 2);
  ctx.arc(2 + swing * 0.5, 10, 3.2, 0, Math.PI * 2);
  ctx.fill();
  // Torso and head.
  ctx.fillStyle = PLAYER.jacket;
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PLAYER.skin;
  ctx.beginPath();
  ctx.arc(1.5, 0, 5.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PLAYER.hair;
  ctx.beginPath();
  ctx.arc(-0.5, 0, 4.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
