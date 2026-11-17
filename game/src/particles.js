// Particles: the cheap confetti of Sunfall City — muzzle-flash glow, impact sparks,
// tyre smoke and cash sparkles. One pooled array in world space; main.js updates it
// every step and paints it in the world layer, over the entities and under the HUD.
// Spawners are fire-and-forget and silently drop once the pool is full, so a busy
// chase can never make the effect layer the bottleneck. Combat, traffic and missions
// call the spawners; nothing else needs to know the pool exists.
const MAX_PARTICLES = 300;

// A tiny deterministic generator (mulberry32, the same shape as random.js) so staged
// scenes scatter the same way every run; particles never touch the world's own rng.
let seed = 0x51ab3f;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const pool = [];

function push(p) {
  if (pool.length >= MAX_PARTICLES) return;
  pool.push(p);
}

/** A short-lived glow at a gun muzzle: one bright core that swells and is gone. */
export function spawnFlash(x, y) {
  push({ kind: 'flash', x, y, vx: 0, vy: 0, t: 0.09, max: 0.09, size: 13 });
}

/** A spray of hot sparks flying off an impact point. */
export function spawnSparks(x, y, n = 6) {
  for (let i = 0; i < n; i += 1) {
    const ang = rnd() * Math.PI * 2;
    const speed = 40 + rnd() * 130;
    const life = 0.22 + rnd() * 0.25;
    push({
      kind: 'spark', x, y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      t: life, max: life, size: 1.6 + rnd() * 1.6,
    });
  }
}

/** Soft grey puffs that grow and drift up: tyre smoke, tired engines, hard stops. */
export function spawnSmoke(x, y, n = 3) {
  for (let i = 0; i < n; i += 1) {
    const life = 0.55 + rnd() * 0.5;
    push({
      kind: 'smoke',
      x: x + (rnd() - 0.5) * 8, y: y + (rnd() - 0.5) * 8,
      vx: (rnd() - 0.5) * 14, vy: -12 - rnd() * 16,
      t: life, max: life, size: 5 + rnd() * 6,
    });
  }
}

/** Gold motes that pop and drift down when money lands in Marlo's pocket. */
export function spawnSparkle(x, y, n = 10) {
  for (let i = 0; i < n; i += 1) {
    const ang = rnd() * Math.PI * 2;
    const speed = 18 + rnd() * 46;
    const life = 0.5 + rnd() * 0.4;
    push({
      kind: 'sparkle',
      x, y: y - 6,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 26,
      t: life, max: life, size: 1.8 + rnd() * 1.8,
    });
  }
}

/** Advance every live particle one step; the dead are swapped out of the pool. */
export function updateParticles(dt) {
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const p = pool[i];
    p.t -= dt;
    if (p.t <= 0) {
      pool[i] = pool[pool.length - 1];
      pool.pop();
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === 'spark') { p.vx *= 0.86; p.vy *= 0.86; }
    if (p.kind === 'sparkle') p.vy += 60 * dt; // Motes settle back down.
  }
}

/** Paint the pool in world space: smoke normally, the glows additively on top. */
export function drawParticles(ctx) {
  if (pool.length === 0) return;
  for (const p of pool) {
    if (p.kind !== 'smoke') continue;
    const a = Math.max(0, p.t / p.max);
    ctx.fillStyle = `rgba(52,52,58,${0.30 * a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size + (1 - a) * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of pool) {
    const a = Math.max(0, p.t / p.max);
    if (p.kind === 'spark') {
      ctx.fillStyle = `rgba(255,176,84,${0.9 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'flash') {
      ctx.fillStyle = `rgba(255,196,80,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,240,200,${0.9 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'sparkle') {
      ctx.fillStyle = `rgba(255,214,90,${0.95 * a})`;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.restore();
}

/** Live particle count, for the headless smoke tests. */
export function particleCount() {
  return pool.length;
}
