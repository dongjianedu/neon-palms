// Boot and the one loop for NEON PALMS. The world advances in fixed 1/60 s steps (several
// in a slow frame, none in a fast one) and the renderer paints what is there. Three
// screens: title (with Continue / New Game when a save exists), play, and a pause menu
// (Resume / Save / Restart). The missions module runs Delia Vance's story and the side
// work; the HUD draws over play; the save store persists cash, progress, position and
// the mute setting — on job completion, from the pause menu, and every 20 seconds.
//
// ?seed=N fixes the city's generation. ?shot=start|play|chase|end (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady.
import { CAMERA, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createCar, createPlayer, updatePlayer } from './player.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { applySaveData, buildSaveData, createSaveStore } from './save.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { drawParticles, updateParticles } from './particles.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;
const AUTOSAVE_EVERY = 20; // Seconds of play between quiet autosaves.

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

const player = createPlayer(world);
// Traffic owns the one vehicle registry: Marlo's coupe first (shots.js expects it at
// cars[0]), then the parked cars, then AI traffic as it spawns. state.cars aliases it.
const traffic = createTraffic(world, createRandom(seed ^ 0x9e3779b9));
traffic.addVehicle(createCar({
  typeId: 'coupe',
  color: '#12b5a5',
  x: world.carSpawn.x,
  y: world.carSpawn.y,
  angle: world.carSpawn.angle,
}));
traffic.populateParked();
const pedestrians = createPedestrians(world, traffic, createRandom(seed ^ 0x51ab3f));
const police = createPolice(world, traffic, createRandom(seed ^ 0x77aa11));
const combat = createCombat(world, traffic, pedestrians, police, createRandom(seed ^ 0x33cc55));
const audio = createAudio();
const missions = createMissions(world, traffic, police, createRandom(seed ^ 0x44dd66), {
  payout: () => audio.payout(),
  jingle: () => audio.jingle(),
  sting: () => audio.sting(),
});
const hud = createHud();
const saveStore = createSaveStore();
let saveData = saveStore.load();
if (saveData) audio.setMuted(saveData.muted);

const state = {
  world,
  player,
  cars: traffic.vehicles,
  traffic,
  pedestrians,
  police,
  combat,
  missions,
  audio,
  camera: { x: player.x, y: player.y, zoom: 1 },
  screen: SCREEN_TITLE,
  time: 0,
  tint: null,
  seed,
  viewport: { w: 1280, h: 720 },
  pendingAnnounce: null,
  missionBanner: null,
  needsSave: false,
  inputRef: null,
};

/**
 * Paint the particle pool in the world layer: the same camera transform the renderer
 * just used, reapplied over its finished frame, so sparks and smoke sit in the world
 * (over the entities, under the HUD) rather than floating with the screen.
 */
function drawWorldParticles() {
  const cam = state.camera;
  const { w, h } = renderer.size();
  const ctx = renderer.ctx;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  drawParticles(ctx);
  ctx.restore();
}

