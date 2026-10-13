// Offline drop builder: searches each theme for passing puzzle layouts, selects puzzles across
// themes and assembles a monthly drop with schedule and library.
//
// Board variety. A drop should not be fifty boards of the same shape, so the build plans a
// spread and then keeps to it as far as the themes allow:
//   1. Plan (planDrop): each theme's feasible theme-word counts are worked out from its
//      eligible answers (4-8 words that exactly fill the cells its spangram leaves), and every
//      theme is given a target count so the targets are spread as evenly as possible over 4-8.
//   2. Search (searchTheme): boards are built with exactly the target number of words. If none
//      passes, the nearest feasible counts are tried in turn and the fallback is reported. The
//      hardest passing board is kept for each stepping-stone count (2-5).
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
import { feasibleCounts, assignTargets, fallbackOrder, pickBalanced, spreadStones, tallyLine } from './lib/variety.js';
import { loadBoardBlocklist, offensiveWordsOn } from './lib/blocklist.js';

// Passing boards collected per theme; the most difficult one of each stepping-stone count is kept.
export const MAX_CANDIDATES = 30;
export const DEFAULT_ATTEMPTS = 6000;
export const DEFAULT_SECONDS = 900;
const MAX_OBSCURE = 10;
// Word count aimed for when a caller gives searchTheme no target.
const DEFAULT_TARGET = 6;

