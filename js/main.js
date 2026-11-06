import {
  newGameState, layoutKey, submitWord, useHint, canHint, availableHints, completedAnswer, migrateState, HINT_COST,
} from './game.js';
import { dateKey } from './rng.js';
import { loadDrops, dailyFor, getPuzzle, canOpen, randomPuzzle } from './drops.js';
import { loadSequence, setFor } from './sequence.js';
import { createBoard, renderBoard } from './render.js';
import { createSelection } from './input.js';
import {
  loadProgress, saveProgress, loadStats, saveStats, applyStart, applyCompletion,
  displayStreak, isFirstVisit, markVisited, markPlayed, markSolved, loadPlayed, loadSolved,
  loadSetProgress, saveSetProgress,
} from './storage.js';
import { buildShareText, shareText } from './share.js';

const $ = (id) => document.getElementById(id);

const MESSAGES = {
  spangram: 'SPANGRAM!',
  'already-found': 'Already found',
  'too-short': 'Too short',
  'not-a-word': 'Not in word list',
  'crossed-answer': 'No crossing over for theme words',
};
const SHAKE_ON = new Set(['already-found', 'too-short', 'not-a-word', 'crossed-answer']);
const MESSAGE_MS = 1800;
const FREE_PLAY_NOTE = "That's today's 6. Now it's free play.";

const app = {
  drops: [],
  seq: null,
  dictionary: null,
  puzzle: null,
  state: null,
  isDaily: false,
  today: dateKey(),
  selection: [],
  message: '',
  board: null,
  selector: null,
};

let messageTimer = 0;
let resultsTimer = 0;

function render() {
  const { puzzle, state } = app;
  if (!puzzle) return;
  renderBoard(app.board, { puzzle, state, selection: app.selection });
  const set = setFor(app.seq, app.today);
  const position = set ? set.findIndex((p) => p.id === puzzle.id) : -1;
  const label = position >= 0 ? `TODAY ${position + 1} OF ${set.length}` : (app.isDaily ? "TODAY'S THEME" : 'PUZZLE');
  $('theme-label').textContent = label + (puzzle.obscure ? ' · DEEP CUT' : '');
  $('clue').textContent = puzzle.clue;
  $('daily-btn').hidden = app.isDaily;

  const current = $('current');
  const showMessage = app.selection.length === 0 && Boolean(app.message);
  current.textContent = showMessage ? app.message : app.selection.map((i) => puzzle.grid[i]).join('');
  current.classList.toggle('message', showMessage);

  $('found-count').textContent = String(state.found.length);
  $('total-count').textContent = String(puzzle.answers.length);

  const hintBtn = $('hint-btn');
  hintBtn.disabled = !canHint(state);
  const hints = availableHints(state);
  hintBtn.textContent = hints > 0 ? `Hint ×${hints}` : 'Hint';
  hintBtn.style.setProperty('--meter', String(state.hintMeter / HINT_COST));
  $('share-btn').hidden = !state.completed;
}

function flashMessage(text) {
  app.message = text;
  render();
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    app.message = '';
    render();
  }, MESSAGE_MS);
}

function shake() {
  const grid = $('grid');
  grid.classList.remove('shake');
  void grid.offsetWidth; // restart the animation
  grid.classList.add('shake');
}

function onSubmit(path) {
  const wasCompleted = app.state.completed;
  const { state, result } = submitWord(app.state, app.puzzle, path, app.dictionary);
  app.state = state;
  saveProgress(state);
  if (SHAKE_ON.has(result.type)) shake();
  if (result.type === 'stepping-stone') flashMessage(`On theme: ${result.word}. +1 hint`);
  else if (result.type === 'bonus') flashMessage(result.hintEarned ? 'Bonus word! Hint earned' : `Bonus word! (${state.hintMeter}/${HINT_COST} toward a hint)`);
  else if (MESSAGES[result.type]) flashMessage(MESSAGES[result.type]);
  else render();

  if (state.completed && !wasCompleted) {
    markSolved(state.puzzleId);
    saveStats(applyCompletion(loadStats(), state, app.isDaily ? app.today : null));
    resultsTimer = setTimeout(showResults, 600);
  }
}

function onHint() {
  app.state = useHint(app.state, app.puzzle);
  saveProgress(app.state);
  render();
}

// Share links use the canonical URL so copies hosted in iframes (e.g. itch.io) link somewhere playable.
function playUrl() {
  return document.querySelector('link[rel="canonical"]')?.href ?? `${location.origin}${location.pathname}`;
}

function currentShareText() {
  const label = app.isDaily ? app.today : app.puzzle.id;
  const url = app.isDaily ? null : `${playUrl()}?id=${app.puzzle.id}`;
  return buildShareText({ state: app.state, puzzle: app.puzzle, label, url });
}

async function doShare(button) {
  const outcome = await shareText(currentShareText());
  const labels = { copied: 'Copied!', failed: "Couldn't share" };
  if (!labels[outcome]) return;
  const original = button.textContent;
  button.textContent = labels[outcome];
  setTimeout(() => { button.textContent = original; }, 1500);
}

function showResults() {
  if (!app.state.completed) return;
  $('results-summary').textContent = currentShareText();
  const dialog = $('results-dialog');
  if (!dialog.open) dialog.showModal();
}

