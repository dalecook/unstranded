// Offline builder for the daily-set sequence (docs/superpowers/specs/2026-11-05-daily-sets-design.md):
// one board per theme, SEQUENCE_LENGTH boards in a fixed pass-0 order of SET_SIZE per day.
//
// A full build searches every eligible theme (holidays left out), picks the boards (themes never
// used in a drop first, at most one obscure board per day) and orders them with arrangePass. A
// locked rebuild keeps every board in its place. NAMED themes (--rebuild) are always
// re-searched. CHANGED themes (content differs from meta.contentHash) are re-searched only if
// their board no longer passes the checks (or their obscure flag changed); a changed theme whose
// board still passes keeps the board and gets its clue, hash and checked words refreshed.
import { isDeepStrictEqual } from 'node:util';
import { hashString } from '../js/rng.js';
import { arrangePass } from '../js/sequence.js';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { eligibleAnswers, loadRanks } from './lib/familiarity.js';
import { countWordSets, targetCounts, spreadStones, tallyLine } from './lib/variety.js';
import { checkPuzzle } from './lib/checks.js';
import { loadBoardBlocklist } from './lib/blocklist.js';
import {
  planDrop, tracedDictionaryWords, earlierUse, runInWorkers, runSequential,
  DEFAULT_ATTEMPTS, DEFAULT_SECONDS,
} from './build-drop.mjs';

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

// Whether a board still stands against its theme's current content: its words are still the
// theme's, its obscure flag is unchanged, the checks pass, and its stepping stones are unchanged. (The offensive-word check
// depends on the blocklist, not on theme content, so it is not repeated.)
function stillPasses(p, theme) {
  const answers = new Set(theme.answers);
  if (!!theme.obscure !== !!p.obscure) return false;
  if (!p.answers.every((a) => (a.isSpangram ? a.word === theme.spangram : answers.has(a.word)))) return false;
  const result = checkPuzzle(p, { answers: theme.answers, recognized: theme.recognized });
  return result.ok && isDeepStrictEqual(result.steppingStones, p.steppingStones);
}

// Search jobs for a locked rebuild: named themes and themes whose content changed and whose
// board no longer passes (those that still pass are returned as `refreshed`). Each job
// keeps the board's word count and stepping-stone count, avoids its current board (and any
// earlier drop boards), and uses a fresh seed so a named theme gets a new board.
export function rebuildJobs({ sequence, meta, themes, ranks, earlier = {}, names = [], attempts, seconds }) {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const inSequence = new Set(sequence.puzzles.map((p) => p.themeId));
  const failures = names.filter((n) => !inSequence.has(n)).map((n) => ({ id: null, themeId: n, reason: 'not in the sequence' }));
  const jobs = [];
  const refreshed = [];
  for (const p of sequence.puzzles) {
    const theme = byId.get(p.themeId);
    if (!theme) {
      failures.push({ id: p.id, themeId: p.themeId, reason: 'theme file missing' });
      continue;
    }
    const m = meta[p.id];
    if (!m) {
      failures.push({ id: p.id, themeId: p.themeId, reason: 'missing meta entry' });
      continue;
    }
    if (!names.includes(theme.id)) {
      if (m.contentHash === contentHash(theme)) continue;
      if (stillPasses(p, theme)) {
        refreshed.push({ id: p.id, theme });
        continue;
      }
    }
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
  return { jobs, failures, refreshed };
}

// Meta for boards kept in place whose theme content changed: new hash and checked words.
export function refreshMeta({ meta, sequence, refreshed }) {
  const next = { ...meta };
  for (const { id, theme } of refreshed) {
    const puzzle = sequence.puzzles.find((p) => p.id === id);
    next[id] = metaFor(theme, puzzle, meta[id].rebuilds ?? 0);
  }
  return next;
}

// The sequence with the clue of each refreshed board taken from its (changed) theme.
export function refreshBoards({ sequence, refreshed }) {
  const clues = new Map(refreshed.map(({ id, theme }) => [id, theme.clue]));
  return {
    ...sequence,
    puzzles: sequence.puzzles.map((p) => (clues.has(p.id) ? { ...p, clue: clues.get(p.id) } : p)),
  };
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

const USAGE = `Usage: build-sequence [--start YYYY-MM-DD] [--fresh] [--rebuild id,id] [--attempts N] [--seconds N] [--workers N] [--content dir] [--out dir]
  With no <out>/sequence.json, or with --fresh, builds all ${SEQUENCE_LENGTH} boards (--start required).
  Otherwise keeps every board in place: themes named with --rebuild get new boards, and a theme
  whose content changed is rebuilt only if its board no longer passes. --start without --fresh
  moves the start date and, like any locked run, also does those rechecks.`;

export function parseSequenceArgs(argv) {
  const args = {
    start: null, fresh: false, rebuild: [], attempts: DEFAULT_ATTEMPTS, seconds: DEFAULT_SECONDS,
    workers: Math.max(1, os.availableParallelism() - 2), content: 'content/themes', out: 'drops',
  };
  const numeric = ['attempts', 'seconds', 'workers'];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'fresh') { args.fresh = true; continue; }
    const value = argv[++i];
    if (![...numeric, 'start', 'rebuild', 'content', 'out'].includes(key) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${argv[i - 1]}\n${USAGE}`);
    }
    if (numeric.includes(key)) {
      if (!/^[1-9]\d*$/.test(value)) throw new Error(`--${key} must be a positive integer, got "${value}"\n${USAGE}`);
      args[key] = Number(value);
    } else if (key === 'start') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--start must be YYYY-MM-DD, got "${value}"`);
      args.start = value;
    } else if (key === 'rebuild') {
      args.rebuild = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      args[key] = value;
    }
  }
  return args;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

