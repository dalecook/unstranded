// Offline drop builder: searches each theme for passing puzzle layouts, selects puzzles across
// themes and assembles a monthly drop with schedule and library.
//
// Board variety. A drop should not be fifty boards of the same shape, so the build plans a
// spread and then keeps to it as far as the themes allow:
//   1. Plan (planDrop): each theme's feasible theme-word counts are worked out from its
//      eligible answers (4-8 words that exactly fill the cells its spangram leaves; a count
//      needs at least MIN_SETS distinct word sets unless the theme has no such count), and every
//      theme is given a target count so the targets are spread as evenly as possible over 4-8.
//   2. Search (searchTheme): boards are built with exactly the target number of words. If none
//      passes (the search gives a barren count up early), the nearest feasible counts are tried
//      in turn and the fallback is reported. The hardest passing board is kept for each
//      stepping-stone count (2-5).
//   Theme reuse. Dailies must use a theme that was never a daily in an earlier drop; library
//   puzzles may reuse any theme, but on a different board: a word subset that is not contained in
//   an earlier board's answers (as few of them as possible), and never an earlier grid.
//   3. Select (selectBoards): themes are picked so the word counts stay balanced (each pick is
//      the hardest remaining theme of the least-used count), obscure themes first up to their
//      quota as before. Then each selected theme uses the board whose stepping-stone count is
//      least used so far, so stone counts spread over 2-5 instead of clustering at the minimum.
// Every step is deterministic for a given drop id and content.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { mulberry32, hashString } from '../js/rng.js';
import { chooseWords } from './lib/layout.js';
import { generateBoard } from './lib/generator.js';
import { checkPuzzle, difficulty, isTraceable, ANY_TRACE } from './lib/checks.js';
import { loadRanks, eligibleAnswers } from './lib/familiarity.js';
import { assembleDrop } from './lib/assemble.js';
import {
  countWordSets, targetCounts, assignTargets, fallbackOrder, pickBalanced, spreadStones, tallyLine,
} from './lib/variety.js';
import { loadBoardBlocklist, offensiveWordsOn } from './lib/blocklist.js';

// Passing boards collected per theme; the most difficult one of each stepping-stone count is kept.
export const MAX_CANDIDATES = 30;
// ...or fewer once the boards found already offer a choice of stepping-stone counts.
const EARLY_CANDIDATES = 12;
const EARLY_STONE_COUNTS = 3;
// A word count with no passing board after this many attempts (or a tenth of the allowance, if
// that is more) is given up; and no count gets more attempts than this many per word set.
const GIVE_UP_ATTEMPTS = 200;
const ATTEMPTS_PER_SET = 100;
export const DEFAULT_ATTEMPTS = 6000;
export const DEFAULT_SECONDS = 900;
const MAX_OBSCURE = 10;
// Word count aimed for when a caller gives searchTheme no target.
const DEFAULT_TARGET = 6;

// What earlier drops used: `dailyThemeIds` (themes that were ever a daily) and `boards`
// (theme id -> [{ words, grid }]: the non-spangram answers and the grid string of each board).
export function earlierUse(drops) {
  const dailyThemeIds = [];
  const boards = {};
  for (const drop of drops) {
    const scheduled = new Set(Object.values(drop.schedule ?? {}));
    for (const p of drop.puzzles) {
      if (scheduled.has(p.id)) dailyThemeIds.push(p.themeId);
      (boards[p.themeId] ??= []).push({
        words: p.answers.filter((a) => !a.isSpangram).map((a) => a.word),
        grid: p.grid.join(''),
      });
    }
  }
  return { dailyThemeIds: [...new Set(dailyThemeIds)], boards };
}

