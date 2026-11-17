// Missions: the story of NEON PALMS and the work around it. Delia Vance, a fixer who
// works out of the Salty Palm Diner, hands Marlo six jobs that chain across Sunfall City
// — fetching cars, running market errands, drawing Harbor PD's eye and losing it again —
// each started by stepping into a glowing marker and pressing E, each told in a few
// lines of dialogue before its objectives run. Objectives are small machines over the
// systems the city already has: drive-to and reach checkpoints, deliver one specific
// car in one piece, and escape objectives that pour heat into police.js and complete
// when the stars are gone. From the third job onward the city also offers repeatable
// work — SunCab taxi fares and courier runs — so cash and turf respect keep growing
// after the story ends. This module owns the progress record (story index, respect,
// fares, deliveries) that save.js persists; it never touches storage itself.
import { createCar } from './player.js';
import { spawnSparkle } from './particles.js';

/** How close Marlo must be to a start marker for its prompt (and E) to count. */
const MARKER_RANGE = 88;
/** Radius of a drive-to / reach checkpoint. */
const GOTO_RADIUS = 66;
/** A "stop" objective also wants the car nearly still. */
const STOP_SPEED = 34;
/** Damage (combat.js counts hits on car.damage) at which a delivery car is a wreck. */
const WRECK_DAMAGE = 5;

/**
 * The mission system for one world. `hooks` is main.js's wire to the audio system:
 * payout() when money lands, jingle() on a completion, sting() on a failure.
 */
