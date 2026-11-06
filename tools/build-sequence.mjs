// Offline builder for the daily-set sequence (docs/superpowers/specs/2026-11-05-daily-sets-design.md):
// one board per theme, SEQUENCE_LENGTH boards in a fixed pass-0 order of SET_SIZE per day.
//
// A full build searches every eligible theme (holidays left out), picks the boards (themes never
// used in a drop first, at most one obscure board per day) and orders them with arrangePass. A
// locked rebuild keeps every board in its place and re-searches only the themes named with
// --rebuild or whose content has changed since their board was built (meta.contentHash).
import { hashString } from '../js/rng.js';
import { arrangePass } from '../js/sequence.js';
import { eligibleAnswers } from './lib/familiarity.js';
import { countWordSets, targetCounts, spreadStones } from './lib/variety.js';
import { planDrop, tracedDictionaryWords } from './build-drop.mjs';

export const SEQUENCE_LENGTH = 366;
export const SET_SIZE = 6;
export const SEED = 'sequence';
export const HOLIDAY_THEMES = ['halloween', 'thanksgiving', 'christmas', 'valentines-day', 'easter'];

export const contentHash = (theme) => hashString(JSON.stringify(theme));
export const sequenceId = (i) => `seq-${String(i + 1).padStart(3, '0')}`;

export function sequenceJobs({ themes, ranks, earlier = {} }) {
  const eligible = themes.filter((t) => !HOLIDAY_THEMES.includes(t.id));
  return planDrop({ dropId: SEED, themes: eligible, ranks, earlier, dailies: 0 });
}

// Never-used themes first (no earlier boards to avoid), hardest first; at most one obscure
// board per day. Then each theme's stepping-stone count is chosen to spread counts over 2-5.
export function selectSequence(successes, { length = SEQUENCE_LENGTH, setSize = SET_SIZE } = {}) {
  const maxObscure = length / setSize;
  const ranked = successes
    .map((s) => ({ ...s, score: Math.max(...s.candidates.map((c) => c.score)) }))
    .sort((a, b) => Number(a.avoid.length > 0) - Number(b.avoid.length > 0)
      || b.score - a.score || a.theme.id.localeCompare(b.theme.id));
  const picked = [];
  let obscure = 0;
  for (const s of ranked) {
    if (picked.length === length) break;
    if (s.theme.obscure) {
      if (obscure === maxObscure) continue;
      obscure++;
    }
    picked.push(s);
  }
  if (picked.length < length) {
    throw new Error(`Only ${picked.length} themes produced a usable board; the sequence needs ${length}.`);
  }
  const stones = spreadStones(picked.map((s) => ({
    id: s.theme.id,
    options: s.candidates.map((c) => ({ stones: c.steppingStones.length, score: c.score })),
  })));
  return picked.map((s) => ({ ...s, chosen: s.candidates.find((c) => c.steppingStones.length === stones.get(s.theme.id)) }));
}

export function toPuzzle({ theme, chosen }) {
  return {
    themeId: theme.id,
    clue: theme.clue,
    obscure: !!theme.obscure,
    grid: chosen.variant.grid,
    answers: chosen.variant.answers,
    steppingStones: chosen.steppingStones,
    difficulty: Math.round(chosen.score * 100) / 100,
  };
}

// The words a board's checks used, as in the drop meta, plus what a locked rebuild needs.
export function metaFor(theme, puzzle, rebuilds = 0) {
  const answerWords = new Set(puzzle.answers.map((a) => a.word));
  return {
    themeId: theme.id,
    contentHash: contentHash(theme),
    rebuilds,
    checkedLong: [...new Set([...theme.answers, ...theme.recognized])]
      .filter((w) => w.length >= 6 && !answerWords.has(w)).sort(),
    stoneCandidates: [...new Set([...theme.recognized, ...theme.answers])]
      .filter((w) => w.length >= 4 && w.length <= 5 && !answerWords.has(w)).sort(),
  };
}

