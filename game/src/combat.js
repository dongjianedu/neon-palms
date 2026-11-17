// Combat: Marlo's pistol, the damage it does, the damage Harbor PD does back, and what
// happens when Marlo runs out of health. Shooting is hitscan from the player toward the
// mouse (converted from screen to world through the camera): a tracer, a muzzle flash
// and impact sparks are kept as short-lived effects this module draws in screen space
// after the world. Shots can drop pedestrians (which the crowd sees, and the police
// price as gunfire plus extra heat for a kill), smash cars (smoke as damage mounts, a
// popped tyre that halves a car's pace) and hit cruisers. At three stars and up,
// cruisers with line of sight shoot back at a Marlo on foot. Hard crashes hurt too.
// Health reaching zero is WASTED: a hospital fee, a cleared wanted level, and Marlo
// wakes up outside Sunfall General.
import { emitCrime } from './traffic.js';

const FIRE_INTERVAL = 0.145; // Seconds between pistol shots while the trigger is held.
const RANGE = 540;
const PED_HIT_RADIUS = 13;
const KILL_HEAT = 25; // Extra heat on top of the gunfire crime when a shot drops someone.
const RETURN_FIRE_MIN_STARS = 3;
const RETURN_FIRE_RANGE = 390;
const RETURN_FIRE_DPS = 10;
const CRASH_SAFE_DELTA = 130; // Speed loss in one step below this is just a scrape.
const REGEN_DELAY = 6;
const REGEN_RATE = 3;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function lineBlocked(world, x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.floor(dist / 22));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (world.circleBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2)) return true;
  }
  return false;
}

/**
 * The combat system. Needs the world (cover), the traffic registry (cars to hit and the
 * crime emitter), the crowd (people to hit), the police (heat and wanted level) and a
 * seeded rng for tyre pops and smoke.
 */
