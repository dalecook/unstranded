# Daily sets: one shared order, then free play

Status: approved design, 2026-11-05. Replaces monthly drops for scheduling.

## Goal

The players are a small, competitive group. They want to play the same boards in the same order and compare results, and they also want to keep playing without a daily limit.

Today only the first board of the day is shared. After it, New puzzle picks at random and prefers boards this player hasn't seen, so no two players follow the same sequence.

This design gives everyone the same set of 6 boards each day, in the same order. After the set comes unlimited free play. 366 pre-built boards cycle indefinitely, so we no longer build a drop every month.

## Player experience

### The daily set

- From the **start date**, each day has a set of 6 boards. Everyone gets the same 6, in the same order, on the same local date. Each device uses its own local date, as now.
- Opening the game shows board 1 of today's set. Board 1 is the daily: streaks, stats and the share card treat it exactly as they treat today's daily.
- New puzzle serves the next board in today's set that this device hasn't shown yet, in set order.
- While a set board is on screen, the theme card's label shows the position, e.g. "Today 3 of 6".
- A player may skip a board by pressing New puzzle without solving it. A skipped board stays unsolved. The Daily button returns to board 1, and a skipped board can be reopened from its link.

### Free play

- A board counts as shown as soon as it is on screen (the existing "played" meaning). When all 6 set boards have been shown and the player presses New puzzle, that press opens the first free-play board and the message line reads "That's today's 6. Now it's free play." Later presses serve free play without the message.
- Free play has no limit. New puzzle picks at random from the free-play pool, preferring boards this device has never shown, then shown but unsolved, then any. These are today's tiers in `randomPuzzle`; only the pool changes.
- The free-play pool is:
  - every board in the October and November drops (all 100, released or not), plus
  - every sequence board,
  - minus any board in today's set or in any set over the next 30 days (today plus the following 29 days).
- So a board played in free play cannot come up in a set for at least 30 days.

### Unchanged

The share card, game rules, hints, stepping stones, the bonus dictionary, stats and streaks.

## Schedule

- **Start date:** a single value in the sequence file, set to the push date as the last step before the user pushes. Changing it needs no rebuild, because the order is defined relative to the start date.
- **Before the start date**, or when the sequence file is missing, the game behaves exactly as it does now: the monthly drop schedule, today's New puzzle logic, and today's release rules.
- **From the start date**, the sequence replaces the drop schedule for the daily and for New puzzle. November dailies that haven't been played yet, and November's library, become free-play boards.
- **Day number** `d = days from the start date to today` (0 on the start date). **Pass** `p = floor(d / 61)`. **Day within the pass** `i = d mod 61`. Today's set is positions `6i` to `6i + 5` of pass `p`'s order.
- **Pass 0** uses the order stored in the file.
- **Pass p ≥ 1** uses a deterministic seeded shuffle of the 366 boards (seed from `hashString('pass-' + p)` with `mulberry32`). It must satisfy:
  - every board appears exactly once;
  - each day's set has at most one obscure board;
  - no board from the last 14 days (84 boards) of pass `p - 1` appears in the first 14 days of pass `p`.

  The shuffle is pure integer arithmetic, so every device computes the same order.

## Board content

- **Boards:** 366 (61 days × 6), one board per theme, so within a pass each theme appears once.
- **Themes:** chosen from the 395 in `content/themes/`. Themes never used in a drop come first, then themes from the October and November drops. A reused theme gets a different board from its earlier one: as little word overlap as possible and never an identical grid, using the builder's existing reuse rule.
- **Holiday themes** are left out of the sequence: halloween, thanksgiving, christmas, valentines-day, easter. Date-pinned specials can bring them back later; that is out of scope here. Milder seasonal themes stay in.
- **Rules:** every board passes the same rules as drop boards:
  - exactly one non-self-crossing trace per answer;
  - no traceable on-theme non-answer word of 6+ letters;
  - no crossings;
  - no traceable offensive word;
  - 2–5 stepping stones;
  - 4–8 theme words.
- **Pass 0 order:** a seeded shuffle with at most one obscure board per day's set (in the built sequence every day has exactly one, a deliberate "deep cut"), and board sizes and stepping-stone counts spread so no day is all small or all large boards.

