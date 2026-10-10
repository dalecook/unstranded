// Offline drop builder: searches each theme for its best passing puzzle layout,
// selects puzzles across themes and assembles a monthly drop with schedule and library.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { mulberry32, hashString, shuffle } from '../js/rng.js';
import { chooseWords, layoutWords } from './lib/layout.js';
import { directionVariants, checkPuzzle, difficulty, isTraceable } from './lib/checks.js';
import { loadRanks, eligibleAnswers } from './lib/familiarity.js';
import { assembleDrop } from './lib/assemble.js';
import { loadBoardBlocklist, offensiveWordsOn } from './lib/blocklist.js';

const PASS_LIMIT = 200;
const MAX_OBSCURE = 10;

// Best passing puzzle for one theme, or { failure } explaining why there is none.
// Stopping is deterministic (attempt and pass counts); the time cap is a safety net only.
export function searchTheme(theme, dropId, { attempts, seconds, eligible, blockset = new Set() }) {
  const rand = mulberry32(hashString(`${theme.id}:${dropId}`));
  const pool = shuffle(eligible, rand)
    .map((word, i) => ({ word, i }))
    .sort((a, b) => b.word.length - a.word.length || a.i - b.i)
    .map((e) => e.word);
  const deadline = Date.now() + seconds * 1000;
  const reasons = new Set();
  let best = null;
  let passes = 0;
  let layouts = 0;
  let capped = false;

  for (let attempt = 0; attempt < attempts && passes < PASS_LIMIT; attempt++) {
    if (Date.now() > deadline) { capped = true; break; }
    const start = attempt % pool.length;
    const subject = { spangram: theme.spangram, words: [...pool.slice(start), ...pool.slice(0, start)] };
    const opts = { maxCount: 7, shuffle: false };
    const words = chooseWords(subject, rand, { ...opts, minCount: 5 })
      ?? chooseWords(subject, rand, { ...opts, minCount: 4 });
    if (!words) continue;
    const layout = layoutWords(theme.spangram, words, rand);
    if (!layout) continue;
    layouts++;
    for (const variant of directionVariants(layout)) {
      const result = checkPuzzle(variant, { answers: theme.answers, recognized: theme.recognized });
      if (!result.ok) { reasons.add(result.reason); continue; }
      if (offensiveWordsOn(variant.grid, blockset, variant.answers).length) { reasons.add('offensive'); continue; }
      passes++;
      const score = difficulty(variant, { obscure: !!theme.obscure });
      if (!best || score > best.score) best = { variant, score, steppingStones: result.steppingStones };
    }
  }
  if (!best) {
    const why = layouts
      ? `no passing layout in ${layouts} layouts (${[...reasons].sort().join(', ')})`
      : 'no layout could be built';
    return { failure: `${why}${capped ? '; time cap hit' : ''}`, capped };
  }
  return { best, passes, layouts, capped };
}

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
    if (possible && isTraceable(grid, word)) found.push(word);
  }
  return found;
}

