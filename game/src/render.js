// Drawing only: the game state in, pixels out. The renderer owns the camera and paints
// Sunfall City in layers — sea and sand, roads, district labels, blocks and buildings,
// palms and lamps, then the entities sorted by depth — and finishes with the title and
// pause overlays. Everything is canvas paths and fills; there are no image assets.
// Decoration that must not flicker between frames (sand speckle, water glints, roof
// clutter) comes from the deterministic hash2, never from Math.random.
import { CAMERA, CITY_H, CITY_W, COLORS, DISTRICTS, FONT, GRID, SUN, WORLD } from './config.js';
import { hash2 } from './random.js';
import { drawCar, drawPlayer, roundRectPath, shadeColor } from './player.js';
import { drawPedestrian } from './pedestrians.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let viewW = 0;
  let viewH = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  /**
   * Ease the camera toward the player (or the car being driven), looking ahead along the
   * velocity, and keep the view from drifting far outside the world.
   */
  function updateCamera(state, dt) {
    const cam = state.camera;
    const p = state.player;
    const lookX = clamp(p.vx * CAMERA.lookAheadTime, -CAMERA.lookAheadMax, CAMERA.lookAheadMax);
    const lookY = clamp(p.vy * CAMERA.lookAheadTime, -CAMERA.lookAheadMax, CAMERA.lookAheadMax);
    const k = Math.min(1, CAMERA.follow * dt);
    cam.x += (p.x + lookX - cam.x) * k;
    cam.y += (p.y + lookY - cam.y) * k;
    const hw = viewW / 2 / cam.zoom;
    const hh = viewH / 2 / cam.zoom;
    cam.x = hw * 2 >= WORLD.width + 480 ? WORLD.width / 2 : clamp(cam.x, hw - 240, WORLD.width - hw + 240);
    cam.y = hh * 2 >= WORLD.height + 480 ? WORLD.height / 2 : clamp(cam.y, hh - 240, WORLD.height - hh + 240);
  }

  function drawSeaAndSand(state, view) {
    const world = state.world;
    const time = state.time;
    // Sand first: speckle that stays put, courtesy of the hash.
    const sand = world.sandRect;
    ctx.fillStyle = COLORS.sand;
    ctx.fillRect(sand.x, sand.y, sand.w, sand.h);
    ctx.fillStyle = COLORS.sandDark;
    for (let gx = Math.floor(view.x0 / 26) * 26; gx < view.x1; gx += 26) {
      for (let gy = Math.floor(Math.max(view.y0, sand.y) / 26) * 26; gy < Math.min(view.y1, sand.y + sand.h); gy += 26) {
        if (hash2(gx, gy) > 0.62) ctx.fillRect(gx + hash2(gy, gx) * 14, gy + 6, 3, 2);
      }
    }
    // The promenade: a paved band along the top of the beach, under Ocean Drive.
    ctx.fillStyle = COLORS.promenade;
    ctx.fillRect(0, CITY_H, WORLD.width, 30);
    ctx.fillStyle = 'rgba(120,96,52,0.5)';
    ctx.fillRect(0, CITY_H + 30, WORLD.width, 3);

    for (const rect of world.waterRects) {
      const grad = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
      grad.addColorStop(0, COLORS.waterShallow);
      grad.addColorStop(0.35, COLORS.waterDeep);
      grad.addColorStop(1, '#1a5f82');
      ctx.fillStyle = grad;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      // Drifting glints.
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 2;
      const x0 = Math.max(rect.x, view.x0);
      const x1 = Math.min(rect.x + rect.w, view.x1);
      const y0 = Math.max(rect.y, view.y0);
      const y1 = Math.min(rect.y + rect.h, view.y1);
      for (let gx = Math.floor(x0 / 52) * 52; gx < x1; gx += 52) {
        for (let gy = Math.floor(y0 / 40) * 40; gy < y1; gy += 40) {
          if (hash2(gx, gy) < 0.55) continue;
          const off = Math.sin(time * 1.25 + gx * 0.045 + gy * 0.03) * 5;
          ctx.beginPath();
          ctx.moveTo(gx + off, gy + 8);
          ctx.lineTo(gx + off + 17, gy + 8);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    // Foam where the sea meets the sand, and where the bay meets the docks road.
    ctx.strokeStyle = COLORS.waterFoam;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = Math.max(0, view.x0); x <= Math.min(WORLD.width, view.x1); x += 18) {
      const y = CITY_H + 170 - 4 + Math.sin(x * 0.02 + time * 1.6) * 2.5;
      if (x === Math.max(0, view.x0)) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawRoads(state, view) {
    const world = state.world;
    const { roadW } = GRID;
    ctx.fillStyle = COLORS.asphalt;
    for (const road of world.roads.vertical) ctx.fillRect(road.x - roadW / 2, 0, roadW, CITY_H);
    for (const road of world.roads.horizontal) ctx.fillRect(0, road.y - roadW / 2, CITY_W, roadW);

    ctx.strokeStyle = COLORS.asphaltEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const road of world.roads.vertical) {
      ctx.moveTo(road.x - roadW / 2 + 4, 0);
      ctx.lineTo(road.x - roadW / 2 + 4, CITY_H);
      ctx.moveTo(road.x + roadW / 2 - 4, 0);
      ctx.lineTo(road.x + roadW / 2 - 4, CITY_H);
    }
    for (const road of world.roads.horizontal) {
      ctx.moveTo(0, road.y - roadW / 2 + 4);
      ctx.lineTo(CITY_W, road.y - roadW / 2 + 4);
      ctx.moveTo(0, road.y + roadW / 2 - 4);
      ctx.lineTo(CITY_W, road.y + roadW / 2 - 4);
    }
    ctx.stroke();

    // Dashed centre lines, drawn segment by segment so they stop at intersections.
    ctx.fillStyle = COLORS.lanePaint;
    const vRoads = world.roads.vertical;
    const hRoads = world.roads.horizontal;
    for (const road of vRoads) {
      for (let j = 0; j + 1 < hRoads.length; j += 1) {
        const from = hRoads[j].y + roadW / 2 + 8;
        const to = hRoads[j + 1].y - roadW / 2 - 8;
        for (let y = from; y + 24 < to; y += 46) ctx.fillRect(road.x - 2, y, 4, 24);
      }
    }
    for (const road of hRoads) {
      for (let i = 0; i + 1 < vRoads.length; i += 1) {
        const from = vRoads[i].x + roadW / 2 + 8;
        const to = vRoads[i + 1].x - roadW / 2 - 8;
        for (let x = from; x + 24 < to; x += 46) ctx.fillRect(x, road.y - 2, 24, 4);
      }
    }

    // Zebra crosswalks on all four approaches of every visible intersection.
    ctx.fillStyle = COLORS.crosswalk;
    for (const cross of world.intersections) {
      if (cross.x < view.x0 - 90 || cross.x > view.x1 + 90 || cross.y < view.y0 - 90 || cross.y > view.y1 + 90) continue;
      for (let s = -3; s <= 3; s += 1) {
        ctx.fillRect(cross.x + s * 13 - 3.5, cross.y - roadW / 2 + 5, 7, 11);
        ctx.fillRect(cross.x + s * 13 - 3.5, cross.y + roadW / 2 - 16, 7, 11);
        ctx.fillRect(cross.x - roadW / 2 + 5, cross.y + s * 13 - 3.5, 11, 7);
        ctx.fillRect(cross.x + roadW / 2 - 16, cross.y + s * 13 - 3.5, 11, 7);
      }
    }
  }

  function drawBuilding(b) {
    const levels = b.levels;
    // Ground shadow, then the sun-side wall face, then the roof on top.
    ctx.fillStyle = 'rgba(24,26,20,0.22)';
    ctx.fillRect(b.x + SUN.x * 0.9, b.y + SUN.y * 0.9, b.w, b.h);
    const ox = SUN.x * levels * 0.17;
    const oy = SUN.y * levels * 0.17;
    ctx.fillStyle = shadeColor(b.roof, 0.6);
    ctx.fillRect(b.x + ox, b.y + oy, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Parapet and a lighter inner roof field.
    ctx.strokeStyle = shadeColor(b.roof, 0.82);
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    ctx.fillStyle = shadeColor(b.roof, 1.06);
    ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);

    if (b.district === 'hillside') {
      // Pitched roof: two tones split along the ridge.
      ctx.fillStyle = shadeColor(b.roof, 1.14);
      ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, (b.h - 16) / 2);
      ctx.fillStyle = shadeColor(b.roof, 0.9);
      ctx.fillRect(b.x + 8, b.y + b.h / 2, b.w - 16, (b.h - 16) / 2);
      ctx.fillStyle = 'rgba(60,30,16,0.5)';
      ctx.fillRect(b.x + 6, b.y + b.h / 2 - 1, b.w - 12, 2);
    } else if (b.district === 'portside') {
      // Warehouse skylight strips.
      ctx.fillStyle = 'rgba(210,230,240,0.55)';
      for (let s = 0; s < 3; s += 1) {
        ctx.fillRect(b.x + 16, b.y + 14 + s * ((b.h - 28) / 3), b.w - 32, 7);
      }
    } else if (levels >= 4) {
      // Rooftop clutter on the towers: plant boxes and a stair head, placed by hash.
      ctx.fillStyle = shadeColor(b.roof, 0.78);
      const boxes = 2 + Math.floor(hash2(b.seed, 1) * 3);
      for (let n = 0; n < boxes; n += 1) {
        const bx = b.x + 14 + hash2(b.seed, n * 2 + 2) * (b.w - 52);
        const by = b.y + 14 + hash2(b.seed, n * 2 + 3) * (b.h - 52);
        ctx.fillRect(bx, by, 16 + hash2(b.seed, n + 9) * 14, 12 + hash2(b.seed, n + 20) * 10);
      }
    }
    if (b.district === 'oldmarket') {
      // A striped awning along the shopfront.
      ctx.fillStyle = shadeColor(b.roof, 0.75);
      ctx.fillRect(b.x, b.y + b.h - 9, b.w, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      for (let x = b.x + 4; x < b.x + b.w - 6; x += 12) ctx.fillRect(x, b.y + b.h - 9, 5, 9);
    }
    if (b.district === 'downtown') {
      // Neon sign strips along the south roofline of some towers, in the title's
      // pink / cyan / amber. Count, colour and placement all come from the building's
      // hash, so a sign never flickers or moves between frames.
      const neon = ['#ff5da2', '#22d3ee', '#ffc93c'];
      const signs = Math.floor(hash2(b.seed, 31) * 3);
      for (let n = 0; n < signs; n += 1) {
        const color = neon[Math.floor(hash2(b.seed, 40 + n) * neon.length) % neon.length];
        const sw = 9 + hash2(b.seed, 50 + n) * 15;
        const sx = b.x + 5 + hash2(b.seed, 60 + n) * Math.max(4, b.w - 10 - sw);
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillStyle = color;
        ctx.fillRect(sx, b.y + b.h - 4.5, sw, 2.6);
        ctx.restore();
      }
    }

    if (b.name) {
      ctx.font = `700 11px ${FONT}`;
      const tw = ctx.measureText(b.name).width;
      const pw = tw + 15;
      const px = clamp(b.x + b.w / 2 - pw / 2, b.x - 4, b.x + b.w + 4 - pw);
      const py = b.y - 10;
      ctx.fillStyle = 'rgba(14,22,30,0.88)';
      roundRectPath(ctx, px, py, pw, 17, 4);
      ctx.fill();
      if (b.landmark) {
        ctx.strokeStyle = '#ffc93c';
        ctx.lineWidth = 1.4;
        roundRectPath(ctx, px, py, pw, 17, 4);
        ctx.stroke();
      }
      ctx.fillStyle = b.landmark ? '#ffe9b0' : '#dfe9f2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.name, px + pw / 2, py + 9);
    }
  }

  function drawBlocks(state, view) {
    const world = state.world;
    for (const block of world.blocks) {
      if (block.x > view.x1 + 40 || block.x + block.w < view.x0 - 40 || block.y > view.y1 + 40 || block.y + block.h < view.y0 - 40) continue;
      if (block.kind === 'docks') {
        for (const pier of block.docks.piers) {
          ctx.fillStyle = COLORS.pierWood;
          ctx.fillRect(pier.x, pier.y, pier.w, pier.h);
          ctx.fillStyle = COLORS.pierWoodDark;
          for (let x = pier.x + 10; x < pier.x + pier.w - 4; x += 15) ctx.fillRect(x, pier.y + 1, 2, pier.h - 2);
        }
        for (const boat of block.docks.boats) {
          ctx.save();
          ctx.translate(boat.x, boat.y);
          ctx.rotate(boat.angle);
          ctx.fillStyle = 'rgba(18,22,18,0.2)';
          roundRectPath(ctx, -15, -3, 34, 13, 6);
          ctx.fill();
          roundRectPath(ctx, -17, -6, 34, 12, 6);
          ctx.fillStyle = boat.color;
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          roundRectPath(ctx, -6, -3.5, 13, 7, 3);
          ctx.fill();
          ctx.restore();
        }
        continue;
      }
      const district = DISTRICTS[block.district];
      ctx.fillStyle = district.sidewalk;
      ctx.fillRect(block.x - 7, block.y - 7, block.w + 14, block.h + 14);
      if (block.kind === 'park') {
        ctx.fillStyle = COLORS.grass;
        ctx.fillRect(block.x, block.y, block.w, block.h);
        ctx.fillStyle = 'rgba(40,80,30,0.10)';
        for (let x = block.x + 24; x < block.x + block.w; x += 48) ctx.fillRect(x, block.y, 20, block.h);
        ctx.fillStyle = '#d8c9a3';
        ctx.fillRect(block.x, block.y + block.h / 2 - 12, block.w, 24);
        ctx.fillRect(block.x + block.w / 2 - 12, block.y, 24, block.h);
        if (block.park.pond) {
          const pond = block.park.pond;
          ctx.fillStyle = COLORS.waterShallow;
          ctx.beginPath();
          ctx.ellipse(pond.x, pond.y, pond.rx, pond.ry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(34,119,159,0.65)';
          ctx.beginPath();
          ctx.ellipse(pond.x, pond.y, pond.rx - 12, pond.ry - 9, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      ctx.fillStyle = district.ground;
      ctx.fillRect(block.x, block.y, block.w, block.h);
      if (block.pool) {
        ctx.fillStyle = '#c9b98f';
        ctx.fillRect(block.pool.x - 4, block.pool.y - 4, block.pool.w + 8, block.pool.h + 8);
        ctx.fillStyle = COLORS.waterShallow;
        ctx.fillRect(block.pool.x, block.pool.y, block.pool.w, block.pool.h);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(block.pool.x + 6, block.pool.y + 6, block.pool.w - 30, 5);
      }
      for (const b of block.buildings) drawBuilding(b);
    }
  }

  function drawDistrictLabels(state, view) {
    ctx.save();
    ctx.font = `800 54px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const region of state.world.districtRegions) {
      if (region.x < view.x0 - 320 || region.x > view.x1 + 320 || region.y < view.y0 - 120 || region.y > view.y1 + 120) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillText(region.name, region.x, region.y);
    }
    ctx.restore();
  }

  function drawPalm(ctx2, palm, time) {
    const s = palm.s;
    const sway = Math.sin(time * 0.9 + palm.phase) * 1.7;
    const topX = palm.x + palm.lean + sway * 0.4;
    const topY = palm.y - 16 * s;
    // Frond shadow on the ground, cast with the sun.
    ctx2.save();
    ctx2.translate(palm.x + SUN.x * 0.8, palm.y + SUN.y * 0.8);
    ctx2.strokeStyle = 'rgba(24,44,20,0.20)';
    ctx2.lineWidth = 2.4 * s;
    for (let k = 0; k < 7; k += 1) {
      const ang = (k / 7) * Math.PI * 2 + palm.phase;
      ctx2.beginPath();
      ctx2.moveTo(0, 0);
      ctx2.lineTo(Math.cos(ang) * 15 * s, Math.sin(ang) * 6 * s);
      ctx2.stroke();
    }
    ctx2.restore();
    // Trunk.
    ctx2.strokeStyle = '#8a6a44';
    ctx2.lineWidth = 3.4 * s;
    ctx2.beginPath();
    ctx2.moveTo(palm.x, palm.y);
    ctx2.quadraticCurveTo(palm.x + palm.lean * 0.4, palm.y - 8 * s, topX, topY);
    ctx2.stroke();
    // Fronds.
    const greens = ['#3f8f3f', '#4da34a', '#357a35'];
    ctx2.lineWidth = 2.6 * s;
    for (let k = 0; k < 7; k += 1) {
      const ang = (k / 7) * Math.PI * 2 + palm.phase + sway * 0.02;
      const len = 15.5 * s;
      ctx2.strokeStyle = greens[k % 3];
      ctx2.beginPath();
      ctx2.moveTo(topX, topY);
      ctx2.quadraticCurveTo(
        topX + Math.cos(ang) * len * 0.6, topY + Math.sin(ang) * len * 0.3 - 3.4 * s,
        topX + Math.cos(ang) * len, topY + Math.sin(ang) * len * 0.55 + 4.4 * s,
      );
      ctx2.stroke();
    }
    ctx2.fillStyle = '#6b4e2e';
    ctx2.beginPath();
    ctx2.arc(topX - 2, topY + 1.5, 1.7, 0, Math.PI * 2);
    ctx2.arc(topX + 2.2, topY + 2, 1.5, 0, Math.PI * 2);
    ctx2.fill();
  }

  function drawProps(state, view) {
    for (const lamp of state.world.lamps) {
      if (lamp.x < view.x0 || lamp.x > view.x1 || lamp.y < view.y0 || lamp.y > view.y1) continue;
      ctx.fillStyle = '#57503f';
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const palm of state.world.palms) {
      if (palm.x < view.x0 - 40 || palm.x > view.x1 + 40 || palm.y < view.y0 - 30 || palm.y > view.y1 + 40) continue;
      drawPalm(ctx, palm, state.time);
    }
  }

  function drawEntities(state) {
    const items = [];
    for (const car of state.cars) items.push({ y: car.y + car.length * 0.3, draw: () => drawCar(ctx, car) });
    if (state.pedestrians) {
      for (const ped of state.pedestrians.list) items.push({ y: ped.y + 8, draw: () => drawPedestrian(ctx, ped) });
    }
    if (state.player.mode === 'foot') items.push({ y: state.player.y + 8, draw: () => drawPlayer(ctx, state.player) });
    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();
  }

  function drawTitle(state) {
    const grad = ctx.createLinearGradient(0, 0, 0, viewH);
    grad.addColorStop(0, 'rgba(8,14,24,0.60)');
    grad.addColorStop(0.45, 'rgba(8,14,24,0.10)');
    grad.addColorStop(1, 'rgba(8,14,24,0.58)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);

    const cx = viewW / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const titleGrad = ctx.createLinearGradient(cx - 330, 0, cx + 330, 0);
    titleGrad.addColorStop(0, '#ff5da2');
    titleGrad.addColorStop(0.55, '#ff9e4f');
    titleGrad.addColorStop(1, '#ffd93c');
    ctx.save();
    ctx.shadowColor = '#ff5da2';
    ctx.shadowBlur = 34;
    ctx.fillStyle = titleGrad;
    ctx.font = `900 84px "Arial Black", ${FONT}`;
    ctx.fillText('NEON PALMS', cx, viewH * 0.3);
    ctx.restore();

    try {
      ctx.letterSpacing = '9px';
    } catch {
      // Older engines ignore letterSpacing; the subtitle still reads fine without it.
    }
    ctx.fillStyle = '#ffe9b0';
    ctx.font = `600 19px ${FONT}`;
    ctx.fillText('A SUNFALL CITY STORY', cx, viewH * 0.3 + 38);
    try {
      ctx.letterSpacing = '0px';
    } catch {
      // See above.
    }
    ctx.fillStyle = '#dfe9f2';
    ctx.font = `15px ${FONT}`;
    ctx.fillText('Steal cars. Run errands for the wrong people. Outrun the Harbor Precinct.', cx, viewH * 0.3 + 68);

    const lines = [
      'W A S D / Arrow keys — move and drive',
      'Shift — run    Space — handbrake',
      'F — get in / out of a car    E — interact',
      'Esc / P — pause',
    ];
    const panelW = 470;
    const panelH = lines.length * 23 + 28;
    const panelX = cx - panelW / 2;
    const panelY = viewH - panelH - 92;
    ctx.fillStyle = 'rgba(10,18,28,0.74)';
    roundRectPath(ctx, panelX, panelY, panelW, panelH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,201,60,0.35)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, panelX, panelY, panelW, panelH, 10);
    ctx.stroke();
    ctx.fillStyle = '#e8eef4';
    ctx.font = `14.5px ${FONT}`;
    lines.forEach((line, i) => {
      ctx.fillText(line, cx, panelY + 33 + i * 23);
    });

    if (Math.floor(state.time * 1.4) % 2 === 0) {
      ctx.fillStyle = '#ffc93c';
      ctx.font = `700 22px ${FONT}`;
      ctx.fillText('PRESS ENTER TO PLAY', cx, viewH - 42);
    }
  }

  function drawPaused() {
    ctx.fillStyle = 'rgba(8,12,20,0.55)';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 44px ${FONT}`;
    ctx.fillText('PAUSED', viewW / 2, viewH / 2 - 8);
    ctx.fillStyle = '#c8d4e0';
    ctx.font = `16px ${FONT}`;
    ctx.fillText('Press Esc or P to keep playing', viewW / 2, viewH / 2 + 28);
  }

  /** Paint one frame: the city, the entities, then the screen's overlay, if any. */
  function draw(state) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.backdrop;
    ctx.fillRect(0, 0, viewW, viewH);
    const cam = state.camera;
    const view = {
      x0: cam.x - viewW / 2 / cam.zoom - 90,
      y0: cam.y - viewH / 2 / cam.zoom - 90,
      x1: cam.x + viewW / 2 / cam.zoom + 90,
      y1: cam.y + viewH / 2 / cam.zoom + 90,
    };
    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    drawSeaAndSand(state, view);
    drawRoads(state, view);
    drawBlocks(state, view);
    drawDistrictLabels(state, view);
    drawProps(state, view);
    drawEntities(state);
    ctx.restore();

    if (state.tint === 'dusk') {
      ctx.fillStyle = 'rgba(255,110,36,0.13)';
      ctx.fillRect(0, 0, viewW, viewH);
      const grad = ctx.createLinearGradient(0, 0, 0, viewH);
      grad.addColorStop(0, 'rgba(30,30,80,0.16)');
      grad.addColorStop(1, 'rgba(30,30,80,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    if (state.screen === SCREEN_TITLE) drawTitle(state);
    else if (state.screen === SCREEN_PAUSED) drawPaused();
  }

  return {
    ctx,
    draw,
    resize,
    updateCamera,
    /** Current viewport size in CSS pixels, for HUD layout in main.js. */
    size() {
      return { w: viewW, h: viewH };
    },
  };
}