export function assembleSequence({ start, selected, setSize = SET_SIZE }) {
  const boards = selected.map((s) => ({ id: s.theme.id, ...toPuzzle(s) }));
  const ordered = arrangePass(boards, 'pass-0', { setSize });
  const byTheme = new Map(selected.map((s) => [s.theme.id, s.theme]));
  const puzzles = ordered.map(({ id, ...rest }, i) => ({ id: sequenceId(i), ...rest }));
  const meta = Object.fromEntries(puzzles.map((p) => [p.id, metaFor(byTheme.get(p.themeId), p)]));
  return { sequence: { id: SEED, start, setSize, puzzles }, meta };
}

// Search jobs for a locked rebuild: named themes and themes whose content changed. Each job
// keeps the board's word count and stepping-stone count, avoids its current board (and any
// earlier drop boards), and uses a fresh seed so a named theme gets a new board.
export function rebuildJobs({ sequence, meta, themes, ranks, earlier = {}, names = [], attempts, seconds }) {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const inSequence = new Set(sequence.puzzles.map((p) => p.themeId));
  const failures = names.filter((n) => !inSequence.has(n)).map((n) => ({ id: null, themeId: n, reason: 'not in the sequence' }));
  const jobs = [];
  for (const p of sequence.puzzles) {
    const theme = byId.get(p.themeId);
    if (!theme) {
      failures.push({ id: p.id, themeId: p.themeId, reason: 'theme file missing' });
      continue;
    }
    const m = meta[p.id];
    if (!names.includes(theme.id) && m.contentHash === contentHash(theme)) continue;
    const { eligible } = eligibleAnswers(theme, ranks);
    const feasible = targetCounts(countWordSets(theme.spangram, eligible));
    if (!feasible.length) {
      failures.push({ id: p.id, themeId: theme.id, reason: 'no word set fills the board' });
      continue;
    }
    const current = { words: p.answers.filter((a) => !a.isSpangram).map((a) => a.word), grid: p.grid.join('') };
    jobs.push({
      id: p.id, theme, eligible, feasible,
      target: p.answers.length - 1,
      avoid: [...(earlier.boards?.[theme.id] ?? []), current],
      dropId: `${SEED}-r${(m.rebuilds ?? 0) + 1}`,
      attempts, seconds,
      stones: p.steppingStones.length,
    });
  }
  return { jobs, failures };
}

export function applyRebuild({ sequence, meta, jobs, results }) {
  const puzzles = [...sequence.puzzles];
  const nextMeta = { ...meta };
  const rebuilt = [];
  const failures = [];
  for (const job of jobs) {
    const found = results.get(job.theme.id);
    if (found.failure) {
      failures.push({ id: job.id, themeId: job.theme.id, reason: found.failure });
      continue;
    }
    const chosen = [...found.candidates].sort((a, b) =>
      Math.abs(a.steppingStones.length - job.stones) - Math.abs(b.steppingStones.length - job.stones)
      || b.score - a.score)[0];
    const at = puzzles.findIndex((p) => p.id === job.id);
    const puzzle = { id: job.id, ...toPuzzle({ theme: job.theme, chosen }) };
    puzzles[at] = puzzle;
    nextMeta[job.id] = metaFor(job.theme, puzzle, (meta[job.id].rebuilds ?? 0) + 1);
    rebuilt.push(job.id);
  }
  return { sequence: { ...sequence, puzzles }, meta: nextMeta, rebuilt, failures };
}

// The review report for the listed boards: place, theme, answers, stones and traceable decoys.
export function boardReport(sequence, ids, dictionaryWords, themesById) {
  const lines = [];
  sequence.puzzles.forEach((p, i) => {
    if (!ids.includes(p.id)) return;
    const theme = themesById.get(p.themeId);
    const known = new Set([...p.answers.map((a) => a.word), ...theme.answers]);
    const decoys = tracedDictionaryWords(p.grid, dictionaryWords, known);
    const day = Math.floor(i / sequence.setSize) + 1;
    const position = (i % sequence.setSize) + 1;
    lines.push(`${p.id} [day ${day}, board ${position}] ${p.themeId}${p.obscure ? ' (obscure)' : ''} difficulty ${p.difficulty.toFixed(2)}`);
    lines.push(`  answers: ${p.answers.map((a) => a.word).join(' ')}`);
    lines.push(`  stepping stones: ${p.steppingStones.join(' ')}`);
    if (decoys.length) lines.push(`  dictionary decoys (review): ${decoys.join(' ')}`);
  });
  return lines.join('\n');
}