export function buildDrop({
  dropId, startDate, count = 50, dailies = 30, attempts = 2000, seconds = 60,
  themes, ranks, existingDropThemeIds = [], dictionaryWords = [], blockset = new Set(),
  search = null,
}) {
  const skipped = new Set(existingDropThemeIds);
  const failures = [];
  const rejections = [];
  const cappedThemes = [];
  const successes = [];

  for (const theme of [...themes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (skipped.has(theme.id)) continue;
    const { eligible, rejected } = eligibleAnswers(theme, ranks);
    if (rejected.length) rejections.push({ themeId: theme.id, words: rejected });
    if (eligible.length < 4) {
      failures.push({ themeId: theme.id, reason: `only ${eligible.length} eligible answers` });
      continue;
    }
    const found = search ? search(theme) : searchTheme(theme, dropId, { attempts, seconds, eligible, blockset });
    if (found.capped) cappedThemes.push(theme.id);
    if (found.failure) {
      failures.push({ themeId: theme.id, reason: found.failure });
      continue;
    }
    successes.push({ theme, ...found.best });
  }

  const byScore = (a, b) => b.score - a.score || a.theme.id.localeCompare(b.theme.id);
  const obscure = successes.filter((s) => s.theme.obscure).sort(byScore);
  const familiar = successes.filter((s) => !s.theme.obscure).sort(byScore);
  const chosenObscure = obscure.slice(0, Math.min(MAX_OBSCURE, count));
  const rest = [...familiar, ...obscure.slice(chosenObscure.length)];
  const selected = [...chosenObscure, ...rest.slice(0, count - chosenObscure.length)];
  const spares = rest.slice(count - chosenObscure.length).map((s) => s.theme.id);

  const lines = [];
  if (selected.length < count) {
    lines.push(`FAILED: only ${selected.length} of ${count} themes produced a puzzle.`);
    for (const f of failures) lines.push(`  ${f.themeId}: ${f.reason}`);
    return { drop: null, meta: null, report: lines.join('\n'), failures, spares };
  }

  const puzzles = selected
    .sort((a, b) => a.theme.id.localeCompare(b.theme.id))
    .map(({ theme, variant, score, steppingStones }) => ({
      themeId: theme.id,
      clue: theme.clue,
      obscure: !!theme.obscure,
      grid: variant.grid,
      answers: variant.answers,
      steppingStones,
      difficulty: Math.round(score * 100) / 100,
    }));
  const drop = assembleDrop({
    id: dropId, startDate, puzzles, dailies, rand: mulberry32(hashString(`assemble:${dropId}`)),
  });

  const byTheme = new Map(selected.map((s) => [s.theme.id, s.theme]));
  const dateOf = new Map(Object.entries(drop.schedule).map(([date, id]) => [id, date]));
  const meta = {};
  lines.push(`Drop ${dropId}: ${drop.puzzles.length} puzzles (${Object.keys(drop.schedule).length} scheduled, ${drop.library.length} library)`);
  for (const p of drop.puzzles) {
    const theme = byTheme.get(p.themeId);
    const answerWords = new Set(p.answers.map((a) => a.word));
    meta[p.id] = {
      checkedLong: [...new Set([...theme.answers, ...theme.recognized])]
        .filter((w) => w.length >= 6 && !answerWords.has(w)).sort(),
      recognizedShort: [...new Set(theme.recognized)]
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
  return { drop, meta, report: lines.join('\n'), failures, spares };
}

// Runners take jobs ({ theme, dropId, attempts, seconds, eligible }) and resolve to a
// Map of theme id -> { result, ms }. Results never depend on completion order.
export async function runSequential(jobs, { blockset }) {
  const out = new Map();
  for (const job of jobs) {
    const started = performance.now();
    const result = searchTheme(job.theme, job.dropId, {
      attempts: job.attempts, seconds: job.seconds, eligible: job.eligible, blockset,
    });
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
  const { dropId, attempts = 2000, seconds = 60, themes, ranks, existingDropThemeIds = [], blockset = new Set() } = opts;
  const skipped = new Set(existingDropThemeIds);
  const jobs = [];
  for (const theme of [...themes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (skipped.has(theme.id)) continue;
    const { eligible } = eligibleAnswers(theme, ranks);
    if (eligible.length >= 4) jobs.push({ theme, dropId, attempts, seconds, eligible });
  }
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

const USAGE = 'Usage: build-drop --id 2026-10 --start 2026-10-08 [--count 50] [--attempts 6000] [--seconds 300] [--workers N] [--content dir]';

export function parseArgs(argv) {
  const args = {
    count: 50, attempts: 6000, seconds: 300, content: 'content/themes',
    workers: Math.max(1, os.availableParallelism() - 2),
  };
  const numeric = ['count', 'attempts', 'seconds', 'workers'];
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (![...numeric, 'id', 'start', 'content'].includes(key) || argv[i + 1] === undefined) {
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
  await mkdir('drops', { recursive: true });
  await writeFile(`drops/${args.id}.json`, JSON.stringify(result.drop));
  await writeFile(`drops/${args.id}.meta.json`, JSON.stringify(result.meta, null, 1));
  await writeFile('drops/index.json', JSON.stringify([...new Set([...index, args.id])].sort()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
