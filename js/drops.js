import { hashString } from './rng.js';

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

export function getPuzzle(drops, id) {
  for (const drop of drops) {
    const puzzle = drop.puzzles.find((p) => p.id === id);
    if (puzzle) return puzzle;
  }
  return null;
}

export function dailyFor(drops, today) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const id = drops[i].schedule[today];
    if (id) return getPuzzle(drops, id);
  }
  const released = releasedPuzzles(drops, today);
  if (released.length === 0) return null;
  return released[hashString('daily-' + today) % released.length];
}

export function randomPuzzle(drops, today, { played, solved, excludeId }, rand = Math.random) {
  const daily = dailyFor(drops, today);
  const candidates = releasedPuzzles(drops, today).filter((p) => p.id !== daily?.id && p.id !== excludeId);
  const tiers = [
    candidates.filter((p) => !played.has(p.id)),
    candidates.filter((p) => played.has(p.id) && !solved.has(p.id)),
    candidates,
  ];
  const pool = tiers.find((t) => t.length > 0);
  return pool ? pool[Math.floor(rand() * pool.length)] : null;
}