// Which themes to search, and the number of theme words each should aim for. Returns the jobs
// ({ theme, eligible, feasible, target, fresh, avoid }, in theme id order) plus the themes that
// cannot be searched at all and the answers rejected as unfamiliar. `fresh` is true for a theme
// never used as a daily; `avoid` lists its earlier boards. Throws if fewer than `dailies`
// fresh themes can be searched.
export function planDrop({ dropId, themes, ranks, earlier = {}, dailies = 0 }) {
  const wasDaily = new Set(earlier.dailyThemeIds ?? []);
  const failures = [];
  const rejections = [];
  const jobs = [];
  for (const theme of [...themes].sort((a, b) => a.id.localeCompare(b.id))) {
    const { eligible, rejected } = eligibleAnswers(theme, ranks);
    if (rejected.length) rejections.push({ themeId: theme.id, words: rejected });
    if (eligible.length < 4) {
      failures.push({ themeId: theme.id, reason: `only ${eligible.length} eligible answers` });
      continue;
    }
    const feasible = targetCounts(countWordSets(theme.spangram, eligible));
    if (!feasible.length) {
      failures.push({ themeId: theme.id, reason: 'no word set fills the board' });
      continue;
    }
    jobs.push({ theme, eligible, feasible, fresh: !wasDaily.has(theme.id), avoid: earlier.boards?.[theme.id] ?? [] });
  }
  requireFreshThemes(jobs.filter((j) => j.fresh).length, dailies, failures);
  const targets = assignTargets(jobs.map((j) => ({ id: j.theme.id, feasible: j.feasible })), dropId);
  for (const job of jobs) job.target = targets.get(job.theme.id);
  return { jobs, failures, rejections };
}

function requireFreshThemes(have, dailies, failures = []) {
  if (have >= dailies) return;
  const why = failures.map((f) => `${f.themeId}: ${f.reason}`).join('; ');
  throw new Error(`Not enough fresh themes for the dailies: ${dailies} needed, ${have} never used as a daily and searchable${why ? ` (skipped: ${why})` : ''}. Add themes to content/themes/.`);
}

// Attempt limits for one word count with `sets` distinct word sets: `cap` attempts at most,
// and none after `giveUp` attempts if no board has passed by then.
export function searchLimits(attempts, sets) {
  return {
    cap: Math.min(attempts, ATTEMPTS_PER_SET * sets),
    giveUp: Math.max(GIVE_UP_ATTEMPTS, Math.floor(attempts / 10)),
  };
}

// Whether a theme has enough passing boards to stop searching: the maximum, or a dozen that
// already cover three different stepping-stone counts.
export function enoughCandidates(passes, stoneCounts, maxCandidates = MAX_CANDIDATES) {
  return passes >= maxCandidates || (passes >= EARLY_CANDIDATES && stoneCounts >= EARLY_STONE_COUNTS);
}

