# Curated Monthly Drops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace on-device puzzle generation with an offline build pipeline that produces a verified, curated monthly drop of 50 puzzles, which the game loads, with a shared daily, hold-out of future dailies, random unplayed library play and stepping-stone hints.

**Architecture:** Build-time code lives in `tools/` (Node only): layout generator, hard quality checks, familiarity filter, drop builder. Content lives in `content/themes/*.json`. Build output `drops/*.json` is committed and shipped. Runtime (`js/`) loads drops through a new pure module `js/drops.js`; game logic gains stepping stones and banked hints.

**Tech Stack:** Plain ES modules, Node 22 `node --test`, no dependencies. Frequency data: Norvig `count_1w.txt` (downloaded at build time to a git-ignored cache, never shipped).

**Spec:** `docs/superpowers/specs/2026-10-09-curated-drops-design.md`

## Global Constraints

- Grid 6×8 = 48 cells, index `row*6+col`, 8-direction adjacency (`js/grid.js`, unchanged).
- Answers: A–Z, **6–10 letters**. Spangram: A–Z, 6–14 letters. Stepping stones: `recognized` words of **4–5 letters**.
- Hard checks (every shipped puzzle): each answer has **exactly one trace** on the full grid; **no on-theme word of 6+ letters** other than a chosen answer is traceable; **2–5 stepping stones** traceable; full 48-cell coverage, contiguous paths, spangram touches opposite edges.
- Drop: **50 puzzles = 30 scheduled dailies (consecutive dates from the start date) + 20 library-only**; every puzzle in exactly one of `schedule`/`library`; ~10 obscure themes, at most one obscure daily per 7 consecutive days.
- Runtime: future dailies never appear in random play nor open via `?id=`; daily falls back to a deterministic date-hash pick when no schedule covers today.
- Stepping stone found → "On theme: WORD", banks **1 hint**, pays out once, locks nothing, share emoji 🪶. Banked hints spent before the meter.
- No runtime dependencies; no external requests at runtime; all asset paths relative.
- `localStorage` access stays wrapped (existing `js/storage.js` patterns).
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The user pushes manually — never `git push`.

## File Structure

```
tools/lib/layout.js          (moved from js/generator.js) chooseWords/layoutWords/verifyPuzzle — build-time only
tools/lib/checks.js          trace counting, direction variants, hard checks, stepping stones, difficulty
tools/lib/familiarity.js     frequency ranks + eligibility (with injectable rank map)
tools/lib/assemble.js        pure drop assembly: schedule, hold-out, obscure spacing
tools/build-drop.mjs         CLI: content → candidates → best per theme → drop file + report
content/themes/*.json        ~55 theme source files (50 used + spares)
drops/index.json             ["2026-10"]
drops/2026-10.json           first drop (built output, committed)
js/drops.js                  runtime: load drops, dailyFor, getPuzzle, randomUnplayed, canOpen
js/game.js                   + stepping stones, banked hints
js/share.js                  + 🪶 emoji
js/storage.js                + played index
js/main.js                   wiring to drops; remove generator/themes usage
index.html                   help text, labels
tests/layout.test.js         (moved generator tests)
tests/checks.test.js, tests/familiarity.test.js, tests/assemble.test.js
tests/content.test.js        theme source format
tests/drops.test.js          validates every committed drop against every hard check
tests/runtime-drops.test.js  js/drops.js behaviour
```
Retired: `js/generator.js`, `data/themes.json`, `tests/themes.test.js`, `tests/generator.bulk.test.js`, `tests/golden.test.js`, `tests/traces.test.js` (their concerns move to tools/drops tests). `data/words.txt` stays (bonus dictionary).

---

### Task 1: Move the generator to build-time and add quality checks

