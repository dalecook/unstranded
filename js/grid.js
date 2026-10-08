// Grid geometry shared by the generator, game logic, input and rendering.
export const COLS = 6;
export const ROWS = 8;
export const CELLS = COLS * ROWS;

export const rowOf = (i) => Math.floor(i / COLS);
export const colOf = (i) => i % COLS;

export function isAdjacent(a, b) {
  if (a === b) return false;
  return Math.abs(rowOf(a) - rowOf(b)) <= 1 && Math.abs(colOf(a) - colOf(b)) <= 1;
}

export function neighbors(i) {
  const out = [];
  const r = rowOf(i);
  const c = colOf(i);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) out.push(nr * COLS + nc);
    }
  }
  return out;
}

export function isValidPath(path) {
  if (path.length === 0) return false;
  const seen = new Set();
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    if (!Number.isInteger(i) || i < 0 || i >= CELLS || seen.has(i)) return false;
    seen.add(i);
    if (k > 0 && !isAdjacent(path[k - 1], i)) return false;
  }
  return true;
}

export function touchesOppositeEdges(path) {
  const cols = path.map(colOf);
  const rows = path.map(rowOf);
  return (cols.includes(0) && cols.includes(COLS - 1)) ||
    (rows.includes(0) && rows.includes(ROWS - 1));
}

export function samePath(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