async function main() {
  const args = parseSequenceArgs(process.argv.slice(2));
  const files = (await readdir(args.content)).filter((f) => f.endsWith('.json')).sort();
  const themes = await Promise.all(files.map((f) => readJson(join(args.content, f))));
  const themesById = new Map(themes.map((t) => [t.id, t]));
  const index = await readJson('drops/index.json', []);
  const earlier = earlierUse(await Promise.all(index.map((id) => readJson(`drops/${id}.json`))));
  const dictionaryWords = (await readFile('data/words.txt', 'utf8'))
    .split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean);
  const ranks = await loadRanks();
  const blockset = await loadBoardBlocklist();
  const run = (jobs) => (args.workers > 1 ? runInWorkers : runSequential)(jobs, { blockset, workers: args.workers });
  const file = join(args.out, 'sequence.json');
  const metaFile = join(args.out, 'sequence.meta.json');
  const existing = args.fresh ? null : await readJson(file, null);
  const started = performance.now();
  let sequence;
  let meta;
  const lines = [];

  if (!existing) {
    if (!args.start) throw new Error(`--start is required for a full build\n${USAGE}`);
    const { jobs, failures, rejections } = sequenceJobs({ themes, ranks, earlier });
    const results = await run(jobs.map((j) => ({ ...j, dropId: SEED, attempts: args.attempts, seconds: args.seconds })));
    const successes = [];
    for (const job of jobs) {
      const found = results.get(job.theme.id).result;
      if (found.failure) failures.push({ themeId: job.theme.id, reason: found.failure });
      else successes.push({ ...job, candidates: found.candidates });
    }
    ({ sequence, meta } = assembleSequence({ start: args.start, selected: selectSequence(successes) }));
    lines.push(`Sequence: ${sequence.puzzles.length} boards from ${successes.length} buildable themes, start ${sequence.start}`);
    lines.push(`Theme words per board: ${tallyLine(sequence.puzzles.map((p) => p.answers.length - 1))}`);
    lines.push(`Stepping stones per board: ${tallyLine(sequence.puzzles.map((p) => p.steppingStones.length))}`);
    if (failures.length) lines.push('Skipped themes:', ...failures.map((f) => `  ${f.themeId}: ${f.reason}`));
    if (rejections.length) lines.push('Familiarity rejections:', ...rejections.map((r) => `  ${r.themeId}: ${r.words.join(' ')}`));
    lines.push(boardReport(sequence, sequence.puzzles.map((p) => p.id), dictionaryWords, themesById));
  } else {
    const existingMeta = await readJson(metaFile);
    const { jobs, failures, refreshed } = rebuildJobs({
      sequence: existing, meta: existingMeta, themes, ranks, earlier,
      names: args.rebuild, attempts: args.attempts, seconds: args.seconds,
    });
    const results = jobs.length ? await run(jobs) : new Map();
    const applied = applyRebuild({ sequence: existing, meta: existingMeta, jobs, results: new Map([...results].map(([k, v]) => [k, v.result])) });
    failures.push(...applied.failures);
    sequence = refreshBoards({ sequence: { ...applied.sequence, start: args.start ?? existing.start }, refreshed });
    meta = refreshMeta({ meta: applied.meta, sequence, refreshed });
    // Boards that rebuilt are kept even when others fail. A failed board keeps its old content
    // hash (its meta is not refreshed), so the next run retries it, and the sequence-file
    // validation test, which compares each board's meta hash with its theme file, fails until
    // the board is rebuilt.
    if (failures.length) {
      lines.push('NOT REBUILT (fix these themes or rerun with more --attempts):',
        ...failures.map((f) => `  ${f.themeId}${f.id ? ` (${f.id})` : ''}: ${f.reason}`));
      process.exitCode = 1;
    }
    lines.push(`Rebuilt ${applied.rebuilt.length} board(s); start ${sequence.start}`);
    lines.push(`Revalidated ${refreshed.length} board(s) in place`);
    lines.push(boardReport(sequence, applied.rebuilt, dictionaryWords, themesById));
  }

  lines.unshift(`Wall time ${((performance.now() - started) / 1000).toFixed(1)}s, ${args.workers} worker(s)`);
  console.log(lines.join('\n'));
  await mkdir(args.out, { recursive: true });
  await writeFile(file, JSON.stringify(sequence));
  await writeFile(metaFile, JSON.stringify(meta, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