**Files:** move `js/generator.js` → `tools/lib/layout.js` (git mv; fix import paths to `../../js/grid.js`, `../../js/rng.js`), move `tests/generator.test.js` → `tests/layout.test.js` (fix imports); create `tools/lib/checks.js`, `tests/checks.test.js`. Delete `tests/golden.test.js`, `tests/generator.bulk.test.js`, `tests/traces.test.js`, `tests/themes.test.js` (they depend on runtime generation / old themes). Do NOT touch `js/main.js` yet (it still imports `./generator.js`; Task 7 rewires it) — so keep a temporary copy: leave `js/generator.js` in place until Task 7 (copy, don't move) to keep the app working between tasks. `chooseWords` must accept an options argument `{ minCount, maxCount }` defaulting to current behaviour, and an alternate word list via `chooseWords({ spangram, words }, rand, opts)` (it already reads `theme.spangram`/`theme.words`).

**Interfaces produced (`tools/lib/checks.js`):**
- `countTraces(grid: string[48], word: string, cap = Infinity): number` — number of self-avoiding adjacent paths spelling `word` (stop early at `cap`).
- `isTraceable(grid, word): boolean` — `countTraces(grid, word, 1) > 0`.
- `directionVariants(layout): Iterable<{grid, answers}>` — all 2^k forward/reverse assignments of each answer along its geometric path (answers keep order; `answers[0]` stays the spangram).
- `checkPuzzle(layout, theme): { ok: boolean, reason?: string, steppingStones: string[] }` where `theme = { answers: string[], recognized: string[] }` (answer-eligible pool and recognized list) and `layout.answers` are the chosen answers. Order of checks and `reason` strings: `'invalid'` (verifyPuzzle fails), `'ambiguous'` (any chosen answer with `countTraces(...,2) !== 1`), `'long-decoy'` (any word in `theme.answers ∪ theme.recognized`, length ≥ 6, not chosen, traceable), `'stones'` (stepping-stone count outside 2–5). `steppingStones` = traceable `recognized` words of length 4–5, sorted, excluding chosen answers.
- `difficulty(layout, { obscure }): number` in [0,1]: `0.35*norm(meanAnswerLen, 6..10) + 0.35*bendiness + 0.15*norm(spangramLen, 6..14) + 0.15*(obscure?1:0)`, where bendiness = mean over answers of (direction changes / (len-2)), and `norm(x,a..b)=clamp((x-a)/(b-a),0,1)`.

Reference implementation for the core (adapt names, keep behaviour):
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

**Tests (`tests/checks.test.js`)** — build small hand grids (48 cells, filler `'X'`):
- `countTraces` finds 1 for a unique straight word, 2 when a duplicate letter creates a second route, respects `cap`, 0 when absent; never reuses a cell (e.g. `'ABA'` with a single A → 0).
- `directionVariants` yields 2^k variants; each variant passes `verifyPuzzle`; the all-forward variant equals the input.
- `checkPuzzle` returns each `reason` in turn with a crafted layout (use a real layout from `layoutWords` with a fixture theme for `ok`; craft failures by editing a copy of the grid or by adding a traceable long word to `recognized`), and `steppingStones` lists exactly the traceable 4–5 letter recognized words.
- `difficulty` stays in [0,1], is higher for a longer/bendier fixture than a straight short one, obscure adds 0.15.

- [ ] Step 1: copy/move files as described; run `npm test` — layout tests pass under new path.
- [ ] Step 2: write `tests/checks.test.js` (RED), implement `tools/lib/checks.js` (GREEN).
- [ ] Step 3: `npm test` all pass; commit `feat(tools): build-time layout and quality checks`.

---

### Task 2: Familiarity filter

**Files:** create `tools/lib/familiarity.js`, `tests/familiarity.test.js`; add `.cache/` to `.gitignore`.

**Interfaces:**
- `loadRanks({ cacheDir = '.cache', fetchImpl = fetch } = {}): Promise<Map<string, number>>` — downloads `https://norvig.com/ngrams/count_1w.txt` (follow redirects; tab-separated `word\tcount`, sorted by count desc) to `.cache/count_1w.txt` if missing; returns map UPPERCASE word → 1-based rank. Throws a clear error if download fails and no cache.
- `FAMILIAR_RANK = 60000`, `OBSCURE_RANK = 200000`.
- `isFamiliar(word, ranks, { obscure = false, overrides = [] }): boolean` — true if `overrides` includes word, else rank exists and ≤ cutoff for the theme type.
- `eligibleAnswers(theme, ranks): { eligible: string[], rejected: string[] }` — theme.answers filtered by `isFamiliar` (with `theme.obscure`, `theme.familiar`).

**Tests:** inject a small rank `Map` (no network): cutoff boundary at 60000/200000, overrides win, missing word unfamiliar, `eligibleAnswers` splits correctly. One test for `loadRanks` using a fake `fetchImpl` and a temp `cacheDir` (`node:os` tmpdir) — parses ranks and writes the cache; second call reads cache without fetching.

- [ ] RED → GREEN → `npm test` → commit `feat(tools): familiarity filter from word frequency`.

---

### Task 3: Drop assembly (pure)

**Files:** create `tools/lib/assemble.js`, `tests/assemble.test.js`.

**Interface:** `assembleDrop({ id, startDate: 'YYYY-MM-DD', puzzles, dailies = 30, rand }): { id, puzzles, schedule, library }` where each input puzzle has at least `{ id, obscure, difficulty }`.
- Requires `puzzles.length >= dailies`; throws otherwise.
- Picks `dailies` puzzles for the schedule and the rest go to `library`. Familiar/obscure split for dailies: include obscure puzzles in the schedule such that **no 7 consecutive dates contain more than one obscure daily**, preferring Saturdays/Sundays for obscure ones; remaining obscure puzzles go to library.
- Schedule dates are consecutive from `startDate` (local calendar dates; use `dateKey` from `js/rng.js` on `new Date(y, m-1, d+i)`).
- Within familiar dailies, order to give a gentle weekly rhythm: sort by difficulty and place harder ones later in each 7-day window (simple approach acceptable: shuffle with `rand`, then within each week sort ascending by difficulty).
- Output `puzzles` in schedule order then library order.

**Tests:** 50 fake puzzles (10 obscure): schedule has 30 consecutive dates starting at startDate (cross a month boundary, e.g. start `2026-10-20`); `library` has 20; union = all ids, no overlap; any 7 consecutive scheduled dates contain ≤ 1 obscure; with 0 obscure still valid; throws when fewer puzzles than dailies; deterministic for the same `rand` seed.

- [ ] RED → GREEN → commit `feat(tools): drop assembly with schedule and hold-out`.

---

### Task 4: Theme content (first drop)

**Files:** create `content/themes/<id>.json` — **at least 55 themes** (50 needed + spares for themes that fail the build): about 44 familiar, about 11 obscure. Create `tests/content.test.js`.

**Theme format** (spec §Content model): `{ id, clue, spangram, obscure, answers, recognized, familiar? }`.
- `answers`: ≥ 10 answer-eligible words, A–Z, 6–10 letters, familiar to a typical solver for familiar themes; for obscure themes, words a curious solver may half-know (obscure but not esoteric — e.g. Italian wine varieties: BAROLO, CHIANTI, PROSECCO, BARBERA, NEBBIOLO, SANGIOVESE…).
- `recognized`: broad on-theme vocabulary **not** in `answers` — aim ≥ 25 words including **≥ 10 four/five-letter words** (stepping-stone candidates) and every well-known 6+ letter category member not chosen as an answer (these are what the long-decoy check rejects; completeness at the familiar end matters most).
- Spangram names the theme (A–Z joined, 6–14), not in `answers`/`recognized`.
- Clues: short, a little oblique, fair (they must cover all answers).
- Mix: everyday categories (gems, currencies, birds, pasta, instruments, weather, spices, dances, dog breeds, cocktails, fabrics, cheeses, sports, tools, …) and obscure-but-not-esoteric ones (Italian wine varieties, rare birds, cloud types, heraldry terms, fencing terms, sailing knots, typefaces, French pastries, southern-sky constellations, …). No NYT content.
- No word may appear in more than one theme's `answers`.

**Tests (`tests/content.test.js`):** every file parses; `id` matches filename; formats (regex lengths above); no duplicates within a theme or between answers/recognized/spangram; no word in two themes' `answers`; ≥ 50 themes; between 8 and 14 obscure.

- [ ] Write themes and test → `npm test` → commit `content: themes for the first curated drop`.

---

### Task 5: Build CLI and the first drop

**Files:** create `tools/build-drop.mjs`, `drops/index.json`, `drops/2026-10.json` (output), `tests/drops.test.js`; add `"build:drop": "node tools/build-drop.mjs"` to package.json scripts.

**CLI:** `node tools/build-drop.mjs --id 2026-10 --start 2026-10-09 [--count 50] [--seconds 20]`.
For each theme (sorted by id, seeded RNG from `hashString(id + dropId)` for reproducibility):
1. `eligibleAnswers(theme, ranks)`; skip theme (report) if no subset of eligible fills `48 - spangram.length` with 4–7 answers.
2. Loop until the per-theme time budget: `chooseWords({spangram, words: eligible}, rand, { minCount: 4, maxCount: 7 })` (prefer longer: shuffle then stable-sort pool by length desc with random tie-break before choosing, so long words are tried first but vary), `layoutWords`, then for each `directionVariants` → `checkPuzzle(variant, { answers: theme.answers, recognized: theme.recognized })`; keep passing candidates; stop early after 200 passing candidates.
3. Pick the passing candidate with highest `difficulty`; puzzle id `${dropId}-${themeId}`.
Select 50 puzzles from successful themes (prefer obscure up to 10, fill the rest familiar; if fewer than 50 succeed, fail loudly listing failures). `assembleDrop` with `rand = mulberry32(hashString(dropId))`. Write `drops/<id>.json` (puzzle fields per spec: `id, themeId, clue, obscure, grid, answers, steppingStones, difficulty` rounded to 2 dp) and `drops/index.json` (sorted unique list including id). Print a review report: per puzzle — id, daily date or LIBRARY, answers, stepping stones, difficulty; then skipped themes with reasons and familiarity rejections.

**Drop validator (`tests/drops.test.js`)**, for every id in `drops/index.json`: load the drop and the theme file for each puzzle; assert `verifyPuzzle`; `checkPuzzle(puzzle, theme).ok` and its `steppingStones` equal the stored list; answers 6–10 letters except the spangram; schedule dates consecutive with 30 entries; library 20; partition exact; ids unique; ≤ 1 obscure daily per any 7 consecutive dates.

- [ ] Write CLI + validator; run the build; fix/replace themes that fail until 50 succeed (edit content, re-run); run `npm test`; commit `feat: offline drop builder and first curated drop (2026-10)` with the report summary (counts, difficulty range) in the commit body.

---

### Task 6: Runtime drop access and game rules

**Files:** create `js/drops.js`, `tests/runtime-drops.test.js`; modify `js/game.js`, `tests/game.test.js`, `js/share.js`, `tests/share.test.js`, `js/storage.js`, `tests/storage.test.js`.

**`js/drops.js` (pure functions + one loader):**
- `loadDrops(fetchImpl = fetch): Promise<Drop[]>` — fetch `drops/index.json`, then each `drops/<id>.json` (relative URLs), return in index order.
- `dailyFor(drops, today: 'YYYY-MM-DD'): Puzzle` — latest drop whose `schedule[today]` exists → that puzzle; else deterministic pick `all[hashString('daily-' + today) % all.length]` over released puzzles (all library puzzles + dailies with date ≤ today across drops).
- `getPuzzle(drops, id): Puzzle | null`.
- `isReleased(drops, id, today): boolean` — library puzzles always; scheduled ones only when their date ≤ today.
- `randomUnplayed(drops, today, playedIds: Set<string>, rand = Math.random): Puzzle | null` — uniform among released puzzles not in `playedIds`, excluding today's daily; if none, among released except today's daily; null if none at all.

**`js/game.js` changes:**
- `newGameState` adds `steppingStones: []`, `bankedHints: 0`.
- `submitWord(state, puzzle, path, dictionary)`: after the answer branches and the too-short check, if `puzzle.steppingStones?.includes(word)`: if already in `state.steppingStones` → `already-found`; else push it, `bankedHints + 1`, log `'P'`, result `{ type: 'stepping-stone', word }`. (Stepping stones take precedence over dictionary bonus words.)
- `canHint(state)`: `!completed && activeHint?.level !== 2 && (bankedHints > 0 || hintMeter >= HINT_COST)`.
- `useHint`: spend a banked hint first (`bankedHints - 1`, meter untouched), else reset meter as now.
- Export `availableHints(state) = bankedHints + (hintMeter >= HINT_COST ? 1 : 0)`.
- Keep `completedAnswer`, any-trace answer acceptance and existing results unchanged.

**`js/share.js`:** EMOJI gains `P: '🪶'`.

**`js/storage.js`:** `markPlayed(id, store?)`, `loadPlayed(store?): Set<string>` (stored as array under `played`, capped at 500 most recent).

**Tests:** runtime-drops: fixture drops (two drops, schedule spanning dates, library) — daily from schedule, fallback when no schedule, future dailies excluded from `randomUnplayed` and `isReleased` false, today's daily excluded from random, played excluded until exhausted, `getPuzzle` null for unknown; game: stepping stone banks once / second time already-found / precedence over dictionary / `canHint` with banked hint and empty meter / `useHint` spends banked first / `availableHints`; share: 🪶 in output; storage: played round-trip and cap.

- [ ] RED → GREEN per module → `npm test` → commit `feat: runtime drops, stepping stones and banked hints`.

---

### Task 7: Wire the app to drops

**Files:** modify `js/main.js`, `index.html`, `css/style.css` (minimal), `README.md`; delete `js/generator.js`, `data/themes.json`.

- Startup: `loadDrops()`; on failure show the existing fatal/Retry screen.
- Today = `dateKey()`. `?id=<id>`: if `getPuzzle` and `isReleased(...)` → play it (as the daily if it is today's daily); otherwise clean the URL and load the daily.
- Progress is stored under the puzzle id itself. A puzzle is "the daily" when `dailyFor(drops, today).id === puzzle.id`. The streak date is today when the solved puzzle is today's daily. Saved progress whose `puzzleId`/`themeId` don't match the loaded puzzle is discarded (existing check).
- Label: "TODAY'S PUZZLE" for the daily, otherwise "PUZZLE" + obscure badge text " · DEEP CUT" when `obscure`.
- "New puzzle": `randomUnplayed(drops, today, loadPlayed())`; if null show message "You've played everything — new puzzles arrive soon!"; set URL `?id=<id>`.
- Mark played on first submission of any word in a puzzle (`markPlayed`).
- "Play today's daily" button unchanged in behaviour (now navigates to the daily puzzle).
- Messages: `stepping-stone` → `On theme: ${word} — +1 hint`; hint button text `Hint` / `Hint ×N` from `availableHints`; meter fill unchanged.
- Share label: daily → date; otherwise puzzle id; share URL `${playUrl()}?id=<id>` for non-daily.
- Date rollover handler: recompute daily via `dailyFor`.
- Help dialog: replace the bonus-word bullet with: "Spot shorter words that fit the theme (like CROW for birds)? That's a stepping stone — it earns you a free hint. Other words of 4+ letters fill the hint meter." and change the last bullet to describe daily-then-library play.
- Remove generator/themes.json references; `buildPuzzle` no longer used at runtime.
- README: replace "Adding themes"/seed text with: content in `content/themes/`, build with `npm run build:drop -- --id YYYY-MM --start YYYY-MM-DD`, drops are committed; links use `?id=`.
- Manual check (controller does browser verification).

- [ ] Implement; `node --check` js files; `npm test`; commit `feat: play curated drops in the app`.

---

### Task 8: Release prep

- Rebuild `dist/unstranded-itch.zip` (`index.html css js data drops`) — `dist/` is git-ignored.
- Final whole-branch review (most capable model); fix findings; merge to `main` locally after tests pass; user pushes.
