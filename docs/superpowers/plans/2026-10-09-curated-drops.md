# Curated Monthly Drops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace on-device puzzle generation with an offline build pipeline. The pipeline produces a verified, curated monthly drop of 50 puzzles that the game loads. Each day everyone gets the same daily first. Future dailies are held out. After the daily, players get random unplayed puzzles from the library, and stepping-stone words bank free hints.

**Architecture:**
- **Build-time code** lives in `tools/` and runs on Node only: the layout generator, the hard quality checks, the familiarity filter and the drop builder.
- **Content** lives in `content/themes/*.json`.
- **Build output** is `drops/*.json`, committed and shipped with the game.
- **Runtime** (`js/`) loads drops through a new pure module, `js/drops.js`. Game logic gains stepping stones and banked hints.

**Tech Stack:** plain ES modules, Node 22 `node --test`, no dependencies. Frequency data comes from Norvig's `count_1w.txt`, downloaded at build time to a git-ignored cache and never shipped.

**Spec:** `docs/superpowers/specs/2026-10-09-curated-drops-design.md`. The plan was reviewed before execution and the review's fixes are folded in.

## Global Constraints

- **Grid:** 6×8 = 48 cells, index `row*6+col`, 8-direction adjacency (`js/grid.js`, unchanged).
- **Word lengths:**
  - Answers: A–Z, **6–10 letters**.
  - Spangram: A–Z, 6–14 letters.
  - Stepping stones: `recognized` words of **4–5 letters**.
- **Hard checks.** Every shipped puzzle must pass all of these:
  - Each chosen answer has **exactly one trace** on the full grid. This implies exactly one complete solution.
  - **No on-theme word of 6+ letters** other than a chosen answer can be traced. "On-theme" means everything in the theme file's `answers` (including familiarity rejects) and `recognized` lists.
  - **2–5 stepping stones** can be traced.
  - Full 48-cell coverage, contiguous paths, and a spangram that touches opposite edges.
- **Nesting rule:** no theme word (`answers` or `recognized`) may be a substring, forward or reversed, of another `answers` word or of the spangram in the same theme.
- **Drop shape:**
  - **50 puzzles = 30 scheduled dailies** on consecutive dates from the start date, **plus 20 library-only puzzles**. Every puzzle is in exactly one of `schedule` or `library`.
  - **At most one obscure daily in any 7 consecutive dates**, preferring weekends. Leftover obscure puzzles go to the library.
- **Puzzle ids** are `<dropId>-p<NN>` (e.g. `2026-10-p07`) and **must never reveal the theme**.
- **Release rules at runtime:**
  - A scheduled puzzle is released when its date ≤ today.
  - A library puzzle is released when today ≥ its drop's first schedule date.
  - Unreleased puzzles never appear in random play and never open via `?id=`.
  - The daily falls back to a deterministic date-hash pick when no schedule covers today.
- **Stepping stones in play:** finding one shows "On theme: WORD", **banks 1 hint**, pays out once and locks no cells. Its share emoji is 🪶. Banked hints are spent before the meter. Stepping stones are checked **before** bonus and dictionary words.
- **Random play** picks from released puzzles, excluding today's daily and the current puzzle. It tries unplayed puzzles first, then played but unsolved ones, then all.
- **No runtime dependencies,** no external requests at runtime, and all asset paths relative.
- All `localStorage` access stays wrapped, following the existing `js/storage.js` patterns.
- **Commits:** messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The user pushes manually, so never `git push`.

## File Structure

