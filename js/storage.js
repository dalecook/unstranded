import { dateKey } from './rng.js';

const PREFIX = 'unstranded:';
const MAX_SAVED = 30;
const MAX_IDS = 500;

function defaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key, fallback, store) {
  try {
    const raw = store?.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value, store) {
  try {
    store?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: play continues without persistence.
  }
}

function remove(key, store) {
  try {
    store?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

export function loadProgress(puzzleId, store = defaultStore()) {
  return read(`progress:${puzzleId}`, null, store);
}

export function saveProgress(state, store = defaultStore()) {
  write(`progress:${state.puzzleId}`, state, store);
  const recent = read('recent', [], store).filter((id) => id !== state.puzzleId);
  recent.unshift(state.puzzleId);
  for (const old of recent.splice(MAX_SAVED)) remove(`progress:${old}`, store);
  write('recent', recent, store);
}

const EMPTY_STATS = {
  played: 0, completed: 0, totalHints: 0, currentStreak: 0, bestStreak: 0, lastDailyDate: null,
};

export function loadStats(store = defaultStore()) {
  return { ...EMPTY_STATS, ...read('stats', {}, store) };
}

export function saveStats(stats, store = defaultStore()) {
  write('stats', stats, store);
}

export function applyStart(stats) {
  return { ...stats, played: stats.played + 1 };
}

export function previousDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

export function applyCompletion(stats, state, dailyDate) {
  const next = {
    ...stats,
    completed: stats.completed + 1,
    totalHints: stats.totalHints + state.hintsUsed,
  };
  if (dailyDate && stats.lastDailyDate !== dailyDate) {
    next.currentStreak = stats.lastDailyDate === previousDateKey(dailyDate) ? stats.currentStreak + 1 : 1;
    next.bestStreak = Math.max(stats.bestStreak, next.currentStreak);
    next.lastDailyDate = dailyDate;
  }
  return next;
}

export function displayStreak(stats, today) {
  const live = stats.lastDailyDate === today || stats.lastDailyDate === previousDateKey(today);
  return live ? stats.currentStreak : 0;
}

function markId(key, id, store) {
  const ids = read(key, [], store).filter((x) => x !== id);
  ids.push(id);
  write(key, ids.slice(-MAX_IDS), store);
}

export function markPlayed(id, store = defaultStore()) {
  markId('played', id, store);
}

export function markSolved(id, store = defaultStore()) {
  markId('solved', id, store);
}

export function loadPlayed(store = defaultStore()) {
  return new Set(read('played', [], store));
}

export function loadSolved(store = defaultStore()) {
  return new Set(read('solved', [], store));
}

export function isFirstVisit(store = defaultStore()) {
  return !read('visited', false, store);
}

export function markVisited(store = defaultStore()) {
  write('visited', true, store);
}
