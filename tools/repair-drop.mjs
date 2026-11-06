// Locked repair of published monthly drops (now free-play boards): each board that no longer
// passes verifyPuzzle, or that is named with --ids, gets a new board for the same theme under
// the same id, so its schedule date or library place is unchanged. The new board keeps the old
// word count and, as near as it can, the old stepping-stone count, and differs from every
// board the theme already has in the drops and the daily-set sequence.
//
//   node tools/repair-drop.mjs [--drops 2026-10,2026-11] [--ids id,id] [--attempts N] [--seconds N] [--workers N]
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { verifyPuzzle } from './lib/layout.js';
import { eligibleAnswers, loadRanks } from './lib/familiarity.js';
import { countWordSets, targetCounts } from './lib/variety.js';
import { loadBoardBlocklist } from './lib/blocklist.js';
import {
  earlierUse, tracedDictionaryWords, runInWorkers, runSequential, DEFAULT_ATTEMPTS, DEFAULT_SECONDS,
} from './build-drop.mjs';
import { applyRebuild } from './build-sequence.mjs';

// Search jobs for one drop. `boards` maps theme id -> every board that theme already has
// (earlierUse over the drops and the sequence, this board included), all of which are avoided.
export function repairJobs({ drop, meta, themes, ranks, boards = {}, ids = [], attempts, seconds }) {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const jobs = [];
  const failures = [];
  for (const p of drop.puzzles) {
    if (!ids.includes(p.id) && verifyPuzzle(p)) continue;
    const theme = byId.get(p.themeId);
    if (!theme) {
      failures.push({ id: p.id, themeId: p.themeId, reason: 'theme file missing' });
      continue;
    }
    const { eligible } = eligibleAnswers(theme, ranks);
    const feasible = targetCounts(countWordSets(theme.spangram, eligible));
    if (!feasible.length) {
      failures.push({ id: p.id, themeId: theme.id, reason: 'no word set fills the board' });
      continue;
    }
    jobs.push({
      id: p.id, theme, eligible, feasible,
      target: p.answers.length - 1,
      avoid: boards[theme.id] ?? [],
      dropId: `${drop.id}-r${(meta[p.id]?.rebuilds ?? 0) + 1}`,
      attempts, seconds,
      stones: p.steppingStones.length,
    });
  }
  return { jobs, failures };
}

const USAGE = 'Usage: repair-drop [--drops id,id] [--ids id,id] [--attempts N] [--seconds N] [--workers N]';

export function parseRepairArgs(argv) {
  const args = {
    drops: null, ids: [], attempts: DEFAULT_ATTEMPTS, seconds: DEFAULT_SECONDS,
    workers: Math.max(1, os.availableParallelism() - 2),
  };
  const numeric = ['attempts', 'seconds', 'workers'];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[++i];
    if (![...numeric, 'drops', 'ids'].includes(key) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${argv[i - 1]}\n${USAGE}`);
    }
    if (numeric.includes(key)) {
      if (!/^[1-9]\d*$/.test(value)) throw new Error(`--${key} must be a positive integer, got "${value}"\n${USAGE}`);
      args[key] = Number(value);
    } else {
      args[key] = value.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return args;
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function main() {
  const args = parseRepairArgs(process.argv.slice(2));
  const files = (await readdir('content/themes')).filter((f) => f.endsWith('.json')).sort();
  const themes = await Promise.all(files.map((f) => readJson(join('content/themes', f))));
  const index = await readJson('drops/index.json');
  const dropIds = args.drops ?? index;
  const drops = new Map(await Promise.all(index.map(async (id) => [id, await readJson(`drops/${id}.json`)])));
  const sequence = await readJson('drops/sequence.json').catch(() => null);
  const dictionaryWords = (await readFile('data/words.txt', 'utf8'))
    .split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean);
  const ranks = await loadRanks();
  const blockset = await loadBoardBlocklist();
  const run = (jobs) => (args.workers > 1 ? runInWorkers : runSequential)(jobs, { blockset, workers: args.workers });
  const unknown = dropIds.filter((id) => !drops.has(id));
  if (unknown.length) throw new Error(`not in drops/index.json: ${unknown.join(' ')}`);
  const known = new Set(dropIds.flatMap((id) => drops.get(id).puzzles.map((p) => p.id)));
  const unmatched = args.ids.filter((id) => !known.has(id));
  if (unmatched.length) throw new Error(`--ids not found in the drops being repaired: ${unmatched.join(' ')}`);

  for (const dropId of dropIds) {
    const lines = [];
    const drop = drops.get(dropId);
    const metaFile = `drops/${dropId}.meta.json`;
    const meta = await readJson(metaFile);
    // Recomputed per drop, so a board rebuilt in an earlier drop is avoided too.
    const { boards } = earlierUse([...drops.values(), ...(sequence ? [sequence] : [])]);
    const { jobs, failures } = repairJobs({
      drop, meta, themes, ranks, boards, ids: args.ids, attempts: args.attempts, seconds: args.seconds,
    });
    const results = jobs.length ? await run(jobs) : new Map();
    const applied = applyRebuild({
      sequence: drop, meta, jobs, results: new Map([...results].map(([k, v]) => [k, v.result])),
    });
    failures.push(...applied.failures);
    drops.set(dropId, applied.sequence);
    lines.push(`Drop ${dropId}: rebuilt ${applied.rebuilt.length} board(s)`);
    for (const p of applied.sequence.puzzles.filter((x) => applied.rebuilt.includes(x.id))) {
      const theme = themes.find((t) => t.id === p.themeId);
      const known = new Set([...p.answers.map((a) => a.word), ...theme.answers]);
      const decoys = tracedDictionaryWords(p.grid, dictionaryWords, known);
      lines.push(`${p.id} ${p.themeId}${p.obscure ? ' (obscure)' : ''} difficulty ${p.difficulty.toFixed(2)}`);
      lines.push(`  answers: ${p.answers.map((a) => a.word).join(' ')}`);
      lines.push(`  stepping stones: ${p.steppingStones.join(' ')}`);
      if (decoys.length) lines.push(`  dictionary decoys (review): ${decoys.join(' ')}`);
    }
    if (failures.length) {
      lines.push('NOT REBUILT (fix these themes or rerun with more --attempts):',
        ...failures.map((f) => `  ${f.themeId} (${f.id}): ${f.reason}`));
      process.exitCode = 1;
    }
    if (applied.rebuilt.length) {
      await writeFile(`drops/${dropId}.json`, JSON.stringify(applied.sequence));
      await writeFile(metaFile, JSON.stringify(applied.meta, null, 1));
    }
    console.log(lines.join('\n'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