```
tools/lib/layout.js          COPY of js/generator.js (build-time); chooseWords gains options
tools/lib/checks.js          trace counting, direction variants, hard checks, stepping stones, difficulty
tools/lib/familiarity.js     frequency ranks + eligibility (injectable rank map / fetch)
tools/lib/assemble.js        pure drop assembly: schedule, hold-out, obscure spacing, ids
tools/build-drop.mjs         CLI: content → candidates → best per theme → drop + meta + report
content/themes/*.json        ≥ 55 theme source files
drops/index.json             ["2026-10"]
drops/2026-10.json           first drop (shipped)
drops/2026-10.meta.json      build snapshot for validation (not loaded by the game)
js/drops.js                  runtime: loadDrops, dailyFor, getPuzzle, isReleased, randomPuzzle
js/game.js / share.js / storage.js / main.js / index.html   runtime changes
tests/layout.test.js         (moved from tests/generator.test.js)
tests/checks.test.js, familiarity.test.js, assemble.test.js, content.test.js, drops.test.js, runtime-drops.test.js
```
These are retired in Task 1, because they depend on runtime generation or the old themes:
- `tests/golden.test.js`
- `tests/generator.bulk.test.js`
- `tests/traces.test.js`
- `tests/themes.test.js`

These are retired in Task 7:
- `js/generator.js`
- `data/themes.json`

`data/words.txt` stays, since it's the bonus dictionary.

---

### Task 1: Build-time layout copy and quality checks

**Files:**
- **Copy** `js/generator.js` to `tools/lib/layout.js` (a plain copy, not git mv). `js/generator.js` stays untouched until Task 7, so the app keeps working.
- In `tools/lib/layout.js`, fix the imports to `../../js/grid.js` and `../../js/rng.js`.
- Move `tests/generator.test.js` to `tests/layout.test.js`, importing from `../tools/lib/layout.js`.
- Create `tools/lib/checks.js` and `tests/checks.test.js`.
- Delete `tests/golden.test.js`, `tests/generator.bulk.test.js`, `tests/traces.test.js` and `tests/themes.test.js`.

**`chooseWords(theme, rand, opts = {})` in `tools/lib/layout.js`:**
- **opts:** `{ minCount, maxCount, shuffle = true }`.
- **With `minCount`/`maxCount` given:** run a single `findSubset(pool, target, minCount, maxCount)` with no fallback.
- **With `shuffle: false`:** use `theme.words` in the given order.
- **With no opts:** behaviour is exactly as today, so the existing layout tests still pass.
- Add one test covering `shuffle: false` and the explicit counts.

**Interfaces produced (`tools/lib/checks.js`):**
- `countTraces(grid, word, cap = Infinity): number` returns the number of self-avoiding adjacent paths spelling `word`. It stops early at `cap`.
- `isTraceable(grid, word): boolean` is `countTraces(grid, word, 1) > 0`.
- `directionVariants(layout)` is a generator yielding `{ grid, answers }` for all 2^k forward/reverse assignments. Answers keep their order, so `answers[0]` stays the spangram.
- `checkPuzzle(layout, theme)` returns `{ ok, reason?, steppingStones }`.
  - `theme` is `{ answers: string[], recognized: string[] }`. `answers` means **all** answers in the theme file, including familiarity-rejected ones.
  - Checks run in this order, each with its `reason`:
    1. `'invalid'`: `verifyPuzzle` fails.
    2. `'ambiguous'`: some chosen answer has `countTraces(grid, word, 2) !== 1`.
    3. `'long-decoy'`: some word of 6+ letters in `answers ∪ recognized`, not chosen, can be traced.
    4. `'stones'`: the stepping-stone count is outside 2–5.
  - `steppingStones` is the traceable `recognized` words of 4–5 letters, sorted, excluding chosen answers.
  - Document in a comment that exactly one trace per answer implies exactly one complete solution.
- `difficulty(layout, { obscure })` returns a number in [0,1]:
  - **Formula:** `0.35*norm(meanLen, 6, 10) + 0.35*bendiness + 0.15*norm(spangramLen, 6, 14) + 0.15*(obscure ? 1 : 0)`.
  - `meanLen` and `bendiness` are computed over **non-spangram** answers.
  - `norm(x, a, b) = clamp((x - a) / (b - a), 0, 1)`.
  - Per word, bendiness is the number of direction changes divided by `(len - 2)`. A direction change is when consecutive step vectors `(dRow, dCol)` differ. Words shorter than 3 score 0. The overall bendiness is the mean across words.

