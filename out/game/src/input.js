// Keyboard and mouse input. Held keys are a set the game polls every step; one-shot presses
// (confirm, pause) are queued as bit flags and taken once by the loop, so a press between
// two frames is never lost and never counted twice. Edge-triggered keys like F (enter car)
// are read through wasPressed() and cleared once per frame by endFrame().

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;

const CONFIRM = new Set(['Enter', 'NumpadEnter']);
const PAUSE = new Set(['Escape', 'KeyP']);
/** Keys the page must not scroll or search on while playing. */
const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'ShiftLeft', 'ShiftRight',
]);

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  let actions = 0;
  const mouse = { x: 0, y: 0, down: false };

  window.addEventListener('keydown', (event) => {
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    }
    if (GAME_KEYS.has(event.code) || CONFIRM.has(event.code) || PAUSE.has(event.code)) {
      event.preventDefault();
      if (!event.repeat) pressed.add(event.code);
      held.add(event.code);
    }
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    pressed.clear();
    mouse.down = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  });
  canvas.addEventListener('pointerdown', (event) => {
    mouse.down = true;
    mouse.x = event.clientX - canvas.getBoundingClientRect().left;
    mouse.y = event.clientY - canvas.getBoundingClientRect().top;
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('pointerup', () => {
    mouse.down = false;
  });

  return {
    mouse,
    /** Is this key code currently held down? */
    down(code) {
      return held.has(code);
    },
    /** Was this key code newly pressed since the last endFrame()? */
    wasPressed(code) {
      return pressed.has(code);
    },
    /** Movement axis from WASD and the arrow keys: each component is -1, 0 or 1. */
    axis() {
      const x = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
      const y = (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
      return { x, y };
    },
    /** True while either Shift key is held (run on foot). */
    running() {
      return held.has('ShiftLeft') || held.has('ShiftRight');
    },
    /** True while Space is held (handbrake in a car). */
    handbrake() {
      return held.has('Space');
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Clear the per-frame pressed set; the main loop calls this after every frame. */
    endFrame() {
      pressed.clear();
    },
  };
}