// Passing puzzles for one theme, or { failure } explaining why there are none. Each attempt
// picks exactly `target` words (a fresh random subset every time) and asks the check-as-you-go
// generator for a finished board; every board is then verified with checkPuzzle and the
// blocklist (a board failing either is a generator bug). If no board passes at the target, the
// other feasible counts are tried, nearest first. A count gets up to `attempts` attempts, fewer
// if it has few word sets, and is left early if nothing has passed (searchLimits); the theme is
// finished as soon as it has enough boards (enoughCandidates; `earlyStop: false` insists on
// `maxCandidates`).
// Returns the hardest board per stepping-stone count (`candidates`, fewest stones first), the
// hardest of all (`best`), and the word count used (`count`, which differs from `target` after
// a fallback). Stopping is deterministic (attempt and candidate counts); the time cap is a
// safety net only.
export function searchTheme(theme, dropId, {
  attempts, seconds, eligible, blockset = new Set(), maxCandidates = MAX_CANDIDATES,
  target = DEFAULT_TARGET, feasible = null, earlyStop = true, avoid = [],
}) {
  const sets = countWordSets(theme.spangram, eligible);
  const enough = () => (earlyStop ? enoughCandidates(passes, byStones.size, maxCandidates) : passes >= maxCandidates);
  const rand = mulberry32(hashString(`${theme.id}:${dropId}`));
  const subject = { spangram: theme.spangram, words: eligible };
  const deadline = Date.now() + seconds * 1000;
  const pruned = {};
  const checked = { answers: theme.answers, recognized: theme.recognized };
  const byStones = new Map();
  const earlierSets = avoid.map((b) => new Set(b.words));
  const earlierGrids = new Set(avoid.map((b) => b.grid));
  const everUsed = new Set(avoid.flatMap((b) => b.words));
  const freshSubject = { spangram: theme.spangram, words: eligible.filter((w) => !everUsed.has(w)) };
  const overlapOf = (ws) => earlierSets.reduce((n, set) => n + ws.filter((w) => set.has(w)).length, 0);
  const repeats = (ws) => earlierSets.some((set) => ws.every((w) => set.has(w)));
  // The word subset for one attempt: for a reused theme, the least overlapping of a few draws
  // (one from the words no earlier board used), never one contained in an earlier board.
  const draw = (k) => {
    if (!avoid.length) return { words: chooseWords(subject, rand, { minCount: k, maxCount: k }), overlap: 0 };
    const drawn = [];
    if (freshSubject.words.length) drawn.push(chooseWords(freshSubject, rand, { minCount: k, maxCount: k }));
    for (let i = 0; i < 3; i++) drawn.push(chooseWords(subject, rand, { minCount: k, maxCount: k }));
    let best = null;
    for (const ws of drawn) {
      if (!ws || repeats(ws)) continue;
      const overlap = overlapOf(ws);
      if (!best || overlap < best.overlap) best = { words: ws, overlap };
    }
    return best ?? { words: null, overlap: 0 };
  };
  let count = null;
  let passes = 0;
  let tried = 0;
  let capped = false;

  for (const k of fallbackOrder(target, feasible ?? targetCounts(sets))) {
    const { cap, giveUp } = searchLimits(attempts, sets.get(k) ?? 0);
    for (let attempt = 0; attempt < cap && !enough(); attempt++) {
      if (!passes && attempt >= giveUp) break;
      if (Date.now() > deadline) { capped = true; break; }
      const { words, overlap } = draw(k);
      if (!words) continue;
      tried++;
      const board = generateBoard(theme, words, rand, { blockset, stats: pruned });
      if (!board || earlierGrids.has(board.grid.join(''))) continue;
      const result = checkPuzzle(board, checked);
      const offensive = offensiveWordsOn(board.grid, blockset, board.answers);
      if (!result.ok || offensive.length || result.steppingStones.join() !== board.steppingStones.join()) {
        throw new Error(`generator produced a failing board for ${theme.id}: ${result.reason || offensive.join(' ') || 'stepping stones differ'}`);
      }
      passes++;
      const variant = { grid: board.grid, answers: board.answers };
      const score = difficulty(variant, { obscure: !!theme.obscure });
      const stones = result.steppingStones.length;
      const held = byStones.get(stones);
      if (!held || overlap < held.overlap || (overlap === held.overlap && score > held.score)) {
        byStones.set(stones, { variant, score, steppingStones: result.steppingStones, overlap });
      }
    }
    if (passes) { count = k; break; }
    if (capped) break;
  }
  if (!passes) {
    const why = tried
      ? `no passing board in ${tried} attempts (pruned: ${Object.entries(pruned).sort().map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`
      : 'no word set fills the board';
    return { failure: `${why}${capped ? '; time cap hit' : ''}`, capped };
  }
  const leastOverlap = Math.min(...[...byStones.values()].map((c) => c.overlap));
  const candidates = [...byStones.keys()].sort((a, b) => a - b).map((n) => byStones.get(n))
    .filter((c) => c.overlap === leastOverlap);
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  return { best, candidates, passes, attempts: tried, capped, count, target, overlap: leastOverlap };
}

// Choose `count` boards from the themes that produced one. `successes` are { theme, candidates }
// (candidates: one board per stepping-stone count). A theme ranks by its hardest board; picks
// keep the theme-word counts balanced, taking up to MAX_OBSCURE obscure themes first, then
// familiar themes, then any obscure ones left if more are needed. Each selected theme then
// gets `chosen`, the candidate whose stepping-stone count balances the drop.
//
// With `dailies` given, the first `dailies` picks (returned as `daily`) come only from fresh
// themes (success.fresh !== false), with obscure themes limited to what the schedule has slots
// for; the rest (the library) come from the themes left, fresh or reused.
export function selectBoards(successes, count, { dailies = 0 } = {}) {
  const byScore = (a, b) => b.score - a.score || a.theme.id.localeCompare(b.theme.id);
  const ranked = successes.map((s) => ({
    ...s,
    score: Math.max(...s.candidates.map((c) => c.score)),
    count: s.candidates[0].variant.answers.length - 1,
  }));
  const used = new Map();
  const pick = (list, n) => pickBalanced(list, n, (s) => s.count, used);
  // Obscure themes first up to `quota`, then familiar, then any obscure left.
  const tier = (pool, n, quota) => {
    const obscure = pick(pool.filter((s) => s.theme.obscure).sort(byScore), Math.min(quota, n));
    const familiar = pick(pool.filter((s) => !s.theme.obscure).sort(byScore), n - obscure.picked.length);
    const extra = pick(obscure.left, n - obscure.picked.length - familiar.picked.length);
    return {
      picked: [...obscure.picked, ...familiar.picked, ...extra.picked],
      left: [...familiar.left, ...extra.left],
      obscure: obscure.picked.length,
    };
  };
  let daily = [];
  let selected;
  let left;
  if (dailies) {
    const slots = Math.floor((dailies + 6) / 7);
    const first = tier(ranked.filter((s) => s.fresh !== false), dailies, Math.min(MAX_OBSCURE, slots));
    const taken = new Set(first.picked);
    const rest = tier(ranked.filter((s) => !taken.has(s)), count - first.picked.length, Math.max(0, MAX_OBSCURE - first.obscure));
    daily = first.picked;
    selected = [...first.picked, ...rest.picked];
    left = rest.left;
  } else {
    const only = tier(ranked, count, MAX_OBSCURE);
    selected = only.picked;
    left = only.left;
  }
  const stones = spreadStones(selected.map((s) => ({
    id: s.theme.id,
    options: s.candidates.map((c) => ({ stones: c.steppingStones.length, score: c.score })),
  })));
  for (const s of selected) {
    s.chosen = s.candidates.find((c) => c.steppingStones.length === stones.get(s.theme.id));
  }
  return { selected, daily, spares: left.map((s) => s.theme.id) };
}

