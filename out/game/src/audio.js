// Sound: every noise in NEON PALMS is synthesised with WebAudio — there are no audio
// assets. A lazy AudioContext wakes on the first user gesture (browsers refuse sound
// before one). Continuous voices — the engine hum of the car Marlo is driving, a skid
// hiss while it drifts, Harbor PD's two-tone siren when a unit is close — are steered
// every step by update(state, dt) from the live game state. One-shots (gunfire, impacts,
// the cash register, jingles) are fired from hooks: gunfire and crashes arrive through
// traffic.js's crime registry, payouts and mission results through the hooks object
// main.js hands to missions.js. M toggles a master mute that the save file remembers.
import { carForwardSpeed } from './player.js';
import { onCrime } from './traffic.js';

/** Warm title-screen chords (Hz triads): Am — F — C — G, low and slow. */
const PAD_CHORDS = [
  [110.0, 164.81, 261.63],
  [87.31, 174.61, 220.0],
  [130.81, 164.81, 196.0],
  [98.0, 196.0, 246.94],
];

/**
 * The audio system. Safe to construct anywhere (including Node, for tests): the context,
 * oscillators and listeners only appear on the first update after a real gesture in a
 * real browser, and every failure to start audio is swallowed — silence, never a crash.
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let skidSrc = null;
  let skidGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let padOscs = [];
  let padGain = null;
  let padStep = 0;
  let padTimer = 0;
  let sirenPhase = 0;
  let muted = false;
  let gestureSeen = false;

  if (typeof window !== 'undefined' && window.addEventListener) {
    const note = () => { gestureSeen = true; };
    window.addEventListener('pointerdown', note, { passive: true });
    window.addEventListener('keydown', note);
  }

  /** Build the context and the continuous voices. Idempotent; no-op without a gesture. */
  function ensure() {
    if (ctx || !gestureSeen) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);

      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 52;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter).connect(engineGain).connect(master);
      engineOsc.start();

      // Skid: looped white noise through a band-pass, silent until a drift opens it.
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      skidSrc = ctx.createBufferSource();
      skidSrc.buffer = noiseBuf;
      skidSrc.loop = true;
      const skidFilter = ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.value = 900;
      skidFilter.Q.value = 1.4;
      skidGain = ctx.createGain();
      skidGain.gain.value = 0;
      skidSrc.connect(skidFilter).connect(skidGain).connect(master);
      skidSrc.start();

      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 700;
      const sirenFilter = ctx.createBiquadFilter();
      sirenFilter.type = 'lowpass';
      sirenFilter.frequency.value = 1600;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenFilter).connect(sirenGain).connect(master);
      sirenOsc.start();

      padGain = ctx.createGain();
      padGain.gain.value = 0;
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 640;
      padGain.connect(padFilter).connect(master);
      padOscs = PAD_CHORDS[0].map((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(padGain);
        osc.start();
        return osc;
      });
    } catch {
      ctx = null; // No audio hardware / blocked: the game simply stays silent.
    }
  }

  /** One enveloped tone; the building block under every one-shot below. */
  function tone(freq, dur, { type = 'sine', gain = 0.16, slide = 0, delay = 0 } = {}) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(24, freq + slide), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A short burst of filtered noise: gunshots, thuds, cash-register paper. */
  function noiseBurst(dur, { gain = 0.2, freq = 1200, q = 0.8, delay = 0 } = {}) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
  }

  const api = {
    get muted() { return muted; },
    setMuted(value) {
      muted = !!value;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.03);
    },
    toggleMute() {
      api.setMuted(!muted);
      return muted;
    },

    /** Marlo's pistol: a crack of noise over a dropping square blip. */
    shot() {
      noiseBurst(0.09, { gain: 0.22, freq: 2100, q: 0.6 });
      tone(190, 0.07, { type: 'square', gain: 0.1, slide: -120 });
    },
    /** Something solid got hit: a car panel, a body, a wall. */
    thud() {
      noiseBurst(0.13, { gain: 0.2, freq: 260, q: 0.7 });
      tone(74, 0.12, { type: 'sine', gain: 0.18, slide: -30 });
    },
    /** Money in: the little two-note register arpeggio, plus paper noise. */
    payout() {
      tone(1318, 0.09, { type: 'square', gain: 0.07 });
      tone(1760, 0.16, { type: 'square', gain: 0.07, delay: 0.07 });
      noiseBurst(0.05, { gain: 0.05, freq: 3400, q: 1.2, delay: 0.02 });
    },
    /** Mission complete: a warm four-note rise. */
    jingle() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone(freq, 0.22, { type: 'triangle', gain: 0.13, delay: i * 0.09 });
      });
    },
    /** Mission failed / busted / wasted: two low notes falling away. */
    sting() {
      tone(220, 0.24, { type: 'triangle', gain: 0.14 });
      tone(155.56, 0.4, { type: 'triangle', gain: 0.14, delay: 0.16 });
    },
    /** Menu blip for title and pause selections. */
    click() {
      tone(880, 0.05, { type: 'sine', gain: 0.06 });
    },

    /** Steer the continuous voices from the live state. Called once per fixed step. */
    update(state, dt) {
      ensure();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t = ctx.currentTime;
      const { player, police } = state;

      // Under the pause menu every continuous voice settles to silence.
      if (state.screen === 'paused') {
        engineGain.gain.setTargetAtTime(0, t, 0.05);
        skidGain.gain.setTargetAtTime(0, t, 0.05);
        sirenGain.gain.setTargetAtTime(0, t, 0.05);
        padGain.gain.setTargetAtTime(0, t, 0.05);
        return;
      }

      // Engine: pitch and volume follow the driven car's road speed.
      let engineTarget = 0;
      if (player.mode === 'car' && player.car && state.screen !== 'title') {
        const speed = Math.abs(carForwardSpeed(player.car));
        engineOsc.frequency.setTargetAtTime(50 + speed * 0.42, t, 0.06);
        engineTarget = 0.028 + Math.min(0.05, speed * 0.00016);
        // Skid: handbrake held at speed — the tyres give up and sing.
        const skidding = state.inputRef && state.inputRef.handbrake() && speed > 105;
        skidGain.gain.setTargetAtTime(skidding ? 0.075 : 0, t, 0.05);
      } else {
        skidGain.gain.setTargetAtTime(0, t, 0.05);
      }
      engineGain.gain.setTargetAtTime(engineTarget, t, 0.09);

      // Siren: only while wanted, and only as loud as the nearest unit is close.
      let sirenTarget = 0;
      if (police && police.stars > 0 && police.units.length > 0) {
        let nearest = Infinity;
        for (const unit of police.units) {
          const d = Math.hypot(unit.car.x - player.x, unit.car.y - player.y);
          if (d < nearest) nearest = d;
        }
        if (nearest < 760) {
          sirenTarget = 0.016 + 0.03 * (1 - nearest / 760);
          sirenPhase += dt * 4.6;
          sirenOsc.frequency.setTargetAtTime(Math.sin(sirenPhase) > 0 ? 940 : 660, t, 0.03);
        }
      }
      sirenGain.gain.setTargetAtTime(sirenTarget, t, 0.12);

      // Title pad: slow chords under the menu; fades out once the city takes over.
      const onTitle = state.screen === 'title';
      padGain.gain.setTargetAtTime(onTitle ? 0.05 : 0, t, 0.4);
      if (onTitle) {
        padTimer += dt;
        if (padTimer > 7.5) {
          padTimer = 0;
          padStep = (padStep + 1) % PAD_CHORDS.length;
          padOscs.forEach((osc, i) => {
            osc.frequency.setTargetAtTime(PAD_CHORDS[padStep][i], t, 1.6);
          });
        }
      }
    },
  };

  // Crime-driven one-shots: shots crack, crashes and hit pedestrians thud. The crimes
  // fire in shot scenes too, but with no context built they land silently.
  onCrime('gunfire', () => api.shot());
  onCrime('crash', () => api.thud());
  onCrime('hitped', () => api.thud());

  return api;
}