export function createCombat(world, traffic, pedestrians, police, rng) {
  /** Short-lived screen-drawn effects: tracers, flashes, sparks, smoke, hit markers. */
  const effects = [];
  let cooldown = 0;
  let sinceDamage = REGEN_DELAY;
  let hurtFlash = 0; // 0..1 red pulse when Marlo takes damage.
  let hurtDir = 0; // World angle the last damage came from.
  let prevCarSpeed = 0;

  const hospital = world.pois.find((poi) => poi.kind === 'hospital') ?? { x: world.playerSpawn.x, y: world.playerSpawn.y };

  /** Hurt Marlo. `fromAngle` is the world direction the damage came from, if known. */
  function damagePlayer(state, amount, fromAngle) {
    const { player } = state;
    if (player.health <= 0) return;
    player.health = Math.max(0, player.health - amount);
    sinceDamage = 0;
    hurtFlash = Math.min(1, hurtFlash + 0.45);
    if (Number.isFinite(fromAngle)) hurtDir = fromAngle;
  }

  /** WASTED: hospital fee, wanted cleared, wake up outside Sunfall General. */
  function wastePlayer(state) {
    const { player } = state;
    const fee = Math.max(25, Math.round(player.cash * 0.05));
    player.cash = Math.max(0, player.cash - fee);
    if (player.mode === 'car' && player.car) {
      player.car.occupied = false;
      player.car = null;
      player.mode = 'foot';
    }
    police.clearWanted();
    player.x = hospital.x;
    player.y = hospital.y + 26;
    player.vx = 0;
    player.vy = 0;
    player.angle = Math.PI / 2;
    player.health = player.maxHealth;
    hurtFlash = 0;
    state.pendingAnnounce = `WASTED — Sunfall General patched Marlo up for $${fee}.`;
  }

  /** One pistol shot from Marlo toward the aim point; resolves the first thing it meets. */
  function fireShot(state, aimX, aimY) {
    const { player } = state;
    const dx = aimX - player.x;
    const dy = aimY - player.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    emitCrime('gunfire', player.x, player.y, {});
    pedestrians.notifyGunfire(player.x, player.y);

    // March the ray: buildings stop it, then the nearest ped or car along it wins.
    let endT = RANGE;
    for (let t = 12; t < RANGE; t += 9) {
      if (world.circleBlocked(player.x + ux * t, player.y + uy * t, 2)) { endT = t; break; }
    }
    let hitPed = null;
    let hitCar = null;
    for (const ped of pedestrians.list) {
      if (ped.mode === 'down') continue;
      const rx = ped.x - player.x;
      const ry = ped.y - player.y;
      const along = rx * ux + ry * uy;
      if (along < 8 || along > endT) continue;
      const lat = Math.abs(-rx * uy + ry * ux);
      if (lat < PED_HIT_RADIUS) { hitPed = ped; endT = along; }
    }
    for (const car of traffic.vehicles) {
      if (car === player.car) continue;
      const rx = car.x - player.x;
      const ry = car.y - player.y;
      const along = rx * ux + ry * uy;
      if (along < 8 || along > endT + car.length / 2) continue;
      const cos = Math.cos(-car.angle);
      const sin = Math.sin(-car.angle);
      const lx = rx * cos - ry * sin;
      const ly = rx * sin + ry * cos;
      if (Math.abs(lx) < car.length / 2 + 4 && Math.abs(ly) < car.width / 2 + 4) {
        if (along < endT + car.length / 2) { hitCar = car; hitPed = null; endT = Math.max(10, along - car.length / 2); }
      }
    }

    const endX = player.x + ux * endT;
    const endY = player.y + uy * endT;
    effects.push({ kind: 'tracer', x1: player.x + ux * 14, y1: player.y + uy * 14, x2: endX, y2: endY, t: 0.07, max: 0.07 });
    effects.push({ kind: 'flash', x: player.x + ux * 16, y: player.y + uy * 16, t: 0.05, max: 0.05 });
    effects.push({ kind: 'sparks', x: endX, y: endY, t: 0.16, max: 0.16 });

    if (hitPed) {
      hitPed.mode = 'down';
      hitPed.downT = 7;
      police.addHeat(KILL_HEAT, hitPed.x, hitPed.y);
      effects.push({ kind: 'hit', x: hitPed.x, y: hitPed.y, t: 0.3, max: 0.3 });
    } else if (hitCar) {
      hitCar.damage = (hitCar.damage ?? 0) + 1;
      if (hitCar.damage >= 2 && !hitCar.tirePopped && rng.chance(0.4)) {
        hitCar.tirePopped = true;
        const driver = traffic.drivers.find((d) => d.car === hitCar);
        if (driver) driver.cruise *= 0.5;
      }
      if (hitCar.police) police.addHeat(15, hitCar.x, hitCar.y);
    }
  }

  /** Advance combat one fixed step: trigger, return fire, crash damage, regen, effects. */
  function update(state, input, dt) {
    const { player } = state;
    cooldown -= dt;
    sinceDamage += dt;
    hurtFlash = Math.max(0, hurtFlash - dt * 2.4);
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      effects[i].t -= dt;
      if (effects[i].t <= 0) effects.splice(i, 1);
    }
    // Damaged AI and police cars trail smoke.
    if (rng.chance(dt * 6)) {
      for (const car of traffic.vehicles) {
        if ((car.damage ?? 0) >= 3 && Math.hypot(car.x - player.x, car.y - player.y) < 700) {
          effects.push({ kind: 'smoke', x: car.x, y: car.y - 6, t: 0.7, max: 0.7 });
          break;
        }
      }
    }

    if (player.health <= 0) { wastePlayer(state); return; }

    // Marlo's pistol: on foot only, aimed with the mouse through the camera.
    if (player.mode === 'foot' && input.mouse?.down && cooldown <= 0 && state.screen === 'play') {
      const cam = state.camera;
      const view = state.viewport ?? { w: 1280, h: 720 };
      const aimX = cam.x + (input.mouse.x - view.w / 2) / cam.zoom;
      const aimY = cam.y + (input.mouse.y - view.h / 2) / cam.zoom;
      fireShot(state, aimX, aimY);
      cooldown = FIRE_INTERVAL;
    }

    // Police return fire: three stars up, Marlo on foot, a cruiser close with a clean
    // line — damage accrues steadily and the HUD flashes the direction it comes from.
    if (police.stars >= RETURN_FIRE_MIN_STARS && player.mode === 'foot') {
      for (const unit of police.units) {
        const d = Math.hypot(unit.car.x - player.x, unit.car.y - player.y);
        if (d > RETURN_FIRE_RANGE) continue;
        if (lineBlocked(world, unit.car.x, unit.car.y, player.x, player.y)) continue;
        damagePlayer(state, RETURN_FIRE_DPS * dt, Math.atan2(unit.car.y - player.y, unit.car.x - player.x));
        if (rng.chance(dt * 5)) {
          effects.push({ kind: 'tracer', x1: unit.car.x, y1: unit.car.y, x2: player.x, y2: player.y, t: 0.06, max: 0.06, hostile: true });
        }
        break;
      }
    }

    // Crash damage: a sudden loss of forward speed in the car means a hard impact.
    if (player.mode === 'car' && player.car) {
      const speed = Math.abs(player.car.forwardSpeed ?? 0);
      const delta = prevCarSpeed - speed;
      if (delta > CRASH_SAFE_DELTA) damagePlayer(state, (delta - CRASH_SAFE_DELTA) * 0.16, player.angle + Math.PI);
      prevCarSpeed = speed;
    } else {
      prevCarSpeed = 0;
    }

    // Slow recovery once the shooting stops.
    if (sinceDamage > REGEN_DELAY && player.health > 0 && player.health < player.maxHealth) {
      player.health = Math.min(player.maxHealth, player.health + REGEN_RATE * dt);
    }
  }

  /**
   * Draw the screen-space layer after the HUD: tracers and flashes (converted from world
   * through the camera), the low-health / recent-damage red vignette, and a wedge
   * pointing toward whoever last shot Marlo.
   */
  function drawScreen(ctx, state) {
    const cam = state.camera;
    const view = state.viewport ?? { w: 1280, h: 720 };
    const toScreenX = (wx) => (wx - cam.x) * cam.zoom + view.w / 2;
    const toScreenY = (wy) => (wy - cam.y) * cam.zoom + view.h / 2;
    ctx.save();
    for (const fx of effects) {
      const a = clamp(fx.t / fx.max, 0, 1);
      if (fx.kind === 'tracer') {
        ctx.strokeStyle = fx.hostile ? `rgba(255,90,70,${0.75 * a})` : `rgba(255,220,130,${0.8 * a})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toScreenX(fx.x1), toScreenY(fx.y1));
        ctx.lineTo(toScreenX(fx.x2), toScreenY(fx.y2));
        ctx.stroke();
      } else if (fx.kind === 'flash') {
        ctx.fillStyle = `rgba(255,190,60,${0.85 * a})`;
        ctx.beginPath();
        ctx.arc(toScreenX(fx.x), toScreenY(fx.y), 7 * a + 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'sparks') {
        ctx.fillStyle = `rgba(255,170,80,${0.9 * a})`;
        for (let i = 0; i < 4; i += 1) {
          const ang = i * 1.7 + fx.max * 20;
          ctx.fillRect(toScreenX(fx.x) + Math.cos(ang) * 6 * (1 - a), toScreenY(fx.y) + Math.sin(ang) * 6 * (1 - a), 2.4, 2.4);
        }
      } else if (fx.kind === 'hit') {
        ctx.strokeStyle = `rgba(255,70,50,${a})`;
        ctx.lineWidth = 2;
        const sx = toScreenX(fx.x);
        const sy = toScreenY(fx.y);
        ctx.beginPath();
        ctx.moveTo(sx - 6, sy - 6); ctx.lineTo(sx + 6, sy + 6);
        ctx.moveTo(sx + 6, sy - 6); ctx.lineTo(sx - 6, sy + 6);
        ctx.stroke();
      } else if (fx.kind === 'smoke') {
        ctx.fillStyle = `rgba(40,40,44,${0.35 * a})`;
        ctx.beginPath();
        ctx.arc(toScreenX(fx.x), toScreenY(fx.y) - (1 - a) * 22, 6 + (1 - a) * 9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const { player } = state;
    const lowHealth = player.health < 32 ? (32 - player.health) / 32 : 0;
    const vignette = Math.max(lowHealth * 0.55, hurtFlash * 0.5);
    if (vignette > 0.01) {
      const grad = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.34, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.72);
      grad.addColorStop(0, 'rgba(190,20,10,0)');
      grad.addColorStop(1, `rgba(190,20,10,${vignette})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (hurtFlash > 0.25) {
      // A wedge at the screen edge pointing back toward the shooter.
      const sx = view.w / 2 + Math.cos(hurtDir) * 92;
      const sy = view.h / 2 + Math.sin(hurtDir) * 92;
      ctx.fillStyle = `rgba(255,60,40,${(hurtFlash - 0.25) * 0.9})`;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(hurtDir);
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-8, -11);
      ctx.lineTo(-8, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  return { update, drawScreen, damagePlayer, effects };
}
