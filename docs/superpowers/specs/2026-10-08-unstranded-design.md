# UnStranded — Design Spec

**Date:** 2026-10-08
**Status:** Approved design, pending implementation plan

## Goal

A single-page clone of the NYT word game *Strands* that can be played more than once a day. Hostable as static files on GitHub Pages or itch.io. Must work well on mobile browsers as well as desktop.

## Game rules (as implemented)

- 6 columns × 8 rows grid, 48 letters.
- Each puzzle has a theme clue, a set of theme words, and one **spangram** that names the theme and touches two opposite edges of the grid (left↔right or top↔bottom).
- Every letter belongs to exactly one answer; answers never overlap.
- Words are traced through adjacent cells (8 directions); a cell is never reused within a word.
- Finding valid non-theme words (4+ letters) fills a hint meter; 3 bonus words = 1 hint.
- No failure state; the puzzle ends when every answer is found.

## Puzzle modes

- **Daily:** the first puzzle shown each day. Seed derived from the player's local date (`YYYY-MM-DD`), so everyone gets the same puzzle that day (given the same `themes.json`).
- **Random:** every subsequent puzzle gets a fresh random seed. The seed is put in the URL as `?p=<seed>` so a specific puzzle can be shared.
- A puzzle is fully determined by `(seed)` → theme choice + word subset + layout.

## Content sources