## Builder

- **New command:** `npm run build:sequence -- --start YYYY-MM-DD [--out dir]`. It writes `drops/sequence.json`:
  - `start`
  - `setSize` (6)
  - `puzzles` (366, in pass-0 order, same puzzle shape as drop puzzles)
  - plus a meta file like the drop meta, for the validation tests.
- **Engine:** reuses the check-as-you-go generator, the worker-thread search, the familiarity filter, the variety planner and the blocklists.
- **Locked rebuilds:** when `drops/sequence.json` exists, the builder keeps every existing board and its position. It rebuilds only the themes named with `--rebuild <id,...>`, or the themes whose content file changed since their board was built (detected by a content hash stored per board). A rebuilt board takes the same position. The pass-0 order is recomputed only on a full build (`--fresh`).
- The monthly drop builder stays in place but is no longer part of the routine.

## Review process

1. **Full build.** About 30–60 minutes of machine time.
2. **Decoy review.** About 8 editor agents in parallel, each with about 46 boards. Each reads every board's traceable dictionary words and flags on-theme words missing from `recognized`, plus off-theme stepping stones, as SERIOUS or MINOR.
3. **Fixes.** Missed words go into the themes' `recognized` lists. A locked rebuild of only those themes follows, and only the rebuilt boards are re-reviewed.
4. **Repeat** until a round finds no SERIOUS issue. MINOR finds are added to content without a rebuild.

## App changes

- **`drops/sequence.json`:** loaded alongside the drop index. Its absence is not an error.
- **New module `js/sequence.js`** (pure functions):
  - `dayNumber(start, today)`
  - `passOrder(seq, p)`
  - `setFor(seq, today)`
  - `upcomingIds(seq, today, days)`
  - `freePlayPool(drops, seq, today)`
  - `isOpenable(drops, seq, id, today)`
- **`js/drops.js`:**
  - `dailyFor` returns set board 1 when the sequence has started.
  - `randomPuzzle` takes the free-play pool instead of `releasedPuzzles` when the sequence has started.
- **`js/storage.js`:** a set-progress record `{ date, shown: [ids] }` for today's set. It is ignored and replaced when the date differs.
- **`js/main.js`:**
  - **New puzzle:** serves the next unshown set board, then the free-play note, then free play.
  - **Theme label:** shows "Today n of 6" on set boards.
  - **`?id=` links:** a link opens a board only if `isOpenable` allows it: today's set, or a board in the free-play pool. Otherwise it falls back to today's daily. A board from a past set is linkable because it is in the pool, except near a pass seam, where it can come up again in a set within 30 days; then its link falls back too, so a link never shows an upcoming set board early.
  - **Rollover:** behaves as now, and starts a new set at the new date.

## Testing

- **`tests/sequence.test.js`:**
  - day and pass arithmetic: the day before the start, the start, day 60, day 61 (first day of pass 1);
  - pinned set orders for passes 0 and 1;
  - every board once per pass;
  - the seam rule;
  - at most one obscure board per day;
  - the 30-day free-play exclusion;
  - `isOpenable` cases;
  - fallback to drop behaviour before the start date and when the file is missing.
- **Sequence validation** (alongside `tests/drops.test.js`):
  - every board passes the drop-board checks from its meta snapshot;
  - 366 boards;
  - unique themes;
  - no holiday themes;
  - a valid start date.
- **Builder tests:**
  - a locked rebuild changes only the named or changed theme's board, at the same position;
  - the pass-0 order constraints hold;
  - a content-hash change triggers a rebuild of that theme only.
- **Browser test**, with a faked date:
  - play through all 6 and check the label and the free-play note;
  - free-play boards are never in the next 30 days of sets;
  - a link to an upcoming set board falls back to the daily;
  - midnight rollover;
  - the first day of pass 1;
  - the day before the start date behaves as today.

## Out of scope

- Share card changes.
- Holiday specials pinned to dates.
- Leaderboards or any server.
- Hiding future boards from people who read the file. Future boards ship in `sequence.json`, as future dailies already ship in the drop files.
