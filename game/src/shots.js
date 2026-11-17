// The screenshot scenes behind ?shot=start|play|end (with &seed=N). Each scene places the
// player, the cars and the camera by hand on real streets of the generated city and freezes
// the clock, so the frame is exactly what the game itself renders and the same seed always
// gives the same frame. Nothing here draws; it only arranges state for render.js.
import { CAMERA, GRID } from './config.js';
import { createCar } from './player.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

/**
 * Arrange `state` as the named scene and return the screen to draw over it.
 * Unknown names stage the start scene.
 */
export function stageShot(name, state) {
  const { world, player } = state;
  state.time = 10; // A fixed clock: water, palm sway and the title prompt all freeze mid-beat.
  state.tint = null;
  const vRoads = world.roads.vertical;
  const hRoads = world.roads.horizontal;

  if (name === 'play') {
    // Mid-drive up Sunfall Boulevard (the avenue at column 4) through Downtown, in the
    // northbound lane, traffic parked along the kerbs and two cars on the road ahead.
    const avenue = vRoads[4].x + GRID.laneOff;
    const y = hRoads[3].y - 150;
    const car = state.cars[0];
    car.x = avenue;
    car.y = y;
    car.angle = -Math.PI / 2;
    car.vx = 0;
    car.vy = -215;
    car.forwardSpeed = 215;
    player.mode = 'car';
    player.car = car;
    car.occupied = true;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.vx = 0;
    player.vy = -215;
    state.cars.push(createCar({ typeId: 'sedan', color: '#8c2f39', x: avenue, y: y - 330, angle: -Math.PI / 2 }));
    state.cars.push(createCar({ typeId: 'taxi', color: '#ffb81c', x: vRoads[4].x - GRID.laneOff, y: y - 120, angle: Math.PI / 2 }));
    state.cars.push(createCar({ typeId: 'hatch', color: '#64b6e8', x: vRoads[5].x - GRID.roadW / 2 + 16, y: y + 90, angle: -Math.PI / 2 }));
    state.camera.x = car.x;
    state.camera.y = car.y + 60;
    state.camera.zoom = 1;
    state.screen = SCREEN_PLAY;
    return SCREEN_PLAY;
  }

  if (name === 'chase') {
    // Three stars on Sunfall Boulevard: Marlo's coupe at full tilt northbound, two
    // Harbor PD cruisers right behind him with their light bars lit, traffic scattering.
    const avenue = vRoads[4].x + GRID.laneOff;
    const y = hRoads[3].y - 170;
    const car = state.cars[0];
    car.x = avenue;
    car.y = y;
    car.angle = -Math.PI / 2;
    car.vx = 0;
    car.vy = -262;
    car.forwardSpeed = 262;
    player.mode = 'car';
    player.car = car;
    car.occupied = true;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.vx = 0;
    player.vy = -262;
    if (state.police) {
      state.police.setHeat(300); // Three stars, held for the frame.
      const lead = state.police.stageUnit(state, avenue, y + 128, -Math.PI / 2);
      if (lead) { lead.car.lightPhase = 0.12; lead.car.lightsOn = true; lead.speed = 250; }
      const second = state.police.stageUnit(state, vRoads[4].x - GRID.laneOff + 8, y + 235, -Math.PI / 2);
      if (second) { second.car.lightPhase = 0.62; second.car.lightsOn = true; second.speed = 238; }
    }
    state.cars.push(createCar({ typeId: 'sedan', color: '#8c2f39', x: avenue, y: y - 350, angle: -Math.PI / 2 }));
    state.cars.push(createCar({ typeId: 'taxi', color: '#ffb81c', x: vRoads[4].x - GRID.laneOff, y: y - 150, angle: Math.PI / 2 }));
    state.camera.x = car.x;
    state.camera.y = car.y + 74;
    state.camera.zoom = 1;
    state.screen = SCREEN_PLAY;
    return SCREEN_PLAY;
  }

  if (name === 'end') {
    // Golden hour at Palm Court: Marlo out of the coupe, looking out over the beach at the
    // end of the day — the run is over, the city is quiet.
    state.tint = 'dusk';
    const car = state.cars[0];
    car.x = world.playerSpawn.x + 92;
    car.y = hRoads[GRID.rows].y + GRID.laneOff;
    car.angle = 0;
    car.vx = 0;
    car.vy = 0;
    player.mode = 'foot';
    player.car = null;
    car.occupied = false;
    player.x = world.playerSpawn.x + 40;
    player.y = world.playerSpawn.y + 6;
    player.angle = Math.PI / 2;
    player.vx = 0;
    player.vy = 0;
    state.camera.x = player.x + 30;
    state.camera.y = player.y + 26;
    state.camera.zoom = 0.85;
    state.screen = SCREEN_PLAY;
    return SCREEN_PLAY;
  }

  // start: the title screen over a slow vista of the marina and the bay.
  player.mode = 'foot';
  player.x = world.playerSpawn.x;
  player.y = world.playerSpawn.y;
  player.angle = -Math.PI / 2;
  state.camera.x = world.width * 0.66;
  state.camera.y = world.cityHeight - 430;
  state.camera.zoom = CAMERA.titleZoom;
  state.screen = SCREEN_TITLE;
  return SCREEN_TITLE;
}