// Dictionary words of 6+ letters a player could select: any self-avoiding path, self-crossing
// included (they are not answers).
function tracedDictionaryWords(grid, dictionaryWords, exclude) {
  const counts = {};
  for (const ch of grid) counts[ch] = (counts[ch] ?? 0) + 1;
  const found = [];
  for (const word of dictionaryWords) {
    if (word.length < 6 || exclude.has(word)) continue;
    const need = {};
    let possible = true;
    for (const ch of word) {
      need[ch] = (need[ch] ?? 0) + 1;
      if (need[ch] > (counts[ch] ?? 0)) { possible = false; break; }
    }
    if (possible && isTraceable(grid, word, ANY_TRACE)) found.push(word);
  }
  return found;
}

export function buildDrop({
  dropId, startDate, count = 50, dailies = 30, attempts = DEFAULT_ATTEMPTS, seconds = DEFAULT_SECONDS,
  themes, ranks, earlier = {}, dictionaryWords = [], blockset = new Set(),
  search = null,
}) {
  const { jobs, failures, rejections } = planDrop({ dropId, themes, ranks, earlier, dailies });
  const cappedThemes = [];
  const successes = [];

  for (const { theme, eligible, feasible, target, fresh, avoid } of jobs) {
    const found = search
      ? search(theme)
      : searchTheme(theme, dropId, { attempts, seconds, eligible, blockset, target, feasible, avoid });
    if (found.capped) cappedThemes.push(theme.id);
    if (found.failure) {
      failures.push({ themeId: theme.id, reason: found.failure });
      continue;
    }
    successes.push({ theme, target, fresh, candidates: found.candidates ?? [found.best] });
  }
  failures.sort((a, b) => a.themeId.localeCompare(b.themeId));

  const freshFound = successes.filter((s) => s.fresh).length;
  requireFreshThemes(freshFound, dailies, failures);
  const { selected, daily, spares } = selectBoards(successes, count, { dailies });
  // Themes that ended up at another word count than planned: those in the drop, and the spares.
  const fellBack = (list) => list
    .map((s) => ({ themeId: s.theme.id, target: s.target, count: s.candidates[0].variant.answers.length - 1 }))
    .filter((f) => f.count !== f.target)
    .sort((a, b) => a.themeId.localeCompare(b.themeId));
  const inDrop = new Set(selected.map((s) => s.theme.id));
  const fallbacks = fellBack(successes.filter((s) => inDrop.has(s.theme.id)));
  const spareFallbacks = fellBack(successes.filter((s) => !inDrop.has(s.theme.id)));
  const arrows = (list) => list.map((f) => `${f.themeId} (${f.target}→${f.count})`).join(' ') || '(none)';

  const lines = [];
  if (selected.length < count) {
    lines.push(`FAILED: only ${selected.length} of ${count} themes produced a puzzle.`);
    for (const f of failures) lines.push(`  ${f.themeId}: ${f.reason}`);
    return { drop: null, meta: null, report: lines.join('\n'), failures, spares, variety: null };
  }

  const toPuzzle = ({ theme, chosen }) => ({
    themeId: theme.id,
    clue: theme.clue,
    obscure: !!theme.obscure,
    grid: chosen.variant.grid,
    answers: chosen.variant.answers,
    steppingStones: chosen.steppingStones,
    difficulty: Math.round(chosen.score * 100) / 100,
  });
  const byId = (a, b) => a.theme.id.localeCompare(b.theme.id);
  const dailySet = new Set(daily);
  const puzzles = daily.slice().sort(byId).map(toPuzzle);
  const library = selected.filter((s) => !dailySet.has(s)).sort(byId).map(toPuzzle);
  const drop = assembleDrop({
    id: dropId, startDate, puzzles, library, dailies, rand: mulberry32(hashString(`assemble:${dropId}`)),
  });

  const byTheme = new Map(selected.map((s) => [s.theme.id, s.theme]));
  const dateOf = new Map(Object.entries(drop.schedule).map(([date, id]) => [id, date]));
  const meta = {};
  const variety = {
    wordCounts: drop.puzzles.map((p) => p.answers.length - 1).sort(),
    stoneCounts: drop.puzzles.map((p) => p.steppingStones.length).sort(),
    planned: selected.map((s) => s.target).sort(),
    fallbacks,
    spareFallbacks,
  };
  lines.push(`Drop ${dropId}: ${drop.puzzles.length} puzzles (${Object.keys(drop.schedule).length} scheduled, ${drop.library.length} library)`);
  lines.push(`Theme words per board: ${tallyLine(variety.wordCounts)} (planned: ${tallyLine(variety.planned)})`);
  lines.push(`Stepping stones per board: ${tallyLine(variety.stoneCounts)}`);
  lines.push(`Fell back from target word count: ${arrows(fallbacks)}`);
  lines.push(`Spares that fell back: ${arrows(spareFallbacks)}`);
  for (const p of drop.puzzles) {
    const theme = byTheme.get(p.themeId);
    const answerWords = new Set(p.answers.map((a) => a.word));
    meta[p.id] = {
      checkedLong: [...new Set([...theme.answers, ...theme.recognized])]
        .filter((w) => w.length >= 6 && !answerWords.has(w)).sort(),
      // Stepping-stone candidates: recognized words and unchosen answers of 4-5 letters.
      stoneCandidates: [...new Set([...theme.recognized, ...theme.answers])]
        .filter((w) => w.length >= 4 && w.length <= 5 && !answerWords.has(w)).sort(),
    };
    const known = new Set([...answerWords, ...theme.answers]);
    const decoys = tracedDictionaryWords(p.grid, dictionaryWords, known);
    lines.push(`${p.id} [${dateOf.get(p.id) ?? 'LIBRARY'}] ${p.themeId}${p.obscure ? ' (obscure)' : ''} difficulty ${p.difficulty.toFixed(2)}`);
    lines.push(`  answers: ${p.answers.map((a) => a.word).join(' ')}`);
    lines.push(`  stepping stones: ${p.steppingStones.join(' ')}`);
    if (decoys.length) lines.push(`  dictionary decoys (review): ${decoys.join(' ')}`);
  }
  if (failures.length) {
    lines.push('Skipped themes:');
    for (const f of failures) lines.push(`  ${f.themeId}: ${f.reason}`);
  }
  if (rejections.length) {
    lines.push('Familiarity rejections:');
    for (const r of rejections) lines.push(`  ${r.themeId}: ${r.words.join(' ')}`);
  }
  if (cappedThemes.length) lines.push(`Time cap hit (results may not be reproducible): ${cappedThemes.join(' ')}`);
  lines.push(`Spares: ${spares.length ? spares.join(' ') : '(none)'}`);
  return { drop, meta, report: lines.join('\n'), failures, spares, variety };
}

