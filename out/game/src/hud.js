// The HUD: everything painted over the world while Marlo plays. District label top-left;
// cash and Harbor PD's wanted stars top-right; health bottom-left; a circular minimap
// bottom-right (the city pre-rendered once from world data — roads, blocks, water —
// with the player arrow, police blips, start markers and the objective waypoint drawn
// live over it). Across the top-centre sit the current job's title, its live objective
// and its clock; mission dialogue runs in a box at the bottom-centre; BUSTED, WASTED and
// job banners land in the middle of the screen. Start markers and waypoints live in the
// world, so they are projected through the camera and drawn as beacons — rings when on
// screen, arrows on the screen edge when not. The title and pause menus are drawn here
// too, over the renderer's own overlays.
import { DISTRICTS, FONT } from './config.js';
import { nearestCar } from './player.js';

const PANEL = 'rgba(10,18,28,0.62)';
const GOLD = '#ffc93c';
const CREAM = '#ffe9b0';

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Word-wrap `text` to at most `maxWidth` on this context; returns the lines. */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud() {
  let announceText = null;
  let announceUntil = -1;
  let mapLayer = null; // Pre-rendered minimap base (offscreen canvas) + its transform.
  const MAP_R = 88;

  /** World → screen through the camera, matching render.js's transform. */
  function project(state, x, y) {
    const { w, h } = state.viewport;
    const cam = state.camera;
    return {
      x: (x - cam.x) * cam.zoom + w / 2,
      y: (y - cam.y) * cam.zoom + h / 2,
    };
  }

  /** Build the minimap's static city layer once, from the world's own data. */
  function buildMapLayer(world) {
    const size = MAP_R * 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    const scale = (size - 10) / Math.max(world.width, world.height);
    const px = (x) => (x - world.width / 2) * scale + MAP_R;
    const py = (y) => (y - world.height / 2) * scale + MAP_R;
    g.fillStyle = '#5d7a4a';
    g.fillRect(0, 0, size, size);
    for (const rect of world.waterRects) {
      g.fillStyle = '#2a7ba3';
      g.fillRect(px(rect.x), py(rect.y), rect.w * scale, rect.h * scale);
    }
    const sand = world.sandRect;
    g.fillStyle = '#d9bd85';
    g.fillRect(px(sand.x), py(sand.y), sand.w * scale, sand.h * scale);
    for (const block of world.blocks) {
      g.fillStyle = DISTRICTS[block.district]?.ground ?? '#999';
      g.globalAlpha = 0.85;
      g.fillRect(px(block.x), py(block.y), Math.max(1.5, block.w * scale), Math.max(1.5, block.h * scale));
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#3c3f46';
    g.lineWidth = Math.max(1.4, 108 * scale);
    for (const road of world.roads.vertical) {
      g.beginPath(); g.moveTo(px(road.x), py(0)); g.lineTo(px(road.x), py(world.cityHeight)); g.stroke();
    }
    for (const road of world.roads.horizontal) {
      g.beginPath(); g.moveTo(px(0), py(road.y)); g.lineTo(px(world.cityWidth), py(road.y)); g.stroke();
    }
    mapLayer = { canvas, scale };
    return mapLayer;
  }

  function drawMinimap(ctx, state) {
    const { w, h } = state.viewport;
    const { world, player, police, missions } = state;
    const cx = w - MAP_R - 18;
    const cy = h - MAP_R - 18;
    const layer = mapLayer ?? buildMapLayer(world);
    const toMap = (x, y) => ({
      x: cx + (x - world.width / 2) * layer.scale,
      y: cy + (y - world.height / 2) * layer.scale,
    });

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, MAP_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,18,28,0.72)';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(layer.canvas, cx - MAP_R, cy - MAP_R);
    // A soft view cone of "where Marlo is" — the map is north-up and world-locked.
    const clampBlip = (p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      const max = MAP_R - 9;
      return d > max ? { x: cx + (dx / d) * max, y: cy + (dy / d) * max } : p;
    };

    if (missions) {
      for (const marker of missions.markers(state)) {
        const p = clampBlip(toMap(marker.x, marker.y));
        ctx.fillStyle = marker.kind === 'story' ? '#ff5da2' : marker.kind === 'taxi' ? GOLD : '#ff9e4f';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      const wp = missions.waypoint();
      if (wp) {
        const p = clampBlip(toMap(wp.x, wp.y));
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (police && police.stars > 0) {
      const flash = Math.floor(state.time * 2.4) % 2 === 0;
      for (const unit of police.units) {
        const p = clampBlip(toMap(unit.car.x, unit.car.y));
        ctx.fillStyle = flash ? '#ff5040' : '#5aa2ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Marlo: a white arrow turned to his heading.
    const pp = toMap(player.x, player.y);
    ctx.translate(pp.x, pp.y);
    ctx.rotate(player.angle + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(10,18,28,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6.4);
    ctx.lineTo(4.4, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-4.4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, MAP_R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,233,176,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = CREAM;
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - MAP_R + 14);
    ctx.restore();
  }

  /** A world-space beacon: pulsing ring + label on screen, edge arrow off screen. */
  function drawBeacon(ctx, state, x, y, color, label) {
    const { w, h } = state.viewport;
    const p = project(state, x, y);
    const pulse = 1 + Math.sin(state.time * 5) * 0.16;
    ctx.save();
    if (p.x >= 24 && p.x <= w - 24 && p.y >= 24 && p.y <= h - 24) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 26 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (label) {
        ctx.font = `700 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(label, p.x, p.y - 32);
      }
    } else {
      // Off screen: an arrow on the margin pointing the way, with the distance.
      const cx = w / 2;
      const cy = h / 2;
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const ex = clamp(p.x, 34, w - 34);
      const ey = clamp(p.y, 34, h - 34);
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-7, -7);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang);
      const distM = Math.round(Math.hypot(x - state.player.x, y - state.player.y) / 8);
      ctx.font = `700 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(`${distM}m`, 0, 22);
    }
    ctx.restore();
  }

  /** The waiting taxi client: a little figure at the pickup, drawn through projection. */
  function drawClient(ctx, state, x, y) {
    const p = project(state, x, y);
    const { w, h } = state.viewport;
    if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) return;
    const z = state.camera.zoom;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(z, z);
    ctx.fillStyle = 'rgba(18,22,18,0.25)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#31435c';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, 6);
    ctx.stroke();
    // One arm up, hailing — it waves with the clock.
    ctx.strokeStyle = '#e8b08a';
    ctx.lineWidth = 2.6;
    const wave = Math.sin(state.time * 6) * 3;
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.lineTo(7, -9 + wave);
    ctx.stroke();
    ctx.fillStyle = '#ffb81c';
    ctx.fillRect(-4.4, -6, 8.8, 6.4);
    ctx.fillStyle = '#e8b08a';
    ctx.beginPath();
    ctx.arc(0, -10, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(ctx, state) {
    const { w, h } = state.viewport;
    const { world, player, police, missions } = state;
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    // District, top-left.
    const district = world.districtAt(player.x, player.y);
    ctx.font = `700 15px ${FONT}`;
    const label = `${district.name} — SUNFALL CITY`;
    const labelW = ctx.measureText(label).width;
    ctx.fillStyle = PANEL;
    ctx.fillRect(14, 12, labelW + 22, 30);
    ctx.fillStyle = CREAM;
    ctx.textAlign = 'left';
    ctx.fillText(label, 25, 33);

    // Cash, top-right, with the respect tally under it.
    ctx.font = `700 17px ${FONT}`;
    const cash = `$${player.cash}`;
    const cashW = ctx.measureText(cash).width;
    ctx.fillStyle = PANEL;
    ctx.fillRect(w - cashW - 36, 12, cashW + 22, 30);
    ctx.fillStyle = '#8fe388';
    ctx.fillText(cash, w - cashW - 25, 34);
    if (missions && missions.progress.respect > 0) {
      ctx.font = `600 12px ${FONT}`;
      const respect = `RESPECT ${missions.progress.respect}`;
      const rw = ctx.measureText(respect).width;
      ctx.fillStyle = 'rgba(10,18,28,0.5)';
      ctx.fillRect(w - rw - 36, 46, rw + 22, 22);
      ctx.fillStyle = '#c8b8e8';
      ctx.fillText(respect, w - rw - 25, 61);
    }

    // Wanted stars under the cash.
    if (police && police.stars > 0) {
      ctx.font = `700 19px ${FONT}`;
      ctx.textAlign = 'right';
      for (let i = 0; i < 5; i += 1) {
        ctx.fillStyle = i < police.stars ? GOLD : 'rgba(230,236,242,0.28)';
        ctx.fillText('★', w - 25 - (4 - i) * 22, 96);
      }
      ctx.textAlign = 'left';
    }

    // Health, bottom-left.
    const healthFrac = clamp(player.health / player.maxHealth, 0, 1);
    ctx.fillStyle = PANEL;
    ctx.fillRect(14, h - 40, 196, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(20, h - 36, 184, 11);
    ctx.fillStyle = healthFrac > 0.45 ? '#57c84c' : healthFrac > 0.22 ? '#e8a33d' : '#e0483d';
    ctx.fillRect(20, h - 36, 184 * healthFrac, 11);
    ctx.font = `700 9px ${FONT}`;
    ctx.fillStyle = '#dfe9f2';
    ctx.fillText('HEALTH', 20, h - 16);

    // The car Marlo is driving, bottom-right above the minimap.
    if (player.mode === 'car' && player.car) {
      const speed = Math.round(Math.abs(player.car.forwardSpeed) * 0.24);
      ctx.font = `600 13px ${FONT}`;
      const text = `${player.car.name} — ${speed} mph`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = PANEL;
      ctx.fillRect(w - tw - 36, h - 226, tw + 22, 24);
      ctx.fillStyle = '#dfe9f2';
      ctx.fillText(text, w - tw - 25, h - 210);
    }

    drawMinimap(ctx, state);

    // World beacons: start markers, the objective waypoint, a waiting fare.
    if (missions) {
      for (const marker of missions.markers(state)) {
        if (marker.kind === 'client') drawClient(ctx, state, marker.x, marker.y);
        else {
          drawBeacon(ctx, state, marker.x, marker.y,
            marker.kind === 'story' ? '#ff5da2' : marker.kind === 'taxi' ? GOLD : '#ff9e4f',
            marker.kind === 'story' ? '!' : marker.kind === 'taxi' ? 'TAXI' : 'JOB');
        }
      }
      const wp = missions.waypoint();
      if (wp && !wp.marker) drawBeacon(ctx, state, wp.x, wp.y, GOLD, null);
    }

    // Job title, objective and clock, top-centre.
    if (missions && missions.active) {
      const objective = missions.objectiveText();
      ctx.textAlign = 'center';
      ctx.font = `800 13px ${FONT}`;
      const titleW = ctx.measureText(missions.active.title.toUpperCase()).width;
      ctx.fillStyle = PANEL;
      ctx.fillRect(w / 2 - titleW / 2 - 14, 12, titleW + 28, 24);
      ctx.fillStyle = GOLD;
      ctx.fillText(missions.active.title.toUpperCase(), w / 2, 29);
      if (objective) {
        ctx.font = `600 15px ${FONT}`;
        const ow = ctx.measureText(objective).width;
        ctx.fillStyle = 'rgba(10,18,28,0.5)';
        ctx.fillRect(w / 2 - ow / 2 - 12, 40, ow + 24, 24);
        ctx.fillStyle = '#f2f6fa';
        ctx.fillText(objective, w / 2, 57);
      }
      const left = missions.timeLeft;
      if (left !== null && left !== undefined) {
        ctx.font = `800 17px ${FONT}`;
        ctx.fillStyle = left < 15 ? '#ff6b5c' : CREAM;
        ctx.fillText(formatClock(left), w / 2, 86);
      }
      ctx.textAlign = 'left';
    }

    // The bust meter, centre-bottom, while a cruiser stands over Marlo.
    if (police && police.bustProgress > 0) {
      const bw = 240;
      const by = missions && missions.dialogue ? h - 196 : h - 108;
      ctx.fillStyle = 'rgba(10,18,28,0.66)';
      ctx.fillRect((w - bw) / 2 - 10, by, bw + 20, 40);
      ctx.font = `800 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff7a5c';
      ctx.fillText('BUSTED', w / 2, by + 16);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect((w - bw) / 2, by + 22, bw, 9);
      ctx.fillStyle = '#ff5040';
      ctx.fillRect((w - bw) / 2, by + 22, bw * police.bustProgress, 9);
      ctx.textAlign = 'left';
    }

    // Dialogue box, bottom-centre: who's talking, what they said, how to go on.
    if (missions && missions.dialogue) {
      const dlg = missions.dialogue;
      ctx.font = `600 15px ${FONT}`;
      const lines = wrapText(ctx, dlg.text, 620);
      const boxW = 680;
      const boxH = 44 + lines.length * 21 + 14;
      const boxX = (w - boxW) / 2;
      const boxY = h - 58 - boxH;
      ctx.fillStyle = 'rgba(10,18,28,0.82)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = 'rgba(255,201,60,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.font = `800 13px ${FONT}`;
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'left';
      ctx.fillText(dlg.who.toUpperCase(), boxX + 18, boxY + 24);
      ctx.font = `600 15px ${FONT}`;
      ctx.fillStyle = '#f2f6fa';
      lines.forEach((line, i) => ctx.fillText(line, boxX + 18, boxY + 48 + i * 21));
      ctx.font = `700 12px ${FONT}`;
      ctx.fillStyle = CREAM;
      ctx.textAlign = 'right';
      ctx.fillText('E ▸', boxX + boxW - 14, boxY + boxH - 10);
      ctx.textAlign = 'left';
    } else if (missions && missions.promptText) {
      ctx.font = `600 14px ${FONT}`;
      const tw = ctx.measureText(missions.promptText).width;
      ctx.fillStyle = PANEL;
      ctx.fillRect((w - tw) / 2 - 11, h - 44, tw + 22, 26);
      ctx.fillStyle = CREAM;
      ctx.textAlign = 'center';
      ctx.fillText(missions.promptText, w / 2, h - 26);
      ctx.textAlign = 'left';
    } else if (player.mode !== 'car') {
      const near = nearestCar(state.cars, player.x, player.y, 56);
      if (near) {
        ctx.font = `600 14px ${FONT}`;
        const text = `F — get in the ${near.name}`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = PANEL;
        ctx.fillRect((w - tw) / 2 - 11, h - 44, tw + 22, 26);
        ctx.fillStyle = CREAM;
        ctx.textAlign = 'center';
        ctx.fillText(text, w / 2, h - 26);
        ctx.textAlign = 'left';
      }
    }

    // Job banners (missions) and BUSTED / WASTED (forwarded by main via notify()).
    let big = null;
    if (state.missionBanner && state.time < state.missionBanner.until) {
      big = {
        title: state.missionBanner.title,
        sub: state.missionBanner.sub,
        color: state.missionBanner.title.includes('FAIL') ? '#ff6b5c' : GOLD,
      };
    } else if (announceText && announceUntil > 0 && state.time < announceUntil) {
      big = { title: announceText, sub: null, color: announceText.startsWith('BUSTED') ? '#ff5040' : '#ff8a7a' };
    }
    if (big) {
      ctx.textAlign = 'center';
      ctx.font = `900 46px "Arial Black", ${FONT}`;
      ctx.fillStyle = 'rgba(10,18,28,0.45)';
      const tw = ctx.measureText(big.title).width;
      ctx.fillRect(w / 2 - tw / 2 - 30, h * 0.3 - 52, tw + 60, big.sub ? 108 : 74);
      ctx.fillStyle = big.color;
      ctx.fillText(big.title, w / 2, h * 0.3);
      if (big.sub) {
        ctx.font = `600 16px ${FONT}`;
        ctx.fillStyle = '#f2f6fa';
        ctx.fillText(big.sub, w / 2, h * 0.3 + 32);
      }
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  /** A menu panel shared by the title and pause screens. Returns nothing; draws only. */
  function drawMenu(ctx, state, heading, items, selected, footer) {
    const { w, h } = state.viewport;
    ctx.save();
    ctx.textAlign = 'center';
    const boxW = 520;
    const boxH = 58 + items.length * 34 + 34;
    const boxX = (w - boxW) / 2;
    const boxY = h - boxH - 26;
    ctx.fillStyle = 'rgba(10,18,28,0.86)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,201,60,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.font = `800 13px ${FONT}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(heading, w / 2, boxY + 26);
    items.forEach((item, i) => {
      const y = boxY + 62 + i * 34;
      ctx.font = i === selected ? `800 17px ${FONT}` : `600 16px ${FONT}`;
      ctx.fillStyle = i === selected ? CREAM : '#9fb2c4';
      ctx.fillText(`${i === selected ? '▶ ' : ''}${item}`, w / 2, y);
    });
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = '#8fa6ba';
    ctx.fillText(footer, w / 2, boxY + boxH - 12);
    ctx.restore();
  }

  return {
    draw,
    /** Show a BUSTED / WASTED headline for a few seconds of game time. */
    notify(state, text) {
      announceText = text;
      announceUntil = state.time + 3.2;
    },
    drawTitleMenu(ctx, state, selected, saveData) {
      const items = saveData
        ? [
          `Continue — $${saveData.cash} · job ${Math.min(saveData.progress.storyIndex + 1, 6)} of 6 · respect ${saveData.progress.respect}`,
          'New game',
        ]
        : ['New game'];
      drawMenu(ctx, state, 'NEON PALMS', items, selected, '↑ ↓ choose · Enter confirm');
    },
    drawPauseMenu(ctx, state, selected) {
      drawMenu(ctx, state, 'PAUSED', ['Resume', 'Save game', 'Restart — wipe save, new game'], selected,
        '↑ ↓ choose · Enter confirm · Esc resume');
    },
  };
}