- **Themes (`data/themes.json`):** ~100 hand-curated themes. Word pools are drawn from the CC0 [dariusk/corpora](https://github.com/dariusk/corpora) category lists where useful; clues and spangrams are written by hand. Format:
  ```json
  { "id": "kitchen-drawer", "clue": "Kitchen drawer", "spangram": "UTENSILS",
    "words": ["WHISK", "LADLE", "TONGS", "SPATULA", "GRATER", "PEELER", "SCOOP", "MASHER"] }
  ```
  Words are uppercase A–Z only (no spaces/hyphens; multi-word spangrams are written joined, e.g. `PIZZATOPPINGS`). Each pool should contain enough words of length 4–8 to make many subsets summing to 48 with the spangram.
- **Bonus dictionary (`data/words.txt`):** an open word list (ENABLE, public domain, or SCOWL), filtered to 4+ letters, a–z only, with a profanity filter applied. Lazy-loaded after the grid renders.
- NYT puzzle content is **not** used.

## Architecture

Plain HTML/CSS/JavaScript ES modules. No build step, no runtime dependencies.

```
index.html          page shell, mobile viewport, layout
css/style.css       responsive styles, light/dark via CSS variables
js/main.js          bootstraps app, wires modules together
js/rng.js           seeded PRNG + date→seed / string→seed hashing
js/generator.js     theme + seed → { grid, answers[{word, path, isSpangram}] }
js/game.js          game state transitions: submit, hints, bonus words, win
js/input.js         pointer/tap selection on the grid → candidate path
js/render.js        draws grid, highlights, connecting lines, messages
js/storage.js       localStorage: stats, streak, per-puzzle progress
js/share.js         emoji summary; navigator.share or clipboard fallback
data/themes.json
data/words.txt
tests/*.test.js     node --test, no dependencies
```

`rng.js`, `generator.js` and `game.js` are pure (no DOM) and testable in Node. Only `input.js` and `render.js` touch the DOM. All asset paths are relative so the game works under subpaths on both hosts.

## Generator

**Input:** theme, seed. **Output:** grid of 48 letters plus a path (ordered cell list) for each answer.

1. **Choose theme:** for daily/random puzzles the theme is picked from `themes.json` by the seeded RNG.
2. **Choose words:** shuffle the pool with the seeded RNG and find a subset whose total length plus the spangram length equals exactly 48, preferring 6–8 total answers (including the spangram). If no subset exists for this seed, derive the next seed and retry.
3. **Place spangram first:** random self-avoiding path through adjacent cells that touches two opposite edges (columns 0 and 5, or rows 0 and 7). Orientation is chosen based on what the spangram's length permits.
4. **Fill remaining words by backtracking:** each next word's path starts at the first empty cell in reading order. After each placement, prune:
   - **Region check:** every connected empty region's size must be expressible as a sum of a subset of the remaining word lengths (e.g. an isolated single cell is a dead end).
   - **Attempt cap:** if the search exceeds a fixed step budget, derive the next seed (deterministically) and restart. Daily puzzles remain identical for all players.
5. **Verify:** all 48 cells used exactly once, every path contiguous and self-avoiding, spangram touches opposite edges. Only verified puzzles are returned.

**Path matching:** a theme word is only accepted when traced along its *intended* path. Accepting alternate paths could consume cells belonging to other answers and break full coverage.

**Performance target:** < 100 ms per puzzle on a mid-range phone; verified by a test that generates thousands of seeds.

## Gameplay

### Selection (`input.js`)
Uses Pointer Events (mouse, touch, pen via one code path). The grid has `touch-action: none` to prevent scroll/zoom while dragging.

- **Drag:** press on a letter, drag through adjacent letters. Moving back onto the previous cell undoes the last step. Releasing submits.
- **Tap:** tap a letter to start; each further tap must be adjacent to the last selected letter. Tapping the last letter again submits. Tapping a non-adjacent letter starts a new selection from that letter.
- Cells in already-found answers can't be selected.
- The in-progress word is shown above the grid.

### Submission outcomes (`game.js`)
1. **Theme word on its intended path** → locked in: blue tiles (yellow for spangram) and a connecting line.
2. **Theme word on a different path** → message "Right word, wrong spot!"; nothing locked.
3. **Valid dictionary word, 4+ letters, not a theme word, not already found** → added to bonus words; hint meter +1 (of 3).
4. **Already-found bonus word** → message "Already found".
5. **Too short or not a word** → shake + message ("Too short" / "Not in word list").

### Hints
- Hint button enabled when the meter is full (3 bonus words). Using a hint empties the meter.
- First use highlights the letters of one unfound theme word (outlined, order hidden).
- Using another hint while that word is still unfound reveals the letter order.
- The spangram is never the hinted word unless it is the only one left.

### Win
All answers found → results panel: found order, hints used, Share button, New puzzle button.

### State
```js
{ puzzleId,        // "daily-YYYY-MM-DD" or "seed-<n>"
  seed, themeId,
  found: [{ word, order }],
  bonusWords: [],
  hintsUsed, hintMeter, activeHint,   // activeHint: { word, level: 1|2 } | null
  startedAt, completed }
```
Saved to `localStorage` after every state change, keyed by `puzzleId`, so progress resumes after refresh. Old per-puzzle entries beyond the most recent ~30 are pruned.

### Stats
Puzzles played, puzzles completed, current daily streak, best daily streak (consecutive days on which the daily puzzle was completed), average hints per completed puzzle. Stored in `localStorage`.

## UI

Phone-first single column, centred on desktop:

1. **Header:** "UnStranded", stats icon, help icon.
2. **Theme card:** "TODAY'S THEME" (daily) or "PUZZLE #<seed>" (random), followed by the clue.
3. **Current word / feedback line.**
4. **Grid:** 6×8 round letter tiles; width `min(92vw, 420px)`; found answers joined by connecting lines (blue theme, yellow spangram).
5. **Progress:** "3 of 7 theme words found".
6. **Buttons:** Hint (with meter fill), New puzzle, Share (after completion).

- Viewport meta set; no double-tap zoom; the theme card, grid and buttons fit without scrolling on a typical phone.
- System font stack (no external requests). Colours as CSS variables with automatic dark mode.
- "How to play" overlay shown on first visit, reopenable from the help icon.

### Daily vs random flow
- Page load with no `?p=` → today's daily puzzle (resumed if in progress). If already completed, show its result plus "Play another".
- `?p=<seed>` → that random puzzle.
- New puzzle → generate random seed, update URL with `history.replaceState`, start fresh. Each puzzle's progress is saved independently.

## Sharing (`share.js`)

```
UnStranded #2026-10-08
"Kitchen drawer"
🔵🔵💡🔵
🟡🔵🔵
```
One emoji per found answer in found order (🔵 theme, 🟡 spangram), 💡 inserted for each hint used at the point it was used; wrapped at 4 per line. Random puzzles include the `?p=` URL. Uses `navigator.share` when available, otherwise copies to clipboard with a "Copied!" toast.

## Error handling

- `themes.json` fails to load → full-page message with a Retry button.
- `words.txt` fails to load → game remains playable; bonus-word checks disabled and a small notice explains hints are unavailable.
- Generator exhausts its retry budget for a seed (should not happen; guarded by tests) → fall back to the next theme for that seed, deterministically.
- `localStorage` unavailable (private mode / blocked) → all reads/writes wrapped in try/catch; game plays without persistence.
- Invalid `?p=` value → ignore it and load the daily puzzle.

## Testing

Node's built-in runner (`node --test`), no dependencies:

- **rng:** same seed → same sequence; date→seed mapping stable.
- **generator:** for 5,000 seeds: 48 cells each used once, paths contiguous and self-avoiding, spangram touches opposite edges, letters match words; report average/max generation time.
- **themes:** every theme yields at least one valid word subset; words A–Z only; spangram can span the grid; no duplicate words within a theme.
- **game:** each submission outcome, hint meter and hint levels, win detection.
- **Manual:** play-through on desktop and a mobile emulator/device before release.

## Deployment

- **GitHub Pages:** serve repository root.
- **itch.io:** zip the project folder, upload as an HTML game.

## Out of scope (v1)

Accounts / cross-device sync, leaderboards, theme editor UI, sound, timed modes.
