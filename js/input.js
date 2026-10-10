import { isAdjacent, crossesLinks } from './grid.js';

const HIT_RADIUS = 0.42; // fraction of tile width that counts as "on" a tile while dragging

// The selection may cross its own earlier links; such a trace can only make a bonus word or
// stepping stone, never an answer (see game.js). `blocked` lets a caller forbid crossing given
// links; the app passes none, since solved words no longer block anything.
function canExtend(path, cell, blocked) {
  const last = path[path.length - 1];
  return isAdjacent(last, cell) && !crossesLinks(last, cell, blocked);
}

export function stepTap(path, cell, isSelectable, blocked = new Map()) {
  if (!isSelectable(cell)) return [];
  const at = path.indexOf(cell);
  if (at >= 0) return path.slice(0, at + 1);
  if (path.length && canExtend(path, cell, blocked)) return [...path, cell];
  return [cell];
}

export function stepDrag(path, cell, isSelectable, blocked = new Map()) {
  if (path.length >= 2 && cell === path[path.length - 2]) return path.slice(0, -1);
  if (path.includes(cell) || !isSelectable(cell)) return path;
  if (path.length && canExtend(path, cell, blocked)) return [...path, cell];
  return path;
}

export function createSelection({ gridEl, isSelectable, onChange, onSubmit, shouldAutoSubmit = () => false, blockedLinks = () => new Map() }) {
  let path = [];
  let pressed = false;
  let dragged = false;
  let pendingSubmit = false;
  let activePointer = null;

  const set = (next) => {
    path = next;
    onChange(path);
    // Submit mid-gesture once the selection is a complete answer; the rest of the
    // drag (or the release) then sees an empty path and does nothing.
    if (path.length > 1 && shouldAutoSubmit(path)) {
      pendingSubmit = false;
      submit();
    }
  };

  const submit = () => {
    const submitted = path;
    set([]);
    if (submitted.length > 1) onSubmit(submitted);
  };

  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest('.tile');
    if (!el || !gridEl.contains(el)) return null;
    const rect = el.getBoundingClientRect();
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) > rect.width * HIT_RADIUS) return null;
    return Number(el.dataset.index);
  };

  gridEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (pressed && e.pointerId !== activePointer) return;
    const el = e.target.closest('.tile');
    if (!el) return;
    e.preventDefault();
    const cell = Number(el.dataset.index);
    if (!isSelectable(cell)) {
      set([]);
      return;
    }
    pressed = true;
    activePointer = e.pointerId;
    dragged = false;
    pendingSubmit = path.length > 0 && cell === path[path.length - 1];
    if (!pendingSubmit) set(stepTap(path, cell, isSelectable, blockedLinks()));
    gridEl.setPointerCapture?.(e.pointerId);
  });

  gridEl.addEventListener('pointermove', (e) => {
    if (!pressed || e.pointerId !== activePointer) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell === null || cell === path[path.length - 1]) return;
    const next = stepDrag(path, cell, isSelectable, blockedLinks());
    if (next !== path) {
      dragged = true;
      pendingSubmit = false;
      set(next);
    }
  });

  gridEl.addEventListener('pointerup', (e) => {
    if (!pressed || e.pointerId !== activePointer) return;
    pressed = false;
    if (dragged || pendingSubmit) submit();
    pendingSubmit = false;
  });

  const resetPress = (e) => {
    if (e.pointerId !== activePointer) return;
    pressed = false;
    pendingSubmit = false;
    activePointer = null;
  };

  gridEl.addEventListener('pointercancel', resetPress);
  // Fires after pointerup too; by then pressed is already false, so this is a no-op.
  gridEl.addEventListener('lostpointercapture', resetPress);

  return {
    clear: () => set([]),
    get path() {
      return path;
    },
  };
}