function runShot(name) {
  state.viewport = renderer.size();
  const screen = stageShot(name, state);
  let painted = 0;
  function paint() {
    renderer.draw(state);
    drawWorldParticles();
    if (screen === SCREEN_PLAY) {
      hud.draw(renderer.ctx, state);
      combat.drawScreen(renderer.ctx, state);
    }
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  state.inputRef = input;
  let accumulator = 0;
  let last = performance.now();
  let titleSel = 0;
  let pauseSel = 0;
  let saveTimer = 0;

  function announce(message) {
    status.textContent = message;
  }

  function saveGame() {
    if (saveStore.store(buildSaveData(state))) saveData = saveStore.load();
  }

  function startGame() {
    state.screen = SCREEN_PLAY;
    announce('Playing. Marlo is on the promenade in Palm Beach.');
  }

  // M is not one of input.js's tracked keys, so the mute toggle listens for itself.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat) {
      const nowMuted = audio.toggleMute();
      announce(nowMuted ? 'Sound off.' : 'Sound on.');
      state.needsSave = true;
    }
  });

  function handleActions() {
    const actions = input.takeActions();
    const navUp = input.wasPressed('ArrowUp') || input.wasPressed('KeyW');
    const navDown = input.wasPressed('ArrowDown') || input.wasPressed('KeyS');

    if (state.screen === SCREEN_TITLE) {
      const count = saveData ? 2 : 1;
      if (navUp || navDown) {
        titleSel = (titleSel + (navUp ? count - 1 : 1)) % count;
        audio.click();
      }
      if (actions & ACTION_CONFIRM) {
        if (saveData && titleSel === 0) {
          applySaveData(state, saveData);
          announce('Welcome back to Sunfall City.');
        } else {
          if (saveData) { saveStore.clear(); saveData = null; }
          announce('A new day in Sunfall City.');
        }
        startGame();
      }
      return;
    }

    if (state.screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        state.screen = SCREEN_PAUSED;
        pauseSel = 0;
        announce('Paused.');
      }
      return;
    }

    if (state.screen === SCREEN_PAUSED) {
      if (actions & ACTION_PAUSE) {
        state.screen = SCREEN_PLAY;
        announce('Playing.');
        return;
      }
      if (navUp || navDown) {
        pauseSel = (pauseSel + (navUp ? 2 : 1)) % 3;
        audio.click();
      }
      if (actions & ACTION_CONFIRM) {
        if (pauseSel === 0) {
          state.screen = SCREEN_PLAY;
          announce('Playing.');
        } else if (pauseSel === 1) {
          saveGame();
          announce('Game saved.');
        } else {
          saveStore.clear();
          window.location.reload();
        }
      }
    }
  }

  function step() {
    state.time += STEP;
    audio.update(state, STEP);
    if (state.screen === SCREEN_TITLE) {
      // A slow pan along the waterfront while the title is up.
      state.camera.x = world.width / 2 + Math.sin(state.time * 0.045) * (world.width / 2 - 700);
      state.camera.y = world.cityHeight - 430 + Math.cos(state.time * 0.03) * 110;
      state.camera.zoom = CAMERA.titleZoom;
      return;
    }
    if (state.screen !== SCREEN_PLAY) return;
    // The city lives around the player: he moves first, then traffic (which brakes for
    // pedestrians), then the crowd, then Harbor PD, then combat — and finally the
    // missions, which read the step's outcomes (a bust or a wasting ends a job) and
    // hand out the next objective.
    updatePlayer(state, input, STEP);
    traffic.update(state, STEP);
    pedestrians.update(state, STEP);
    police.update(state, STEP);
    combat.update(state, input, STEP);
    missions.update(state, input, STEP);
    updateParticles(STEP);
    if (state.pendingAnnounce) {
      announce(state.pendingAnnounce);
      if (state.pendingAnnounce.startsWith('BUSTED') || state.pendingAnnounce.startsWith('WASTED')) {
        hud.notify(state, state.pendingAnnounce.split(' — ')[0]);
        audio.sting();
      }
      state.pendingAnnounce = null;
    }
    if (state.needsSave) {
      state.needsSave = false;
      saveGame();
    }
    saveTimer += STEP;
    if (saveTimer >= AUTOSAVE_EVERY) {
      saveTimer = 0;
      saveGame();
    }
    renderer.updateCamera(state, STEP);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (state.screen === SCREEN_PAUSED) {
      accumulator = 0;
      audio.update(state, 0); // Settle the continuous voices to silence under the menu.
    } else {
      while (accumulator >= STEP) {
        step();
        accumulator -= STEP;
      }
    }
    state.viewport = renderer.size();
    renderer.draw(state);
    drawWorldParticles();
    if (state.screen === SCREEN_PLAY) {
      hud.draw(renderer.ctx, state);
      combat.drawScreen(renderer.ctx, state);
    } else if (state.screen === SCREEN_PAUSED) {
      hud.drawPauseMenu(renderer.ctx, state, pauseSel);
    } else if (state.screen === SCREEN_TITLE && saveData) {
      hud.drawTitleMenu(renderer.ctx, state, titleSel, saveData);
    }
    input.endFrame();
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === SCREEN_PLAY) {
      state.screen = SCREEN_PAUSED;
      pauseSel = 0;
      announce('Paused.');
    }
  });

  announce('Neon Palms. Press Enter to play.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