// Runners take jobs ({ theme, dropId, attempts, seconds, eligible, feasible, target }) and resolve to a
// Map of theme id -> { result, ms }. Results never depend on completion order.
export function searchJob({ theme, dropId, ...options }, blockset) {
  return searchTheme(theme, dropId, { ...options, blockset });
}

export async function runSequential(jobs, { blockset }) {
  const out = new Map();
  for (const job of jobs) {
    const started = performance.now();
    const result = searchJob(job, blockset);
    out.set(job.theme.id, { result, ms: performance.now() - started });
  }
  return out;
}

export function runInWorkers(jobs, { blockset, workers }) {
  const out = new Map();
  if (!jobs.length) return Promise.resolve(out);
  const n = Math.min(workers, jobs.length);
  const workerUrl = new URL('./lib/search-worker.mjs', import.meta.url);
  return new Promise((resolve, reject) => {
    let next = 0;
    let live = n;
    let failed = false;
    const pool = [];
    const fail = (err) => {
      if (failed) return;
      failed = true;
      pool.forEach((w) => w.terminate());
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const feed = (w) => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
      else { w.terminate(); if (--live === 0 && !failed) resolve(out); }
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(workerUrl, { workerData: { blockset } });
      pool.push(w);
      w.on('message', (m) => {
        if (m.error) return fail(new Error(`worker failed on ${m.id}: ${m.error}`));
        out.set(m.id, { result: m.result, ms: m.ms });
        feed(w);
      });
      w.on('error', fail);
      feed(w);
    }
  });
}

