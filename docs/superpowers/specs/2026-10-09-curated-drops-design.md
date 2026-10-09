# UnStranded — Curated Monthly Drops (Design Spec)

**Date:** 2026-10-09
**Status:** Approved in conversation; the user delegated theme and puzzle selection to the builder.
**Supersedes:** the on-device generator, `data/themes.json` and `?p=<seed>` puzzles from `2026-10-08-unstranded-design.md`. Game rules, UI and storage carry over except where stated.

## Why

On-device generation (milliseconds per board, thin 12-word lists) forced compromises: ambiguous traces, unintended on-theme words, short easy answers. Word-puzzle people want **complexity that is always solvable**: hard but fair, never ambiguous. Puzzles are therefore built and verified **offline**, where each one can be checked exhaustively, and shipped as curated **monthly drops**. Quality over quantity: 50 great puzzles beat 1,000 average ones, and a fresh drop each month keeps players coming back.

## Experience principles

1. **Hard but fair.** Answers are long, familiar words (6+ letters). Difficulty comes from length, twisting paths, the spangram and an oblique clue, never from ambiguity.
2. **Exactly one solution.** Every answer has exactly one trace on the board, and the board has exactly one complete solution.
3. **Theme thinking is rewarded.** Short on-theme words that are not answers (CROW in a birds puzzle) are **stepping stones**: finding one banks a free hint.
4. **Obscure but not esoteric.** Most themes are familiar (gems, currencies); some are obscure (Italian wine varieties, rare birds). In an obscure theme the solver should know some words and reach the rest through the clue and stepping stones.

## Content model

### Theme source files (`content/themes/*.json`, one file per theme)

```json
{
  "id": "rare-birds",
  "clue": "Twitchers' trophies",
  "spangram": "RAREBIRDS",
  "obscure": true,
  "answers": ["KAKAPO", "QUETZAL", "HOATZIN", "SHOEBILL", "..."],
  "recognized": ["KIWI", "RHEA", "IBIS", "KEA", "..."],
  "familiar": ["KAKAPO"]
}
```

- `spangram`: A–Z, 6–14 letters, multi-word phrases joined.
- `answers`: answer-eligible words. A–Z, **6–10 letters**, at least 8 per theme so the builder has choices.
- `recognized`: every other reasonable on-theme word (any length ≥ 4). These become stepping stones when they are under 6 letters.
- `familiar`: editorial overrides that mark answer words as familiar despite a low corpus frequency (familiarity option C).
- **Familiarity:** an answer word is eligible if its rank in the frequency list (Norvig `count_1w.txt`, downloaded at build time and never shipped) is within the cutoff, or if it is listed in `familiar`. Obscure themes use a looser cutoff. Words that fail are reported, not silently dropped.

### Drop file (`drops/<drop-id>.json`, built output, committed and shipped)

```json
{
  "id": "2026-10",
  "puzzles": [
    {
      "id": "2026-10-p01",
      "themeId": "gemstones",
      "clue": "Jewel box",
      "obscure": false,
      "grid": ["R", "U", "..."],
      "answers": [{ "word": "GEMSTONES", "path": [0, 6], "isSpangram": true }],
      "steppingStones": ["RUBY", "OPAL", "JADE"],
      "difficulty": 0.62
    }
  ],
  "schedule": { "2026-10-09": "2026-10-p01" },
  "library": ["2026-10-p31"]
}
```

- `schedule` maps each date to that day's shared daily. `library` lists puzzles that are never a daily. Every puzzle is in exactly one of them.
- `drops/index.json` lists drop ids in release order. The game loads the latest drop and any earlier drops it needs.

## Offline build pipeline (`tools/build-drop.mjs`)

For each theme:

1. Choose answers from the eligible list (6–10 letters), favouring longer words, with lengths plus the spangram summing to 48.
2. Generate candidate layouts with the existing backtracking generator, now `tools/lib/layout.js`.
3. **Hard checks.** A candidate is rejected unless:
   - each answer has exactly one trace on the full grid;
   - the board has exactly one complete solution (one way to split the 48 cells into the answers);
   - no on-theme word of **6+ letters** that is not a chosen answer can be traced (this covers unused `answers` entries and long `recognized` words);
   - the number of traceable stepping stones (`recognized` words of 4–5 letters) is **between 2 and 5**.
4. **Score** the survivors. Difficulty is a weighted mix of mean answer length, path bendiness (direction changes per step), spangram length and the obscure flag. Keep the best-scoring candidate. The aim is "hard", and the hard checks keep it fair.
5. Stop after a time or attempt budget and report themes that produced nothing.

Drop assembly:

- 50 puzzles: 30 scheduled dailies from the drop start date, 20 library-only.
- About 40 familiar and 10 obscure themes. Obscure dailies are spread out at no more than one per week, preferably on weekends.
- The script writes `drops/<id>.json`, updates `drops/index.json` and prints a review report for each puzzle: answers, stepping stones, difficulty and any warnings.

## Game changes

### Puzzle source

- The runtime no longer generates puzzles. `js/generator.js` moves to `tools/lib/layout.js` (build-time only), and `data/themes.json` is retired.
- `js/drops.js` loads `drops/index.json` and the needed drop files, and exposes `dailyFor(date)`, `getPuzzle(id)` and `randomUnplayed(today, playedIds)`.

### Daily and random play

- **Daily:** today's daily comes from the schedule of the latest drop that has an entry for today. If no drop covers today, the daily is a deterministic pick (by date hash) from all released puzzles. Every player's first puzzle each day is the same.
- **Random ("New puzzle"):** a random puzzle the player has not yet played, drawn from library puzzles plus dailies whose date has passed. **Future dailies are held out.** When everything is played, the pool falls back to unsolved puzzles, then to all puzzles; volume is a later problem.
- **Links:** `?id=<puzzle-id>` replaces `?p=<seed>`. An unknown or not-yet-released id falls back to today's daily. A future daily cannot be opened early via `?id=`.

### Answers and words

- Answers are matched by spelling. Each answer has exactly one trace by construction, so the "accept any trace, lock official cells" code stays correct and simple.
- Auto-submit keeps its current behaviour.
- **Stepping stones:** when a submitted word is in the puzzle's `steppingStones` list, the game shows "On theme: CROW", banks **one free hint**, and records the word so it pays out once. Nothing locks. Share emoji: 🪶.
- **Hints:** `bankedHints` (from stepping stones) are spent before the meter. The Hint button shows "Hint ×N" when more than one is available. The bonus-word meter (3 dictionary words = 1 hint) is unchanged.

### Storage and stats

- Progress is keyed by puzzle id. A `played` index records ids started or solved, for `randomUnplayed`.
- Streaks are keyed to the scheduled daily's date, as now.
- Saved progress from the old seed-based format is ignored.

### Unchanged

Grid size, selection (drag, tap and auto-submit), rendering, dark mode, dialogs, bonus dictionary, share flow (now with 🪶), help text (updated for stepping stones) and hosting.

## Testing

- **Pipeline:** unit tests for trace counting, solution counting, stepping-stone detection, familiarity filtering and scoring.
- **Drop validator** (`tests/drops.test.js`, runs against every committed drop file):
  - every puzzle passes every hard check again;
  - the schedule has no gaps and the hold-out split is exact;
  - ids are unique and paths match the grid.
- **Game:** stepping stones bank one hint once; banked hints are spent first; daily selection; held-out dailies never appear in random play; `?id=` gating.
- **Manual:** play several puzzles on desktop and in mobile emulation.

## Out of scope (for now)

Volume beyond one drop, server-side anything, accounts, puzzle editor UI, adjusting difficulty from player data.