export function createMissions(world, traffic, police, rng, hooks = {}) {
  const progress = { storyIndex: 0, respect: 0, fares: 0, deliveries: 0, storyDone: false };

  const poi = (kind) => world.pois.find((p) => p.kind === kind) ?? { x: world.playerSpawn.x, y: world.playerSpawn.y, name: 'Sunfall City' };
  const parkPoi = (i) => {
    const parks = world.pois.filter((p) => p.kind === 'park');
    return parks.length ? parks[i % parks.length] : poi('boardwalk');
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // --- Objective constructors ---------------------------------------------------------
  const goto = (target, label, opts = {}) => ({
    kind: 'goto', x: target.x, y: target.y, label,
    needCar: !!opts.needCar, stop: !!opts.stop, time: opts.time ?? null,
  });
  const checkpoints = (spots, label, opts = {}) => ({
    kind: 'checkpoints', spots: spots.map((s) => ({ x: s.x, y: s.y, name: s.name })),
    label, spot: 0, time: opts.time ?? null,
  });
  const deliver = (spawn, dest, opts = {}) => ({
    kind: 'deliver', stage: 'take',
    spawn: { x: spawn.x, y: spawn.y }, dest: { x: dest.x, y: dest.y },
    typeId: opts.typeId, color: opts.color, carName: opts.carName,
    destLabel: opts.destLabel, time: opts.time ?? null,
    takeHeat: opts.takeHeat ?? 0, car: null, damage0: 0,
  });
  const escape = (heat, label) => ({ kind: 'escape', heat, label, raised: false, age: 0 });

  // --- The story ----------------------------------------------------------------------
  const STORY = [
    {
      title: 'First Wheels',
      startKind: 'diner',
      payout: 400,
      intro: [
        { who: 'Delia Vance', text: 'Marlo. Word is you drive like the road owes you money. Good — I pay for exactly that.' },
        { who: 'Delia Vance', text: 'Rivera Auto Works, over in the Old Market. Rico is leaving a little Brisa by the shutters. Bring it to Palm Court, paint intact.' },
        { who: 'Rico (phone)', text: 'She runs quiet, friend. Whatever Delia told you — keep her quiet and keep her whole.' },
      ],
      objectives: () => [
        goto(poi('garage'), 'Get to Rivera Auto Works'),
        deliver(
          { x: poi('garage').x + 30, y: poi('garage').y + 46 },
          poi('home'),
          { typeId: 'hatch', color: '#7ec850', carName: 'Brisa Hatch', destLabel: 'Palm Court', time: 300 },
        ),
      ],
    },
    {
      title: 'Market Run',
      startKind: 'market',
      payout: 550,
      intro: [
        { who: 'Auntie Sol', text: 'Marlo, mijo. My stall feeds half the Old Market, and today my suppliers feed none of me.' },
        { who: 'Auntie Sol', text: 'Three stops, samples at each: the boardwalk, the Salty Palm, the docks gate. Then back to my stall — and the soup is still hot, yes?' },
      ],
      objectives: () => [
        checkpoints(
          [poi('boardwalk'), poi('diner'), poi('docks')],
          'Collect Auntie Sol’s samples',
          { time: 330 },
        ),
        goto(poi('market'), 'Return to Mercado Central'),
      ],
    },
    {
      title: 'Hot Metal',
      startKind: 'docks',
      payout: 700,
      intro: [
        { who: 'Ferra, dockmaster', text: 'Customs opened a crate with my name on it and cargo I never ordered. It is ashore already. Nothing to move, driver.' },
        { who: 'Ferra, dockmaster', text: 'What I need is Harbor PD looking anywhere but these docks. Roll past the warehouse, make some noise, lose them, then come back clean.' },
      ],
      objectives: () => [
        goto(poi('warehouse'), 'Roll past the Dockside Warehouse', { needCar: true }),
        escape(150, 'Draw Harbor PD’s eye — then lose them'),
        goto(poi('docks'), 'Return to the Sunfall Docks, clean'),
      ],
    },
    {
      title: 'The Quiet Passenger',
      startKind: 'hotel',
      payout: 900,
      intro: [
        { who: 'Delia Vance', text: 'A guest at the Grand Hotel pays very well to not be followed. You are the broom, Marlo.' },
        { who: 'Delia Vance', text: 'Sweep three lookout spots — Sunfall General’s steps, Meridian Tower, the hillside park. If a tail is watching, that is where it sits. Then bring her to the Salty Palm.' },
      ],
      objectives: () => [
        checkpoints(
          [poi('hospital'), poi('office'), parkPoi(1)],
          'Sweep the lookout spots',
          { time: 380 },
        ),
        goto(poi('diner'), 'Bring the passenger to The Salty Palm Diner'),
      ],
    },
    {
      title: 'Portside Shuffle',
      startKind: 'warehouse',
      payout: 1200,
      intro: [
        { who: 'Ferra, dockmaster', text: 'A Portside van. Inside: medicine that fell off a manifest and onto my conscience.' },
        { who: 'Ferra, dockmaster', text: 'Sunfall General’s back lot. The van arrives whole or not at all — and once it moves, expect company. Lose them after the drop.' },
      ],
      objectives: () => [
        deliver(
          { x: poi('warehouse').x - 24, y: poi('warehouse').y + 52 },
          { x: poi('hospital').x + 20, y: poi('hospital').y + 40 },
          { typeId: 'van', color: '#e8e6df', carName: 'Portside Van', destLabel: 'Sunfall General', time: 330, takeHeat: 45 },
        ),
        escape(270, 'Lose Harbor PD'),
      ],
    },
    {
      title: 'Neon Palms',
      startKind: 'diner',
      payout: 2500,
      intro: [
        { who: 'Delia Vance', text: 'Last job, Marlo. The coupe at Palm Court — the teal one the whole beach has seen you admire.' },
        { who: 'Delia Vance', text: 'Docks by sundown, then shake the entire precinct off your tail, then the boardwalk. We will watch the sun do its thing. You have earned the view.' },
      ],
      objectives: () => [
        deliver(
          { x: poi('home').x + 26, y: poi('home').y + 44 },
          poi('docks'),
          { typeId: 'coupe', color: '#12b5a5', carName: 'Solstice Coupe', destLabel: 'the Sunfall Docks', time: 360, takeHeat: 30 },
        ),
        escape(300, 'Shake the whole precinct'),
        goto(poi('boardwalk'), 'Meet Delia on the boardwalk'),
      ],
    },
  ];

  // --- Live state ---------------------------------------------------------------------
  let active = null; // { kind, title, phase, lines, lineIndex, objectives, oi, timeLeft, ... }
  let promptText = null;

  const currentObjective = () => (active && active.oi < active.objectives.length
    ? active.objectives[active.oi] : null);

  function banner(state, title, sub) {
    state.missionBanner = { title, sub, until: state.time + 3.6 };
  }

  function beginObjective(state, obj) {
    active.timeLeft = obj.time;
    if (obj.kind === 'deliver' && !obj.car) {
      obj.car = createCar({ typeId: obj.typeId, color: obj.color, x: obj.spawn.x, y: obj.spawn.y, angle: 0 });
      traffic.addVehicle(obj.car);
      obj.damage0 = obj.car.damage ?? 0;
    }
    if (obj.kind === 'escape' && !obj.raised) {
      police.addHeat(obj.heat, state.player.x, state.player.y);
      obj.raised = true;
      obj.age = 0;
    }
  }

  function startActivity(state, def) {
    active = {
      kind: def.kind,
      title: def.title,
      phase: 'dialogue',
      lines: def.intro,
      lineIndex: 0,
      objectives: def.objectives(),
      oi: 0,
      timeLeft: null,
      payout: def.payout ?? 0,
      fare: def.fare ?? null,
    };
    state.pendingAnnounce = `${def.title} — a new job.`;
  }

  function fail(state, reason, silent = false) {
    if (!active) return;
    const title = active.title;
    active = null;
    banner(state, 'JOB FAILED', `${title} — ${reason}`);
    state.pendingAnnounce = `Job failed: ${reason}`;
    if (!silent) hooks.sting?.();
  }

  function complete(state) {
    const { player } = state;
    let payout = active.payout;
    let note = '';
    if (active.kind === 'taxi' && active.fare) {
      payout = active.fare.amount;
      if (active.fare.tip) { payout = Math.round(payout * 1.35); note = ' (clean + fast tip included)'; }
      progress.fares += 1;
    } else if (active.kind === 'courier') {
      payout = Math.round(40 + Math.max(0, active.timeLeft ?? 0) * 1.2);
      progress.deliveries += 1;
    } else {
      // Story job: a kept-clean delivery car pays a care bonus.
      const obj = active.objectives.find((o) => o.kind === 'deliver');
      if (obj && obj.car && (obj.car.damage ?? 0) - obj.damage0 === 0) {
        payout += 100;
        note = ' (car kept spotless: +$100)';
      }
      progress.storyIndex += 1;
      progress.respect += 2;
      if (progress.storyIndex >= STORY.length) progress.storyDone = true;
    }
    if (active.kind !== 'story') progress.respect += 1;
    player.cash += payout;
    spawnSparkle(player.x, player.y, 12); // Money landing gets a little gold weather.
    banner(state, active.kind === 'story' ? 'MISSION COMPLETE' : 'JOB DONE',
      `${active.title} — $${payout}${note}`);
    state.pendingAnnounce = `${active.title} complete — $${payout}.`;
    hooks.payout?.();
    hooks.jingle?.();
    state.needsSave = true;
    const doneTitle = active.title;
    active = null;
    if (progress.storyDone && doneTitle === 'Neon Palms') {
      state.pendingAnnounce = 'Story complete — Sunfall City is yours. Side work stays open.';
    }
  }

  // --- Side work ----------------------------------------------------------------------
  const SIDE_POI_KINDS = ['diner', 'hotel', 'market', 'garage', 'hospital', 'boardwalk', 'docks', 'office', 'home'];

  function pickPoi(minD, maxD, from) {
    const options = world.pois.filter((p) => SIDE_POI_KINDS.includes(p.kind));
    for (let i = 0; i < 12; i += 1) {
      const cand = rng.pick(options);
      const d = Math.hypot(cand.x - from.x, cand.y - from.y);
      if (d >= minD && d <= maxD) return cand;
    }
    return options[0] ?? poi('diner');
  }

  function taxiDef(state) {
    const pickup = pickPoi(420, 2400, state.player);
    const drop = pickPoi(650, 3200, pickup);
    const trip = Math.hypot(drop.x - pickup.x, drop.y - pickup.y);
    const par = trip / 235 + 26;
    return {
      kind: 'taxi',
      title: 'SunCab Fare',
      intro: [{ who: 'SunCab dispatch', text: `Fare waiting at ${pickup.name}. Drop them at ${drop.name}. Meter's running, friend.` }],
      objectives: () => [
        { ...goto(pickup, `Pick up your fare at ${pickup.name}`, { needCar: true, stop: true }) },
        { ...goto(drop, `Drop your fare at ${drop.name}`, { needCar: true, stop: true, time: Math.round(par * 2.2) }) },
      ],
      fare: { amount: Math.round(16 + trip * 0.055), tip: false, par },
    };
  }

  function courierDef(state) {
    const drop = pickPoi(600, 3000, state.player);
    const d = Math.hypot(drop.x - state.player.x, drop.y - state.player.y);
    const time = Math.round(d / 225 + 32);
    return {
      kind: 'courier',
      title: 'Courier Run',
      intro: [{ who: 'Mercado courier desk', text: `One parcel, no questions. ${drop.name}, against the clock. The faster it lands, the fatter the envelope.` }],
      objectives: () => [goto(drop, `Deliver the parcel to ${drop.name}`, { time })],
      payout: 0, // Priced from the clock left at the drop, in complete().
    };
  }

  // --- Markers ------------------------------------------------------------------------
  const sideUnlocked = () => progress.storyIndex >= 2 || progress.storyDone;

  function markers(state) {
    if (active) {
      // A waiting taxi client stands at the pickup until Marlo stops beside them.
      if (active.kind === 'taxi' && active.phase === 'run' && active.oi === 0) {
        const obj = currentObjective();
        if (obj) return [{ kind: 'client', x: obj.x, y: obj.y, label: 'Fare' }];
      }
      return [];
    }
    const list = [];
    if (!progress.storyDone && progress.storyIndex < STORY.length) {
      const at = poi(STORY[progress.storyIndex].startKind);
      list.push({ kind: 'story', x: at.x, y: at.y, label: STORY[progress.storyIndex].title });
    }
    if (sideUnlocked()) {
      const cab = poi('boardwalk');
      list.push({ kind: 'taxi', x: cab.x, y: cab.y, label: 'SunCab stand' });
      const desk = poi('market');
      list.push({ kind: 'courier', x: desk.x, y: desk.y, label: 'Courier desk' });
    }
    return list;
  }

  // --- Per-step update ------------------------------------------------------------------
  function update(state, input, dt) {
    const { player } = state;
    promptText = null;

    // Busted or wasted ends any job on the spot (the fine and the fee already landed).
    if (active && state.pendingAnnounce
      && (state.pendingAnnounce.startsWith('BUSTED') || state.pendingAnnounce.startsWith('WASTED'))) {
      fail(state, state.pendingAnnounce.startsWith('BUSTED') ? 'Busted mid-job.' : 'Wasted mid-job.', true);
      return;
    }

    if (!active) {
      // Offer the nearest start marker, if Marlo is standing in one.
      let best = null;
      for (const marker of markers(state)) {
        const d = Math.hypot(marker.x - player.x, marker.y - player.y);
        if (d < MARKER_RANGE && (!best || d < best.d)) best = { ...marker, d };
      }
      if (best) {
        promptText = best.kind === 'story'
          ? `E — ${best.label} (new job)`
          : best.kind === 'taxi' ? 'E — hail a SunCab fare' : 'E — take a courier run';
        if (input.wasPressed('KeyE')) {
          if (best.kind === 'story') {
            const def = STORY[progress.storyIndex];
            startActivity(state, { kind: 'story', title: def.title, intro: def.intro, objectives: def.objectives, payout: def.payout });
          } else if (best.kind === 'taxi') startActivity(state, taxiDef(state));
          else startActivity(state, courierDef(state));
        }
      }
      return;
    }

    if (active.phase === 'dialogue') {
      if (input.wasPressed('KeyE')) {
        active.lineIndex += 1;
        if (active.lineIndex >= active.lines.length) {
          active.phase = 'run';
          const obj = currentObjective();
          if (obj) beginObjective(state, obj);
        }
      }
      return;
    }

    // Phase 'run': tick the clock, watch the failure states, test the objective.
    const obj = currentObjective();
    if (!obj) { complete(state); return; }
    if (active.timeLeft !== null && active.timeLeft !== undefined) {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) { fail(state, 'Out of time.'); return; }
    }

    const speed = Math.hypot(player.vx, player.vy);
    const arrived = (target, radius, needStop) => Math.hypot(target.x - player.x, target.y - player.y) < radius
      && (!needStop || speed < STOP_SPEED);

    let advance = false;
    if (obj.kind === 'goto') {
      if (arrived(obj, GOTO_RADIUS, obj.stop) && (!obj.needCar || player.mode === 'car')) advance = true;
    } else if (obj.kind === 'checkpoints') {
      const spot = obj.spots[obj.spot];
      if (spot && arrived(spot, GOTO_RADIUS, false)) {
        obj.spot += 1;
        if (obj.spot >= obj.spots.length) advance = true;
      }
    } else if (obj.kind === 'deliver') {
      const dmg = (obj.car.damage ?? 0) - obj.damage0;
      if (dmg >= WRECK_DAMAGE) { fail(state, `The ${obj.carName} is wrecked.`); return; }
      if (obj.stage === 'take') {
        if (player.mode === 'car' && player.car === obj.car) {
          obj.stage = 'drop';
          if (obj.takeHeat > 0) police.addHeat(obj.takeHeat, player.x, player.y);
        }
      } else if (player.mode === 'car' && player.car === obj.car && arrived(obj.dest, GOTO_RADIUS + 8, true)) {
        advance = true;
      }
    } else if (obj.kind === 'escape') {
      obj.age += dt;
      if (obj.raised && obj.age > 2 && police.stars === 0) advance = true;
    }

    if (advance) {
      active.oi += 1;
      const next = currentObjective();
      if (!next) { complete(state); return; }
      beginObjective(state, next);
      // A taxi fare's tip is earned between pickup and drop: fast, same car, no new dents.
      if (active.kind === 'taxi' && active.fare && active.oi === 1) {
        active.fare.carRef = player.car;
        active.fare.damage0 = player.car ? (player.car.damage ?? 0) : 0;
        active.fare.elapsed = 0;
      }
    }
    if (active && active.kind === 'taxi' && active.fare && active.oi === 1) {
      active.fare.elapsed = (active.fare.elapsed ?? 0) + dt;
      const clean = player.car === active.fare.carRef
        && ((player.car?.damage ?? 0) - (active.fare.damage0 ?? 0)) === 0;
      active.fare.tip = clean && active.fare.elapsed <= active.fare.par;
    }
  }

  // --- Read-outs for the HUD ------------------------------------------------------------
  function objectiveText() {
    if (!active) return null;
    if (active.phase === 'dialogue') return `${active.title} — hear them out`;
    const obj = currentObjective();
    if (!obj) return active.title;
    if (obj.kind === 'goto') return obj.label;
    if (obj.kind === 'checkpoints') {
      const spot = obj.spots[Math.min(obj.spot, obj.spots.length - 1)];
      return `${obj.label} — stop ${Math.min(obj.spot + 1, obj.spots.length)}/${obj.spots.length}: ${spot.name}`;
    }
    if (obj.kind === 'deliver') {
      if (obj.stage === 'take') return `Take the ${obj.carName}`;
      const dmg = (obj.car.damage ?? 0) - obj.damage0;
      return `Deliver the ${obj.carName} to ${obj.destLabel} — damage ${dmg}/${WRECK_DAMAGE}`;
    }
    if (obj.kind === 'escape') return `${obj.label} — heat dies when nobody sees you`;
    return active.title;
  }

  function waypoint() {
    if (!active || active.phase !== 'run') {
      if (!active && !progress.storyDone && progress.storyIndex < STORY.length) {
        const at = poi(STORY[progress.storyIndex].startKind);
        return { x: at.x, y: at.y, marker: true };
      }
      return null;
    }
    const obj = currentObjective();
    if (!obj) return null;
    if (obj.kind === 'goto') return { x: obj.x, y: obj.y };
    if (obj.kind === 'checkpoints') {
      const spot = obj.spots[Math.min(obj.spot, obj.spots.length - 1)];
      return spot ? { x: spot.x, y: spot.y } : null;
    }
    if (obj.kind === 'deliver') {
      return obj.stage === 'take' ? { x: obj.car.x, y: obj.car.y } : { x: obj.dest.x, y: obj.dest.y };
    }
    return null; // Escape: no waypoint — just run.
  }

  return {
    progress,
    STORY,
    get active() { return active; },
    get dialogue() {
      if (!active || active.phase !== 'dialogue') return null;
      return active.lines[Math.min(active.lineIndex, active.lines.length - 1)] ?? null;
    },
    get promptText() { return promptText; },
    get timeLeft() { return active && active.phase === 'run' ? active.timeLeft : null; },
    markers,
    objectiveText,
    waypoint,
    update,
    // Test and staging seams: start the current story job / drop any live job.
    startStory(state) {
      if (active || progress.storyDone) return false;
      const def = STORY[progress.storyIndex];
      startActivity(state, { kind: 'story', title: def.title, intro: def.intro, objectives: def.objectives, payout: def.payout });
      return true;
    },
    cancel() { active = null; },
  };
}