Reference core:
```js
import { neighbors, rowOf, colOf } from '../../js/grid.js';
import { verifyPuzzle } from './layout.js';

export function countTraces(grid, word, cap = Infinity) {
  let n = 0;
  const walk = (path) => {
    if (n >= cap) return;
    if (path.length === word.length) { n++; return; }
    for (const next of neighbors(path[path.length - 1])) {
      if (!path.includes(next) && grid[next] === word[path.length]) {
        path.push(next); walk(path); path.pop();
      }
    }
  };
  for (let i = 0; i < grid.length && n < cap; i++) if (grid[i] === word[0]) walk([i]);
  return n;
}

export function* directionVariants({ answers }) {
  for (let mask = 0; mask < (1 << answers.length); mask++) {
    const grid = new Array(48);
    const out = answers.map((a, j) => {
      const path = (mask >> j) & 1 ? [...a.path].reverse() : a.path;
      path.forEach((cell, i) => { grid[cell] = a.word[i]; });
      return { ...a, path };
    });
    yield { grid, answers: out };
  }
}
```

**Tests (`tests/checks.test.js`).** Use hand grids of 48 cells with `'X'` as filler.
- **`countTraces`:**
  - returns 1 for a unique word;
  - returns 2 when a duplicate letter creates a second route;
  - respects `cap`;
  - returns 0 when the word is absent;
  - never reuses a cell (`'ABA'` with a single A gives 0).
- **`directionVariants`:** yields 2^k variants, each passes `verifyPuzzle`, and the all-forward variant equals the input.
- **`checkPuzzle`:**
  - Returns `ok` for a passing fixture. Find one by running `layoutWords` with a fixture theme, then searching `directionVariants` until `checkPuzzle` is ok; seed the RNG so it's deterministic.
  - Returns each failure `reason`, built by editing a copy of a passing layout or extending `recognized`.
  - `steppingStones` is exact.
  - A passing layout has exactly one complete solution: brute-force the non-overlapping traces covering all 48 cells and get 1.
- **`difficulty`:** stays in [0,1], a bendy/long fixture scores higher than a straight/short one, and `obscure` adds 0.15.

- [ ] Step 1: copy and move files and add the `chooseWords` options. Run `npm test`; the layout tests pass.
- [ ] Step 2: write `tests/checks.test.js` and confirm it fails (RED), then implement `tools/lib/checks.js` until it passes (GREEN).
- [ ] Step 3: `npm test`. Commit `feat(tools): build-time layout and quality checks`.

---

### Task 2: Familiarity filter

**Files:** create `tools/lib/familiarity.js` and `tests/familiarity.test.js`. Add `.cache/` to `.gitignore`.

**Interfaces:**
- `loadRanks({ cacheDir = '.cache', fetchImpl = fetch } = {})` returns a `Promise<Map<string, number>>`.
  - Downloads `https://norvig.com/ngrams/count_1w.txt` (following redirects) to `<cacheDir>/count_1w.txt` if it's missing. The file is tab-separated `word\tcount`, sorted by count descending.
  - Returns a map of UPPERCASE word → 1-based rank.
  - Throws a clear error if the download fails and there's no cache.
- `FAMILIAR_RANK = 60000` and `OBSCURE_RANK = 200000`.
- `isFamiliar(word, ranks, { obscure = false, overrides = [] })` returns true if `overrides` includes the word. Otherwise it returns true when the word has a rank within the cutoff for the theme type.
- `eligibleAnswers(theme, ranks)` returns `{ eligible, rejected }`, splitting `theme.answers` by `isFamiliar` using `theme.obscure` and `theme.familiar`.
- Note in a comment that joined multi-word answers (PINOTNOIR) aren't in the corpus and must be listed in `familiar`.

