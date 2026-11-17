// Saving: one JSON record in localStorage under config's SAVE_KEY — Marlo's cash, the
// story progress and respect the missions module owns, where he is standing (or what he
// is driving), and the audio mute setting. main.js builds the record from live state,
// this module only stores, loads and validates it. Loading is defensive on purpose: a
// missing key, a truncated write or a record from some other version all come back as
// "no save", and the game starts fresh rather than trusting half a record.
import { SAVE_KEY } from './config.js';

/** The save format version; a record with any other version is ignored. */
export const SAVE_VERSION = 1;

/**
 * A save store over a Storage-like object. Defaults to window.localStorage where there
 * is one; tests (and cautious browsers) can hand in any {getItem,setItem,removeItem}.
 * Every method is failure-proof: storage that throws reads as empty and writes vanish.
 */
export function createSaveStore(storage) {
  let store = storage ?? null;
  if (!store) {
    try {
      store = typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      store = null; // Even naming localStorage can throw in locked-down browsers.
    }
  }

  function raw() {
    if (!store) return null;
    try {
      return store.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  }

  /** The validated save record, or null when there is nothing trustworthy to load. */
  function load() {
    const text = raw();
    if (!text) return null;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) return null;
    const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
    const progress = data.progress && typeof data.progress === 'object' ? data.progress : {};
    const place = data.player && typeof data.player === 'object' ? data.player : {};
    return {
      version: SAVE_VERSION,
      cash: Math.max(0, Math.round(num(data.cash, 250))),
      progress: {
        storyIndex: Math.max(0, Math.floor(num(progress.storyIndex, 0))),
        respect: Math.max(0, Math.floor(num(progress.respect, 0))),
        fares: Math.max(0, Math.floor(num(progress.fares, 0))),
        deliveries: Math.max(0, Math.floor(num(progress.deliveries, 0))),
        storyDone: progress.storyDone === true,
      },
      player: {
        x: num(place.x, NaN),
        y: num(place.y, NaN),
        mode: place.mode === 'car' ? 'car' : 'foot',
      },
      muted: data.muted === true,
    };
  }

  return {
    load,
    /** Is there a save worth offering Continue for? */
    hasSave() {
      return load() !== null;
    },
    /** Write a record built by main.js. Returns true when it landed. */
    store(data) {
      if (!store || !data) return false;
      try {
        store.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
        return true;
      } catch {
        return false;
      }
    },
    /** Forget the record (New Game from the title, Restart from the pause menu). */
    clear() {
      if (!store) return;
      try {
        store.removeItem(SAVE_KEY);
      } catch {
        // Nothing to forget if the store itself is unreachable.
      }
    },
  };
}

/**
 * Build the save record from the live game state: cash and position off the player,
 * progress off the missions module, the mute flag off the audio system.
 */
export function buildSaveData(state) {
  const { player, missions, audio } = state;
  return {
    cash: Math.max(0, Math.round(player.cash)),
    progress: {
      storyIndex: missions.progress.storyIndex,
      respect: missions.progress.respect,
      fares: missions.progress.fares,
      deliveries: missions.progress.deliveries,
      storyDone: missions.progress.storyDone,
    },
    player: { x: Math.round(player.x), y: Math.round(player.y), mode: player.mode },
    muted: audio ? audio.muted : false,
  };
}

/**
 * Apply a loaded record to a fresh state: cash and progress land outright; the player
 * is put back where he stood (on foot — a driven car is not resurrected, Marlo simply
 * wakes up standing where he left it), and the mute setting is restored.
 */
export function applySaveData(state, data) {
  const { player, missions, audio, world } = state;
  player.cash = data.cash;
  missions.progress.storyIndex = data.progress.storyIndex;
  missions.progress.respect = data.progress.respect;
  missions.progress.fares = data.progress.fares;
  missions.progress.deliveries = data.progress.deliveries;
  missions.progress.storyDone = data.progress.storyDone;
  if (Number.isFinite(data.player.x) && Number.isFinite(data.player.y)
    && data.player.x >= 0 && data.player.x < world.width
    && data.player.y >= 0 && data.player.y < world.height
    && !world.circleBlocked(data.player.x, data.player.y, 12)) {
    player.x = data.player.x;
    player.y = data.player.y;
  }
  if (audio) audio.setMuted(data.muted);
}