// Which themes to search, and the number of theme words each should aim for. Returns the jobs
// ({ theme, eligible, feasible, target }, in theme id order) plus the themes that cannot be
// searched at all and the answers rejected as unfamiliar.
export function planDrop({ dropId, themes, ranks, existingDropThemeIds = [] }) {
  const skipped = new Set(existingDropThemeIds);
  const failures = [];
  const rejections = [];
  const jobs = [];
  for (const theme of [...themes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (skipped.has(theme.id)) continue;
    const { eligible, rejected } = eligibleAnswers(theme, ranks);
    if (rejected.length) rejections.push({ themeId: theme.id, words: rejected });
    if (eligible.length < 4) {
      failures.push({ themeId: theme.id, reason: `only ${eligible.length} eligible answers` });
      continue;
    }
    const feasible = feasibleCounts(theme.spangram, eligible);
    if (!feasible.length) {
      failures.push({ themeId: theme.id, reason: 'no word set fills the board' });
      continue;
    }
    jobs.push({ theme, eligible, feasible });
  }
  const targets = assignTargets(jobs.map((j) => ({ id: j.theme.id, feasible: j.feasible })), dropId);
  for (const job of jobs) job.target = targets.get(job.theme.id);
  return { jobs, failures, rejections };
}

// Passing puzzles for one theme, or { failure } explaining why there are none. Each attempt
// picks exactly `target` words (a fresh random subset every time) and asks the check-as-you-go
// generator for a finished board; every board is then verified with checkPuzzle and the
// blocklist (a board failing either is a generator bug). If no board passes at the target, the
// other feasible counts are tried, nearest first, with the same number of attempts each.
// Returns the hardest board per stepping-stone count (`candidates`, fewest stones first), the
// hardest of all (`best`), and the word count used (`count`, which differs from `target` after
// a fallback). Stopping is deterministic (attempt and candidate counts); the time cap is a
// safety net only.
export function searchTheme(theme, dropId, {
  attempts, seconds, eligible, blockset = new Set(), maxCandidates = MAX_CANDIDATES,
  target = DEFAULT_TARGET, feasible = feasibleCounts(theme.spangram, eligible),
}) {
  const rand = mulberry32(hashString(`${theme.id}:${dropId}`));
  const subject = { spangram: theme.spangram, words: eligible };
  const deadline = Date.now() + seconds * 1000;
  const pruned = {};
  const checked = { answers: theme.answers, recognized: theme.recognized };
  const byStones = new Map();
  let count = null;
  let passes = 0;
  let tried = 0;
  let capped = false;

  for (const k of fallbackOrder(target, feasible)) {
    for (let attempt = 0; attempt < attempts && passes < maxCandidates; attempt++) {
      if (Date.now() > deadline) { capped = true; break; }
      const words = chooseWords(subject, rand, { minCount: k, maxCount: k });
      if (!words) continue;
      tried++;
      const board = generateBoard(theme, words, rand, { blockset, stats: pruned });
      if (!board) continue;
      const result = checkPuzzle(board, checked);
      const offensive = offensiveWordsOn(board.grid, blockset, board.answers);
      if (!result.ok || offensive.length || result.steppingStones.join() !== board.steppingStones.join()) {
        throw new Error(`generator produced a failing board for ${theme.id}: ${result.reason || offensive.join(' ') || 'stepping stones differ'}`);
      }
      passes++;
      const variant = { grid: board.grid, answers: board.answers };
      const score = difficulty(variant, { obscure: !!theme.obscure });
      const stones = result.steppingStones.length;
      if (!byStones.has(stones) || score > byStones.get(stones).score) {
        byStones.set(stones, { variant, score, steppingStones: result.steppingStones });
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
  const candidates = [...byStones.keys()].sort((a, b) => a - b).map((n) => byStones.get(n));
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  return { best, candidates, passes, attempts: tried, capped, count, target };
}

// Choose `count` boards from the themes that produced one. `successes` are { theme, candidates }
// (candidates: one board per stepping-stone count). A theme ranks by its hardest board; picks
// keep the theme-word counts balanced, taking up to MAX_OBSCURE obscure themes first, then
// familiar themes, then any obscure ones left if more are needed. Each selected theme then
// gets `chosen`, the candidate whose stepping-stone count balances the drop.
export function selectBoards(successes, count) {
  const byScore = (a, b) => b.score - a.score || a.theme.id.localeCompare(b.theme.id);
  const ranked = successes.map((s) => ({
    ...s,
    score: Math.max(...s.candidates.map((c) => c.score)),
    count: s.candidates[0].variant.answers.length - 1,
  }));
  const used = new Map();
  const pick = (list, n) => pickBalanced(list, n, (s) => s.count, used);
  const obscure = pick(ranked.filter((s) => s.theme.obscure).sort(byScore), Math.min(MAX_OBSCURE, count));
  const familiar = pick(ranked.filter((s) => !s.theme.obscure).sort(byScore), count - obscure.picked.length);
  const extra = pick(obscure.left, count - obscure.picked.length - familiar.picked.length);
  const selected = [...obscure.picked, ...familiar.picked, ...extra.picked];
  const stones = spreadStones(selected.map((s) => ({
    id: s.theme.id,
    options: s.candidates.map((c) => ({ stones: c.steppingStones.length, score: c.score })),
  })));
  for (const s of selected) {
    s.chosen = s.candidates.find((c) => c.steppingStones.length === stones.get(s.theme.id));
  }
  return { selected, spares: [...familiar.left, ...extra.left].map((s) => s.theme.id) };
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
  themes, ranks, existingDropThemeIds = [], dictionaryWords = [], blockset = new Set(),
  search = null,
}) {
  const { jobs, failures, rejections } = planDrop({ dropId, themes, ranks, existingDropThemeIds });
  const cappedThemes = [];
  const successes = [];

  for (const { theme, eligible, feasible, target } of jobs) {
    const found = search
      ? search(theme)
      : searchTheme(theme, dropId, { attempts, seconds, eligible, blockset, target, feasible });
    if (found.capped) cappedThemes.push(theme.id);
    if (found.failure) {
      failures.push({ themeId: theme.id, reason: found.failure });
      continue;
    }
    successes.push({ theme, target, candidates: found.candidates ?? [found.best] });
  }
  failures.sort((a, b) => a.themeId.localeCompare(b.themeId));

  const { selected, spares } = selectBoards(successes, count);
  const fallbacks = successes
    .map((s) => ({ themeId: s.theme.id, target: s.target, count: s.candidates[0].variant.answers.length - 1 }))
    .filter((f) => f.count !== f.target);

  const lines = [];
  if (selected.length < count) {
    lines.push(`FAILED: only ${selected.length} of ${count} themes produced a puzzle.`);
    for (const f of failures) lines.push(`  ${f.themeId}: ${f.reason}`);
    return { drop: null, meta: null, report: lines.join('\n'), failures, spares, variety: null };
  }

  const puzzles = selected
    .sort((a, b) => a.theme.id.localeCompare(b.theme.id))
    .map(({ theme, chosen }) => ({
      themeId: theme.id,
      clue: theme.clue,
      obscure: !!theme.obscure,
      grid: chosen.variant.grid,
      answers: chosen.variant.answers,
      steppingStones: chosen.steppingStones,
      difficulty: Math.round(chosen.score * 100) / 100,
    }));
  const drop = assembleDrop({
    id: dropId, startDate, puzzles, dailies, rand: mulberry32(hashString(`assemble:${dropId}`)),
  });

  const byTheme = new Map(selected.map((s) => [s.theme.id, s.theme]));
  const dateOf = new Map(Object.entries(drop.schedule).map(([date, id]) => [id, date]));
  const meta = {};
  const variety = {
    wordCounts: drop.puzzles.map((p) => p.answers.length - 1).sort(),
    stoneCounts: drop.puzzles.map((p) => p.steppingStones.length).sort(),
    fallbacks,
  };
  lines.push(`Drop ${dropId}: ${drop.puzzles.length} puzzles (${Object.keys(drop.schedule).length} scheduled, ${drop.library.length} library)`);
  lines.push(`Theme words per board: ${tallyLine(variety.wordCounts)}`);
  lines.push(`Stepping stones per board: ${tallyLine(variety.stoneCounts)}`);
  lines.push(`Fell back from target word count: ${fallbacks.map((f) => `${f.themeId} (${f.target}→${f.count})`).join(' ') || '(none)'}`);
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
  const jobs = planDrop(opts).jobs.map((job) => ({ ...job, dropId, attempts, seconds }));
  const run = runner ?? (workers > 1 ? runInWorkers : runSequential);
  const started = performance.now();
  const results = await run(jobs, { blockset, workers });
  const wallMs = performance.now() - started;
  const timings = jobs.map((j) => ({ themeId: j.theme.id, ms: results.get(j.theme.id).ms }));
  const built = buildDrop({ ...opts, search: (theme) => results.get(theme.id).result });
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
  const existingDropThemeIds = [];
  for (const id of index.filter((i) => i !== args.id)) {
    const old = await readJson(`drops/${id}.json`);
    existingDropThemeIds.push(...old.puzzles.map((p) => p.themeId));
  }
  const dictionaryWords = (await readFile('data/words.txt', 'utf8'))
    .split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean);
  const ranks = await loadRanks();
  const blockset = await loadBoardBlocklist();
  const result = await buildDropParallel({
    dropId: args.id, startDate: args.start, count: args.count,
    attempts: args.attempts, seconds: args.seconds,
    themes, ranks, existingDropThemeIds, dictionaryWords, blockset,
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