**Tests.** Use an injected rank `Map` (no network) to cover:
- the 60000 and 200000 boundaries;
- overrides winning;
- a missing word being unfamiliar;
- the `eligibleAnswers` split.

Test `loadRanks` with a fake `fetchImpl` and a temp `cacheDir`: it parses the file and writes the cache, and a second call reads the cache without calling `fetchImpl`.

- [ ] RED → GREEN → `npm test`. Commit `feat(tools): familiarity filter from word frequency`.

---

### Task 3: Drop assembly (pure)

**Files:** create `tools/lib/assemble.js` and `tests/assemble.test.js`.

**Interface:** `assembleDrop({ id, startDate, puzzles, dailies = 30, rand })` returns `{ id, puzzles, schedule, library }`.
- **Input:** `startDate` is `'YYYY-MM-DD'`. Each input puzzle has at least `{ themeId, obscure, difficulty, ... }` and no `id`.
- **Dates:** schedule dates are consecutive from `startDate`. Compute them with `dateKey(new Date(y, m - 1, d + i))` from `js/rng.js`.
- **Obscure slots:** walk the dates and take the first Saturday or Sunday that's at least 7 days after the previous obscure slot (or the first weekend day, for the first slot). If no weekend day falls within 9 days of the previous slot, take the date exactly 7 days later. Stop when the number of slots reaches `min(obscureCount, floor((dailies + 6) / 7))`.
- **Filling slots:**
  - Fill the obscure slots with obscure puzzles in `rand` order. Leftover obscure puzzles go to the library.
  - Fill the remaining slots with familiar puzzles chosen by `rand`. Within each 7-day block, reorder **only the familiar slots** by ascending difficulty.
  - The leftover familiar puzzles go to the library.
  - Throw if there are fewer familiar puzzles than familiar slots, or fewer puzzles than `dailies`.
- **Ids:** the output `puzzles` are in schedule order, then library order, and each is assigned `id = \`${id}-p${String(n).padStart(2, '0')}\`` with n starting at 1. `schedule` maps date → id and `library` is an id array.

**Tests.** Use 50 fake puzzles, 10 of them obscure, with start date `2026-10-09` (a Friday) to cross a month boundary:
- 30 consecutive dates, the first being `2026-10-09`, ending `2026-11-07`;
- a library of 20;
- an exact partition with no overlap;
- no 7 consecutive dates containing more than one obscure daily;
- every obscure daily on a weekend in this fixture;
- ids match `^2026-10-p\d{2}$` and contain no themeId;
- valid with 0 obscure;
- throws on too few puzzles;
- deterministic for the same seed.

- [ ] RED → GREEN. Commit `feat(tools): drop assembly with schedule and hold-out`.

---

### Task 4: Theme content (first drop)

**Files:** `content/themes/<id>.json`, with **at least 55 themes** (about 44 familiar and about 11 obscure), plus `tests/content.test.js`. The controller may split authoring into batches.

**Format.** Each theme is `{ id, clue, spangram, obscure, answers, recognized, familiar? }`.
- **`answers`:** at least 10 answer-eligible words, A–Z, 6–10 letters.
  - **Familiar themes:** words a typical solver knows.
  - **Obscure themes:** words a curious solver half-knows. The goal is obscure but not esoteric. Example for Italian wine varieties: BAROLO, CHIANTI, PROSECCO, BARBERA, NEBBIOLO, SANGIOVESE.