function showStats() {
  const s = loadStats();
  const avg = s.completed ? (s.totalHints / s.completed).toFixed(1) : '0';
  const items = [
    ['Played', s.played],
    ['Solved', s.completed],
    ['Streak', displayStreak(s, app.today)],
    ['Best streak', s.bestStreak],
    ['Avg hints', avg],
  ];
  $('stats-list').replaceChildren(...items.map(([label, value]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = String(value);
    row.append(dt, dd);
    return row;
  }));
  $('stats-dialog').showModal();
}

function showFatal() {
  $('fatal').hidden = false;
}

function startPuzzle(puzzle) {
  clearTimeout(resultsTimer);
  clearTimeout(messageTimer);
  app.puzzle = puzzle;
  app.isDaily = dailyFor(app.drops, app.today, app.seq)?.id === puzzle.id;
  let state = loadProgress(puzzle.id);
  // Discard saved progress from another format or if the drop's theme or board changed underneath it.
  if (!state || state.puzzleId !== puzzle.id || state.themeId !== puzzle.themeId
    || state.layoutKey !== layoutKey(puzzle)) {
    state = newGameState(puzzle, puzzle.id);
    saveStats(applyStart(loadStats()));
    saveProgress(state);
  }
  state = migrateState(state);
  app.state = state;
  // Shown counts as played, so "New puzzle" serves unseen puzzles before ones the player skipped.
  markPlayed(puzzle.id);
  if (setFor(app.seq, app.today)?.some((p) => p.id === puzzle.id)) {
    const progress = loadSetProgress(app.today);
    if (!progress.shown.includes(puzzle.id)) {
      progress.shown.push(puzzle.id);
      saveSetProgress(progress);
    }
  }
  if (!state.completed && $('results-dialog').open) $('results-dialog').close();
  app.message = '';
  app.selector.clear();
  render();
  if (state.completed) showResults();
}

// Today's set first, in order; then free play, announced once.
function newPuzzle() {
  const set = setFor(app.seq, app.today);
  if (set) {
    const shown = loadSetProgress(app.today).shown;
    const next = set.find((p) => !shown.includes(p.id) && p.id !== app.puzzle?.id);
    if (next) {
      history.replaceState(null, '', `?id=${next.id}`);
      startPuzzle(next);
      return;
    }
  }
  const pick = randomPuzzle(app.drops, app.today, {
    played: loadPlayed(),
    solved: loadSolved(),
    excludeId: app.puzzle?.id,
    seq: app.seq,
  });
  if (!pick) {
    flashMessage("You've seen them all! More soon.");
    return;
  }
  history.replaceState(null, '', `?id=${pick.id}`);
  startPuzzle(pick);
  if (set) {
    const progress = loadSetProgress(app.today);
    if (!progress.freePlay) {
      progress.freePlay = true;
      saveSetProgress(progress);
      flashMessage(FREE_PLAY_NOTE);
    }
  }
}

function playDaily() {
  history.replaceState(null, '', location.pathname);
  startPuzzle(dailyFor(app.drops, app.today, app.seq));
}

function checkDateRollover() {
  const key = dateKey();
  if (key === app.today) return;
  app.today = key;
  const daily = dailyFor(app.drops, app.today, app.seq);
  if (app.isDaily && daily) {
    history.replaceState(null, '', location.pathname);
    startPuzzle(daily);
    return;
  }
  // The puzzle on screen may itself have just become today's daily.
  app.isDaily = daily?.id === app.puzzle?.id;
  render();
}

async function loadDictionary() {
  try {
    const res = await fetch('data/words.txt');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    app.dictionary = new Set(text.split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean));
  } catch {
    $('notice').hidden = false;
  }
}

async function init() {
  app.board = createBoard($('grid'));
  app.selector = createSelection({
    gridEl: $('grid'),
    isSelectable: () => Boolean(app.state) && !app.state.completed,
    onChange: (path) => {
      app.selection = path;
      if (path.length) app.message = '';
      render();
    },
    onSubmit,
    shouldAutoSubmit: (path) => Boolean(app.state) && completedAnswer(app.state, app.puzzle, path) !== null,
  });

  $('hint-btn').addEventListener('click', onHint);
  $('new-btn').addEventListener('click', newPuzzle);
  $('daily-btn').addEventListener('click', playDaily);
  $('share-btn').addEventListener('click', (e) => doShare(e.currentTarget));
  $('results-share').addEventListener('click', (e) => doShare(e.currentTarget));
  $('results-new').addEventListener('click', () => {
    $('results-dialog').close();
    newPuzzle();
  });
  $('stats-btn').addEventListener('click', showStats);
  $('help-btn').addEventListener('click', () => $('help-dialog').showModal());
  $('retry-btn').addEventListener('click', () => location.reload());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') app.selector.clear();
  });

  try {
    [app.drops, app.seq] = await Promise.all([loadDrops(), loadSequence()]);
  } catch {
    showFatal();
    return;
  }
  const daily = dailyFor(app.drops, app.today, app.seq);
  if (!daily) {
    showFatal();
    return;
  }

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const linked = id && canOpen(app.drops, id, app.today, app.seq) ? getPuzzle(app.drops, id, app.seq) : null;
  if (linked) {
    startPuzzle(linked);
  } else {
    if (params.has('id') || params.has('p')) history.replaceState(null, '', location.pathname);
    startPuzzle(daily);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDateRollover();
  });
  window.addEventListener('pageshow', checkDateRollover);

  if (isFirstVisit()) {
    markVisited();
    $('help-dialog').showModal();
  }
  loadDictionary();
}

init();