// Same output as buildDrop, with the per-theme searches farmed out to a runner.
export async function buildDropParallel(opts, { workers = 1, runner } = {}) {
  const { dropId, attempts = DEFAULT_ATTEMPTS, seconds = DEFAULT_SECONDS, blockset = new Set() } = opts;
  const jobs = planDrop({ dailies: 30, ...opts }).jobs.map((job) => ({ ...job, dropId, attempts, seconds }));
  const run = runner ?? (workers > 1 ? runInWorkers : runSequential);
  const started = performance.now();
  const results = await run(jobs, { blockset, workers });
  const wallMs = performance.now() - started;
  const timings = jobs.map((j) => ({ themeId: j.theme.id, ms: results.get(j.theme.id).ms }));
  const built = buildDrop({ dailies: 30, ...opts, search: (theme) => results.get(theme.id).result });
  return { ...built, timings, wallMs };
}

export function timingHeader(timings, wallMs, workers) {
  const secs = (ms) => (ms / 1000).toFixed(1);
  const lines = [`Search: ${timings.length} themes, ${workers} worker(s), wall time ${secs(wallMs)}s`];
  for (const t of timings) lines.push(`  ${t.themeId}: ${secs(t.ms)}s`);
  return lines.join('\n');
}

const USAGE = `Usage: build-drop --id 2026-10 --start 2026-10-08 [--count 50] [--attempts ${DEFAULT_ATTEMPTS}] [--seconds ${DEFAULT_SECONDS}] [--workers N] [--content dir] [--out dir]
  --out writes the drop and its meta to another directory (a trial build); drops/ and its index are left alone.`;

export function parseArgs(argv) {
  const args = {
    count: 50, attempts: DEFAULT_ATTEMPTS, seconds: DEFAULT_SECONDS, content: 'content/themes', out: 'drops',
    workers: Math.max(1, os.availableParallelism() - 2),
  };
  const numeric = ['count', 'attempts', 'seconds', 'workers'];
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (![...numeric, 'id', 'start', 'content', 'out'].includes(key) || argv[i + 1] === undefined) {
      throw new Error(`Unknown or incomplete argument: ${argv[i]}\n${USAGE}`);
    }
    if (numeric.includes(key) && !/^[1-9]\d*$/.test(argv[i + 1])) {
      throw new Error(`--${key} must be a positive integer, got "${argv[i + 1]}"\n${USAGE}`);
    }
    args[key] = numeric.includes(key) ? Number(argv[i + 1]) : argv[i + 1];
  }
  if (!args.id || !args.start) throw new Error(USAGE);
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
  const args = parseArgs(process.argv.slice(2));
  const files = (await readdir(args.content)).filter((f) => f.endsWith('.json')).sort();
  const themes = await Promise.all(files.map((f) => readJson(join(args.content, f))));
  const index = await readJson('drops/index.json', []);
  const earlierDrops = [];
  for (const id of index.filter((i) => i !== args.id)) earlierDrops.push(await readJson(`drops/${id}.json`));
  const earlier = earlierUse(earlierDrops);
  const dictionaryWords = (await readFile('data/words.txt', 'utf8'))
    .split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean);
  const ranks = await loadRanks();
  const blockset = await loadBoardBlocklist();
  const result = await buildDropParallel({
    dropId: args.id, startDate: args.start, count: args.count,
    attempts: args.attempts, seconds: args.seconds,
    themes, ranks, earlier, dictionaryWords, blockset,
  }, { workers: args.workers });
  console.log(`${timingHeader(result.timings, result.wallMs, args.workers)}
${result.report}`);
  if (!result.drop) process.exit(1);
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, `${args.id}.json`), JSON.stringify(result.drop));
  await writeFile(join(args.out, `${args.id}.meta.json`), JSON.stringify(result.meta, null, 1));
  // A trial build elsewhere is not published: only drops/ has an index.
  if (args.out === 'drops') {
    await writeFile('drops/index.json', JSON.stringify([...new Set([...index, args.id])].sort()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