- **`recognized`:** broad on-theme vocabulary that isn't in `answers`. Aim for 25 or more words, including **at least 10 words of 4–5 letters** as stepping-stone candidates. Also include **every well-known 6+ letter category member not in `answers`**. These are what the long-decoy check guards against, so completeness at the familiar end matters.
- **`familiar`:** joined multi-word answers that aren't in the frequency corpus, listed as overrides.
- **Spangram:** names the theme, A–Z joined, 6–14 letters.
- **Clue:** short, slightly oblique and fair.
- **Nesting rule:** see Global Constraints. Drop any word that violates it (for example, don't put GULL in a theme with SEAGULL as an answer).
- No word may appear in more than one theme's `answers`.
- **Mix:**
  - Everyday categories: gems, currencies, birds, pasta, instruments, weather, spices, dances, dog breeds, cocktails, fabrics, cheeses, sports, tools and so on.
  - Obscure-but-not-esoteric ones: Italian wine varieties, rare birds, cloud types, heraldry terms, fencing terms, sailing knots, typefaces, French pastries, southern-sky constellations and so on.
  - No NYT content.

**Tests (`tests/content.test.js`):**
- every file parses, and `id` matches the filename;
- every field matches its format and length rules;
- at least 10 recognized words of 4–5 letters per theme;
- no duplicates within a theme, or between `answers`, `recognized` and the spangram;
- the nesting rule holds;
- no word appears in two themes' `answers`;
- at least 55 themes, with between 9 and 14 obscure.

- [ ] Write the themes and the test, then `npm test`. Commit `content: themes for the first curated drop`.

---

### Task 5: Build CLI and the first drop

**Files:**
- Create `tools/build-drop.mjs`, `drops/index.json`, `drops/2026-10.json`, `drops/2026-10.meta.json` and `tests/drops.test.js`.
- Add `"build:drop": "node tools/build-drop.mjs"` to the scripts in `package.json`.

**CLI:** `node tools/build-drop.mjs --id 2026-10 --start 2026-10-09 [--count 50] [--attempts 2000] [--seconds 60]`

**Per theme** (sorted by id; RNG `mulberry32(hashString(themeId + ':' + dropId))`):
1. Skip any theme already used in an existing drop listed in `drops/index.json`, other than the drop being rebuilt.
2. Run `eligibleAnswers(theme, ranks)`. Skip the theme and report it if it has fewer than 4 eligible words.
3. Build a candidate pool for each attempt:
   - Sort eligible words by length descending, breaking ties randomly.
   - Rotate the pool's start index by the attempt number (mod pool size) so different subsets come up.
   - Call `chooseWords({ spangram, words: pool }, rand, { minCount: 5, maxCount: 7, shuffle: false })`. On null, retry with `minCount: 4`.
4. Run `layoutWords`. For each of its `directionVariants`, run `checkPuzzle(variant, { answers: theme.answers, recognized: theme.recognized })` and keep the ones that pass.
5. **Stopping rule (deterministic):** stop after `--attempts` layouts or 200 passing candidates. `--seconds` is a safety cap only, and if it's hit the report says so.
6. Keep the passing candidate with the highest `difficulty`.

**Selection:**
- From the successful themes, take up to 10 obscure ones by highest difficulty, then fill to `--count` with familiar ones by highest difficulty.
- If fewer than `--count` succeed, fail loudly and list each failure reason.
- List unused successes as spares.
- Then run `assembleDrop`.

**Outputs:**
- **`drops/<id>.json`:** `{ id, puzzles, schedule, library }`, where each puzzle is `{ id, themeId, clue, obscure, grid, answers, steppingStones, difficulty }`, with difficulty rounded to 2 decimal places.
- **`drops/<id>.meta.json`:** for each puzzle id, `{ checkedLong: [...], recognizedShort: [...] }`. This is a snapshot of the theme words the checks used, so later edits to a theme file can't break validation of a shipped drop.
- **`drops/index.json`:** the sorted, unique drop ids.
- **Report (stdout):**
  - For each puzzle: its id, daily date or LIBRARY, theme, answers, stepping stones and difficulty.
  - **For each puzzle, any 6+ letter word from `data/words.txt` that can be traced and isn't an answer.** The controller reviews these. On-theme ones get added to `recognized` and the theme is rebuilt.
  - Skipped themes with reasons, familiarity rejections and spares.

**Drop validator (`tests/drops.test.js`).** For every id in `drops/index.json`, load the drop and its meta file, then check:
- `verifyPuzzle` passes;
- `checkPuzzle(puzzle, { answers: [...puzzle answer words, ...meta.checkedLong], recognized: meta.recognizedShort })` is ok, and its `steppingStones` equal the stored list;
- non-spangram answers are 6–10 letters;
- 30 consecutive schedule dates, a library of 20 and an exact partition;
- ids are unique, match `^<dropId>-p\d{2}$` and contain no themeId;
- no more than one obscure daily in any 7 consecutive dates.

- [ ] Write the CLI and validator, then run the build.
- [ ] Iterate on the content. Fix themes that fail the checks, and review the dictionary-decoy report, adding on-theme words to `recognized`. Rebuild until 50 puzzles pass and the report looks clean.
- [ ] Run `npm test`. Commit `feat: offline drop builder and first curated drop (2026-10)`, with the report summary (counts and difficulty range) in the commit body.

---

### Task 6: Runtime drop access and game rules

**Files:**
- Create `js/drops.js` and `tests/runtime-drops.test.js`.
- Modify `js/game.js`, `tests/game.test.js`, `js/share.js`, `tests/share.test.js`, `js/storage.js` and `tests/storage.test.js`.

**`js/drops.js`:**
- **`loadDrops(fetchImpl = fetch)`:** fetches `drops/index.json`, then each `drops/<id>.json` (relative URLs, not the meta files). Returns the drops in index order.
- **Release order:** released puzzles across drops are ordered by index order, then by `drop.puzzles` order. The fallback below relies on this fixed order.
- **`isReleased(drops, id, today)`:**
  - A scheduled puzzle is released when its date ≤ today.
  - A library puzzle is released when today ≥ its drop's earliest schedule date.
- **`dailyFor(drops, today)`:** uses the latest drop with `schedule[today]`. Otherwise it picks `released[hashString('daily-' + today) % released.length]`, using `hashString` from `js/rng.js`.
- **`getPuzzle(drops, id)`:** returns the puzzle, or null.
- **`randomPuzzle(drops, today, { played, solved, excludeId }, rand = Math.random)`:**
  - The candidates are released puzzles, excluding today's daily and `excludeId`.
  - Pick uniformly from the first non-empty tier: not in `played`; in `played` but not in `solved`; all candidates.
  - Return null only when there are no candidates.

**`js/game.js`:**
- **`newGameState`:** **remove `seed`**, and add `stonesFound: []` and `bankedHints: 0`. Update the `deepEqual` test.
- **`submitWord` order:**
  1. answer branches (unchanged);
  2. too-short;
  3. **stepping stone:** if `puzzle.steppingStones?.includes(word)`, it's `already-found` when it's in `stonesFound`; otherwise push it, add 1 to `bankedHints`, log `'P'` and return `{ type: 'stepping-stone', word }`;
  4. bonus-word checks (unchanged).
- **`canHint`:** `!completed && activeHint?.level !== 2 && (bankedHints > 0 || hintMeter >= HINT_COST)`.
- **`useHint`:** spend a banked hint first (subtract 1 from `bankedHints` and leave the meter alone). Otherwise reset the meter as now.
- **`availableHints(state)`:** returns `bankedHints + (hintMeter >= HINT_COST ? 1 : 0)`.

**`js/share.js`:** add `P: '🪶'`.

**`js/storage.js`:**
- `markPlayed(id, store?)` and `markSolved(id, store?)`.
- `loadPlayed(store?)` and `loadSolved(store?)`, each returning a `Set`.
- Each list is stored as an array capped at its 500 most recent entries.

**Tests:**
- **Runtime drops.** Use two fixture drops: an earlier drop that's fully released, and a later drop whose schedule starts in the future. Cover:
  - the daily coming from the schedule;
  - the hash fallback, which is deterministic;
  - future dailies and the future drop's library being unreleased and never returned by `randomPuzzle`;
  - today's daily and `excludeId` being excluded;
  - the tier order (unplayed, then unsolved, then all);
  - null for an unknown id in `getPuzzle`.
- **Game.** Cover:
  - a stone banking a hint once, and `already-found` on repeat;
  - the stone check winning over a dictionary word;
  - `canHint` with a banked hint and an empty meter;
  - `useHint` spending a banked hint first;
  - `availableHints`;
  - the new state shape.
- **Share:** 🪶 appears in the output.
- **Storage:** played and solved round-trip, plus the caps.

- [ ] RED → GREEN for each module → `npm test`. Commit `feat: runtime drops, stepping stones and banked hints`.

---

### Task 7: Wire the app to drops

**Files:** modify `js/main.js`, `index.html`, `css/style.css` (minimal), `README.md` and `package.json` (description). Delete `js/generator.js` and `data/themes.json`.

**Startup and routing:**
- Call `loadDrops()`. On failure, show the existing fatal/Retry screen.
- Today is `dateKey()`.
- **`?id=<id>`:** if the puzzle exists and is released, play it. It counts as the daily if it is today's daily. Otherwise clean the URL and load the daily.
- **`startPuzzle(puzzle)`:**
  - Progress is keyed by `puzzle.id`. Saved state is discarded unless `state.puzzleId === puzzle.id && state.themeId === puzzle.themeId`.
  - Old-format keys (`daily-…`, `seed-…`) never match, so old progress is ignored.
  - `isDaily = dailyFor(drops, today).id === puzzle.id`.
  - The streak date is today when the solved puzzle is the daily.

**Labels and messages:**
- The theme label is "TODAY'S THEME" for the daily and "PUZZLE" otherwise. Append " · DEEP CUT" when `obscure`, including on the daily.
- **"New puzzle":** call `randomPuzzle(drops, today, { played: loadPlayed(), solved: loadSolved(), excludeId: current.id })`, then set the URL to `?id=<id>`. If it returns null, show "That's every puzzle for now. New ones arrive with the next drop!".
- **Play tracking:**
  - On the first submission of any word in a puzzle, call `markPlayed(id)`.
  - On completion, call `markSolved(id)`. (`applyStart` stats behaviour is unchanged.)
- **"Play today's daily":** loads `dailyFor(drops, today)`.
- **Stepping-stone message:** `On theme: ${word}. +1 hint`.
- **Hint button:** reads "Hint" or "Hint ×N", using `availableHints`.
- **Share:**
  - The label is the date for the daily, otherwise the puzzle id.
  - Non-daily share URLs are `${playUrl()}?id=<id>`.
- **Date rollover:** recompute the daily with `dailyFor`.

**Help text and docs:**
- In the help dialog, replace the bonus-word bullet with: "Spot a shorter word that fits the theme (like CROW for birds)? That's a stepping stone, and it earns you a free hint. Other words of 4+ letters fill the hint meter."
- In the help dialog, replace the last bullet with: "Everyone gets the same puzzle first each day. After that, press New puzzle to play on through this month's collection."
- Update the meta description in `index.html` and `package.json` to drop the word "unlimited".
- **README:**
  - Content lives in `content/themes/`.
  - Build with `npm run build:drop -- --id YYYY-MM --start YYYY-MM-DD`. Drops are committed.
  - The next drop must start the day after the previous drop's last daily (for 2026-10, that's 2026-11-08). Otherwise the date-hash fallback is used.
  - Links use `?id=`.
- Remove all runtime use of the generator and themes.json.

- [ ] Implement, run `node --check` on the js files and run `npm test`. Commit `feat: play curated drops in the app`. The controller does the browser verification.

---

### Task 8: Release prep

- Rebuild `dist/unstranded-itch.zip` from `index.html css js data drops`. `dist/` is git-ignored. (The meta files ship too, which is harmless.)
- Run a final whole-branch review on the most capable model and fix its findings.
- Merge to `main` locally after the tests pass. The user pushes.
