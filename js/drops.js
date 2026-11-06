import { hashString } from './rng.js';
import { hasStarted, setFor, freePlayPool, isOpenable } from './sequence.js';

export async function loadDrops(fetchImpl = fetch) {
  const get = async (url) => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    return res.json();
  };
  const ids = await get('drops/index.json');
  return Promise.all(ids.map((id) => get(`drops/${id}.json`)));
}

function firstScheduleDate(drop) {
  return Object.keys(drop.schedule).sort()[0] ?? null;
}

export function isReleased(drops, id, today) {
  for (const drop of drops) {
    const date = Object.keys(drop.schedule).find((d) => drop.schedule[d] === id);
    if (date) return date <= today;
    if (drop.library.includes(id)) {
      const start = firstScheduleDate(drop);
      return start !== null && today >= start;
    }
  }
  return false;
}

// Index order, then each drop's own puzzle order.
export function releasedPuzzles(drops, today) {
  return drops.flatMap((drop) => drop.puzzles.filter((p) => isReleased(drops, p.id, today)));
}

export function getPuzzle(drops, id, seq = null) {
  for (const drop of drops) {
    const puzzle = drop.puzzles.find((p) => p.id === id);
    if (puzzle) return puzzle;
  }
  return seq?.puzzles.find((p) => p.id === id) ?? null;
}

// Once the sequence has started, the daily is the first board of today's set.
export function dailyFor(drops, today, seq = null) {
  if (hasStarted(seq, today)) return setFor(seq, today)[0];
  for (let i = drops.length - 1; i >= 0; i--) {
    const id = drops[i].schedule[today];
    if (id) return getPuzzle(drops, id);
  }
  const released = releasedPuzzles(drops, today);
  if (released.length > 0) return released[hashString('daily-' + today) % released.length];
  // Nothing released yet (e.g. device clock before the first drop): serve the earliest daily.
  const dates = drops.flatMap((drop) => Object.keys(drop.schedule).map((date) => [date, drop.schedule[date]]));
  if (dates.length === 0) return null;
  dates.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return getPuzzle(drops, dates[0][1]);
}

// Whether a ?id= link may open this board today.
export function canOpen(drops, id, today, seq = null) {
  return hasStarted(seq, today) ? isOpenable(drops, seq, id, today) : isReleased(drops, id, today);
}

export function randomPuzzle(drops, today, { played, solved, excludeId, seq = null }, rand = Math.random) {
  const daily = dailyFor(drops, today, seq);
  const pool = hasStarted(seq, today) ? freePlayPool(drops, seq, today) : releasedPuzzles(drops, today);
  const candidates = pool.filter((p) => p.id !== daily?.id && p.id !== excludeId);
  const tiers = [
    candidates.filter((p) => !played.has(p.id)),
    candidates.filter((p) => played.has(p.id) && !solved.has(p.id)),
    candidates,
  ];
  const found = tiers.find((t) => t.length > 0);
  return found ? found[Math.floor(rand() * found.length)] : null;
}
