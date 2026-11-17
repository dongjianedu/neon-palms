// Seeded randomness. One generator per world build (and per staged scene) keeps the city
// identical for a given seed, which the screenshot scenes rely on. The generator is
// mulberry32: tiny, fast and good enough for placement jitter.

/**
 * Create a seeded generator. The returned object is the only source of randomness the
 * world builder uses, so a whole city can be reproduced from its seed alone.
 */
export function createRandom(seed) {
  let a = seed >>> 0;
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    /** Next float in [0, 1). */
    next,
    /** Float in [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    /** Integer in [min, max], both ends included. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** One element of `items`, chosen uniformly. */
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    /** True with probability `p`. */
    chance(p) {
      return next() < p;
    },
    /** -1 or 1, like a coin flip. */
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
  };
}

/**
 * A deterministic 2D hash in [0, 1), for decoration that must look random but stay put
 * between frames (roof details, sand speckle, water glints) without storing anything.
 */
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
