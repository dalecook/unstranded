// Pure drop assembly: schedules dailies by date and holds the rest in the library.
import { dateKey, shuffle } from '../../js/rng.js';

const WEEK = 7;

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function obscureSlots(dates, count) {
  const slots = [];
  while (slots.length < count) {
    let next = -1;
    if (!slots.length) {
      next = dates.findIndex(isWeekend);
    } else {
      const prev = slots[slots.length - 1];
      for (let i = prev + WEEK; i <= prev + WEEK + 2; i++) {
        if (i < dates.length && isWeekend(dates[i])) { next = i; break; }
      }
      if (next < 0) next = prev + WEEK;
    }
    if (next < 0 || next >= dates.length) break;
    slots.push(next);
  }
  return slots;
}

export function assembleDrop({ id, startDate, puzzles, dailies = 30, rand }) {
  if (puzzles.length < dailies) {
    throw new Error(`Need at least ${dailies} puzzles, got ${puzzles.length}`);
  }
  const [y, m, d] = startDate.split('-').map(Number);
  const dates = Array.from({ length: dailies }, (_, i) => new Date(y, m - 1, d + i));

  const obscure = shuffle(puzzles.filter((p) => p.obscure), rand);
  const familiar = shuffle(puzzles.filter((p) => !p.obscure), rand);
  const slots = obscureSlots(dates, Math.min(obscure.length, Math.floor((dailies + 6) / WEEK)));
  const familiarCount = dailies - slots.length;
  if (familiar.length < familiarCount) {
    throw new Error(`Need ${familiarCount} familiar puzzles, got ${familiar.length}`);
  }

  const daily = new Array(dailies);
  slots.forEach((slot, i) => { daily[slot] = obscure[i]; });
  const familiarIdx = [];
  for (let i = 0; i < dailies; i++) if (!daily[i]) familiarIdx.push(i);
  familiarIdx.forEach((slot, i) => { daily[slot] = familiar[i]; });

  for (let start = 0; start < dailies; start += WEEK) {
    const block = familiarIdx.filter((i) => i >= start && i < start + WEEK);
    const sorted = block.map((i) => daily[i]).sort((a, b) => a.difficulty - b.difficulty);
    block.forEach((slot, i) => { daily[slot] = sorted[i]; });
  }

  const ordered = [
    ...daily,
    ...obscure.slice(slots.length),
    ...familiar.slice(familiarCount),
  ];
  const out = ordered.map((p, i) => ({ ...p, id: `${id}-p${String(i + 1).padStart(2, '0')}` }));
  const schedule = {};
  dates.forEach((date, i) => { schedule[dateKey(date)] = out[i].id; });
  return { id, puzzles: out, schedule, library: out.slice(dailies).map((p) => p.id) };
}
