// Screenshot staging harness for NEON PALMS. The built-in shot painter (game/src/shots.js)
// only knows four frozen scenes; the new screenshot set needs states it cannot express —
// a four-star chase with a live mission objective, an open dialogue box, a pistol shot
// caught mid-flight, a dusk drive on Ocean Drive. This page assembles the exact state
// main.js assembles (same modules, same seeded generators, same creation order), stages
// one scene through the game's own hooks (missions.startStory, police.setHeat/stageUnit,
// combat.update with a scripted mouse, the particle spawners), then paints it exactly the
// way main.js's runShot paints: renderer, world particles, HUD, combat screen layer.
// Nothing here draws anything of its own; every pixel is the game's renderer at work.
// Usage: stage.html?scene=cover|mission|combat|beach&seed=N
import { GRID, STEP } from '../game/src/config.js';
import { createRandom } from '../game/src/random.js';
import { createWorld } from '../game/src/world.js';
import { createCar, createPlayer } from '../game/src/player.js';
import { createTraffic } from '../game/src/traffic.js';
import { createPedestrians } from '../game/src/pedestrians.js';
import { createPolice } from '../game/src/police.js';
import { createCombat } from '../game/src/combat.js';
import { createMissions } from '../game/src/missions.js';
import { createHud } from '../game/src/hud.js';
import { createAudio } from '../game/src/audio.js';
import { createRenderer, SCREEN_PLAY } from '../game/src/render.js';
import { drawParticles, spawnSmoke, updateParticles } from '../game/src/particles.js';

const params = new URLSearchParams(window.location.search);
const scene = params.get('scene') ?? 'cover';
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

// --- State assembly, mirroring game/src/main.js line for line -------------------------
const canvas = document.getElementById('game');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

const player = createPlayer(world);
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
  screen: SCREEN_PLAY,
  time: 10, // The same frozen clock shots.js uses: animations hold mid-beat.
  tint: null,
  seed,
  viewport: { w: 1280, h: 720 },
  pendingAnnounce: null,
  missionBanner: null,
  needsSave: false,
  inputRef: null,
};

const vRoads = world.roads.vertical;
const hRoads = world.roads.horizontal;
const PRESS_E = { wasPressed: (code) => code === 'KeyE' };
const NO_INPUT = { wasPressed: () => false };

/** Put Marlo in his coupe at (x, y), nose along `angle`; speed is applied later. */
function driveFrom(x, y, angle) {
  const car = state.cars[0];
  car.x = x;
  car.y = y;
  car.angle = angle;
  car.occupied = true;
  player.mode = 'car';
  player.car = car;
  player.x = x;
  player.y = y;
  player.angle = angle;
  return car;
}

/** Give a car a rolling velocity along its nose (renderer dressing; nothing steps it). */
function roll(car, speed) {
  car.vx = Math.cos(car.angle) * speed;
  car.vy = Math.sin(car.angle) * speed;
  car.forwardSpeed = speed;
}

/** Settle the crowd around Marlo: a few pedestrian steps while every car stands still. */
function crowd(steps = 3) {
  for (let i = 0; i < steps; i += 1) pedestrians.update(state, STEP);
}

/** A staged cruiser with its light bar lit at a chosen phase. */
function cruiser(x, y, angle, phase) {
  const unit = police.stageUnit(state, x, y, angle);
  if (unit) {
    unit.car.lightPhase = phase;
    unit.car.lightsOn = true;
  }
  return unit;
}

// --- Scenes -----------------------------------------------------------------------------
function sceneCover() {
  // Four stars up Sunfall Boulevard: Marlo northbound at full tilt, two cruisers on his
  // tail and a third across the southbound lane ahead, a live story objective on the HUD.
  const avenue = vRoads[4].x + GRID.laneOff;
  const y = hRoads[3].y - 170;
  const car = driveFrom(avenue, y, -Math.PI / 2);

  missions.startStory(state);
  for (let i = 0; i < 3; i += 1) missions.update(state, PRESS_E, STEP); // Hear Delia out.
  player.cash = 515;

  police.setHeat(450); // Four stars, held for the frame.
  cruiser(avenue, y + 128, -Math.PI / 2, 0.12);
  cruiser(vRoads[4].x - GRID.laneOff + 8, y + 235, -Math.PI / 2, 0.62);
  const blocker = cruiser(vRoads[4].x - GRID.laneOff, y - 245, Math.PI / 2, 0.3);
  if (blocker) blocker.mode = 'block';

  const sedan = createCar({ typeId: 'sedan', color: '#8c2f39', x: avenue, y: y - 215, angle: -Math.PI / 2 });
  const taxi = createCar({ typeId: 'taxi', color: '#ffb81c', x: vRoads[4].x - GRID.laneOff, y: y - 140, angle: Math.PI / 2 });
  state.cars.push(sedan, taxi);

  crowd();
  roll(car, 262);
  roll(sedan, 180);
  roll(taxi, 150);
  // Tyre smoke off Marlo's rear tyres, aged a beat so it reads as a trail, not a puff.
  spawnSmoke(car.x - 9, car.y + 22, 3);
  spawnSmoke(car.x + 9, car.y + 40, 3);
  spawnSmoke(car.x, car.y + 68, 3);
  updateParticles(0.22);

  state.camera.x = car.x;
  state.camera.y = car.y + 34;
  state.camera.zoom = 1;
}

