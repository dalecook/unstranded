// Daily sets: one shared order of boards, a set of `setSize` per day, cycling in passes.
// Pass 0 is the order stored in drops/sequence.json; every later pass is a seeded shuffle that
// keeps at most one obscure board per day and keeps the end of the previous pass out of its first
// SEAM_DAYS days. Everything here is pure and deterministic, so every device agrees on the sets.
import { mulberry32, hashString, shuffle } from './rng.js';

export const SEAM_DAYS = 14;
export const FREE_PLAY_GAP_DAYS = 30;

export async function loadSequence(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('drops/sequence.json');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function dayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function dayNumber(start, today) {
  return dayOf(today) - dayOf(start);
}

export function hasStarted(seq, today) {
  return Boolean(seq) && dayNumber(seq.start, today) >= 0;
}

const size = (p) => p.answers.length - 1;

// One pass: obscure boards on evenly spaced days (one per day at most, at a random place in the
// day), familiar boards spread by size so each day gets a mix, then any board in `avoidFirst`
// swapped out of the first `seamDays` days for a later board of the same kind.
export function arrangePass(puzzles, seed, { setSize, avoidFirst = new Set(), seamDays = SEAM_DAYS }) {
  const days = puzzles.length / setSize;
  if (!Number.isInteger(days)) throw new Error('sequence length must be a multiple of the set size');
  const rand = mulberry32(hashString(seed));
  const obscure = shuffle(puzzles.filter((p) => p.obscure), rand);
  if (obscure.length > days) throw new Error(`${obscure.length} obscure boards for ${days} days`);

  const buckets = new Map();
  for (const p of shuffle(puzzles.filter((p) => !p.obscure), rand)) {
    if (!buckets.has(size(p))) buckets.set(size(p), []);
    buckets.get(size(p)).push(p);
  }
  const familiar = [...buckets.values()]
    .flatMap((bucket) => bucket.map((p, j) => ({ p, at: (j + 0.5) / bucket.length })))
    .sort((a, b) => a.at - b.at || size(a.p) - size(b.p))
    .map((x) => x.p);

  const out = new Array(puzzles.length);
  obscure.forEach((p, i) => {
    const day = Math.floor((i * days) / obscure.length);
    out[day * setSize + Math.floor(rand() * setSize)] = p;
  });
  let f = 0;
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = familiar[f++];

  const seam = Math.min(seamDays * setSize, out.length);
  for (let i = 0; i < seam; i++) {
    if (!avoidFirst.has(out[i].id)) continue;
    const j = out.findIndex((q, k) => k >= seam && q.obscure === out[i].obscure && !avoidFirst.has(q.id));
    if (j < 0) throw new Error('cannot keep the end of the previous pass out of the seam');
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const passCache = new WeakMap();

export function passOrder(seq, p) {
  let cache = passCache.get(seq);
  if (!cache) {
    cache = [seq.puzzles];
    passCache.set(seq, cache);
  }
  while (cache.length <= p) {
    const prev = cache[cache.length - 1];
    const avoidFirst = new Set(prev.slice(-SEAM_DAYS * seq.setSize).map((q) => q.id));
    cache.push(arrangePass(seq.puzzles, `pass-${cache.length}`, { setSize: seq.setSize, avoidFirst }));
  }
  return cache[p];
}

function setOnDay(seq, d) {
  const days = seq.puzzles.length / seq.setSize;
  const i = d % days;
  return passOrder(seq, Math.floor(d / days)).slice(i * seq.setSize, (i + 1) * seq.setSize);
}

export function setFor(seq, today) {
  if (!hasStarted(seq, today)) return null;
  return setOnDay(seq, dayNumber(seq.start, today));
}

// Ids of every board in a set from today through the following `days - 1` days.
export function upcomingIds(seq, today, days) {
  const first = Math.max(0, dayNumber(seq.start, today));
  const last = dayNumber(seq.start, today) + days;
  const ids = new Set();
  for (let d = first; d < last; d++) for (const p of setOnDay(seq, d)) ids.add(p.id);
  return ids;
}

// Boards for free play: every drop board and every sequence board, except today's set and any
// board in a set over the next FREE_PLAY_GAP_DAYS days, so free play never spoils a set.
export function freePlayPool(drops, seq, today) {
  const due = upcomingIds(seq, today, FREE_PLAY_GAP_DAYS);
  return [...drops.flatMap((d) => d.puzzles), ...seq.puzzles].filter((p) => !due.has(p.id));
}

export function isOpenable(drops, seq, id, today) {
  if (setFor(seq, today).some((p) => p.id === id)) return true;
  return freePlayPool(drops, seq, today).some((p) => p.id === id);
}
