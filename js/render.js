import { COLS, ROWS, CELLS, rowOf, colOf } from './grid.js';
import { isFound } from './game.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createBoard(container) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'lines');
  svg.setAttribute('viewBox', `0 0 ${COLS} ${ROWS}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const tiles = [];
  for (let i = 0; i < CELLS; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = String(i);
    tile.append(document.createElement('span'));
    tiles.push(tile);
  }
  container.replaceChildren(svg, ...tiles);
  return { gridEl: container, svg, tiles };
}

function polyline(path, className) {
  const el = document.createElementNS(SVG_NS, 'polyline');
  el.setAttribute('points', path.map((i) => `${colOf(i) + 0.5},${rowOf(i) + 0.5}`).join(' '));
  el.setAttribute('class', className);
  return el;
}

export function renderBoard(board, { puzzle, state, selection }) {
  const kind = new Map();
  const foundAnswers = puzzle.answers.filter((a) => isFound(state, a.word));
  for (const a of foundAnswers) {
    for (const cell of a.path) kind.set(cell, a.isSpangram ? 'spangram' : 'theme');
  }
  const hint = state.activeHint ? puzzle.answers.find((a) => a.word === state.activeHint.word) : null;
  const hinted = new Set(hint ? hint.path : []);
  const showOrder = state.activeHint?.level === 2;
  const selected = new Set(selection);

  board.tiles.forEach((tile, i) => {
    tile.firstChild.textContent = puzzle.grid[i];
    const classes = ['tile'];
    if (kind.has(i)) classes.push('found', kind.get(i));
    if (selected.has(i)) classes.push('selected');
    if (hinted.has(i) && !kind.has(i)) classes.push('hinted');
    if (showOrder && hint.path[0] === i) classes.push('hint-start');
    tile.className = classes.join(' ');
  });

  const lines = foundAnswers.map((a) => polyline(a.path, `line ${a.isSpangram ? 'spangram' : 'theme'}`));
  if (hint && showOrder) lines.push(polyline(hint.path, 'line hint'));
  if (selection.length > 1) lines.push(polyline(selection, 'line selected'));
  board.svg.replaceChildren(...lines);
}