function sceneMission() {
  // On foot outside The Salty Palm Diner, Delia Vance mid-pitch: dialogue box open, the
  // job title and objective across the top, the crowd of the marina drifting past.
  const diner = world.pois.find((p) => p.kind === 'diner');
  player.mode = 'foot';
  player.car = null;
  player.x = diner.x + 4;
  player.y = diner.y + 46;
  player.angle = -Math.PI / 2; // Facing the diner door.
  const car = state.cars[0];
  car.x = diner.x + 128;
  car.y = diner.y + 52;
  car.angle = 0;
  car.occupied = false;

  missions.startStory(state); // Phase 'dialogue': Delia's first line is on screen.

  crowd();
  state.camera.x = player.x - 8;
  state.camera.y = player.y - 34;
  state.camera.zoom = 0.95;
}

function sceneCombat() {
  // A foot gunfight at the Sunfall Boulevard intersection: Marlo fires across the
  // cruiser covering him from the tower kerb — the shot streaks past its nose and
  // bursts on the tower face at its tail (combat.js's car test only registers at
  // point-blank range, so a ranged car hit cannot be staged honestly; the building
  // impact right behind the cruiser is what the game itself computes). Three stars.
  player.mode = 'foot';
  player.car = null;
  player.x = 1935;
  player.y = 1330;
  player.angle = Math.atan2(1245 - 1330, 1990 - 1935); // Facing the lead cruiser.
  player.health = 58;
  const car = state.cars[0];
  car.x = vRoads[5].x - GRID.roadW / 2 + 16;
  car.y = 1360;
  car.angle = -Math.PI / 2;
  car.occupied = false;

  police.setHeat(300); // Three stars.
  const lead = cruiser(1990, 1245, Math.atan2(1330 - 1245, 1935 - 1990), 0.1);
  cruiser(vRoads[4].x - GRID.laneOff, 1480, -Math.PI / 2, 0.55);

  crowd();
  state.camera.x = player.x;
  state.camera.y = player.y;
  state.camera.zoom = 1;

  // One scripted trigger pull, aimed through the camera at the lead cruiser's nose.
  if (lead) {
    const sx = (lead.car.x - state.camera.x) * state.camera.zoom + 640;
    const sy = (lead.car.y - state.camera.y) * state.camera.zoom + 360;
    combat.update(state, { mouse: { down: true, x: sx, y: sy }, wasPressed: () => false }, STEP);
    // Age the effects one frame so the muzzle glow settles and Marlo shows through it;
    // the tracer and the impact sparks are longer-lived and stay bright.
    for (let i = combat.effects.length - 1; i >= 0; i -= 1) {
      combat.effects[i].t -= STEP;
      if (combat.effects[i].t <= 0) combat.effects.splice(i, 1);
    }
    updateParticles(STEP);
  }
}

function sceneBeach() {
  // Golden hour on Ocean Drive: eastbound along the Palm Beach front in light traffic,
  // palms and the sand to the right, the sea beyond, the hotels on the left.
  state.tint = 'dusk';
  const roadY = hRoads[GRID.rows].y + GRID.laneOff;
  const car = driveFrom(vRoads[3].x + 130, roadY, 0);

  const sedan = createCar({ typeId: 'sedan', color: '#2e4053', x: car.x + 300, y: roadY, angle: 0 });
  sedan.braking = true; // Tail lights flared as it checks up for the corner.
  const taxi = createCar({ typeId: 'taxi', color: '#ffb81c', x: car.x - 330, y: roadY, angle: 0 });
  const van = createCar({ typeId: 'van', color: '#e8e6df', x: car.x + 540, y: hRoads[GRID.rows].y - GRID.laneOff, angle: Math.PI });
  state.cars.push(sedan, taxi, van);

  crowd();
  roll(car, 185);
  roll(sedan, 150);
  roll(taxi, 205);
  roll(van, -140);

  state.camera.x = car.x - 30;
  state.camera.y = car.y + 12;
  state.camera.zoom = 1;
}

const SCENES = { cover: sceneCover, mission: sceneMission, combat: sceneCombat, beach: sceneBeach };
(SCENES[scene] ?? sceneCover)();

// --- Paint, exactly as main.js's runShot paints -----------------------------------------
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

state.viewport = renderer.size();
let painted = 0;
function paint() {
  renderer.draw(state);
  drawWorldParticles();
  hud.draw(renderer.ctx, state);
  combat.drawScreen(renderer.ctx, state);
  painted += 1;
  if (painted < 2) requestAnimationFrame(paint);
  else window.__shotReady = true;
}
requestAnimationFrame(paint);
