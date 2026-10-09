# UnStranded

A Strands-style word search with curated monthly puzzle drops that runs entirely in the browser.

- **Daily puzzle:** the first puzzle each day is the same for everyone.
- **More puzzles:** press **New puzzle** to play on through the released puzzles in the current collection. Every puzzle has a link (`?id=<id>`) you can share.
- Works on phones and desktops. No accounts, no tracking. Progress and stats are stored in your browser.

## Play

- **itch.io:** https://dalecook.itch.io/unstranded
- **Web:** https://dalecook.github.io/unstranded/

## Play locally

ES modules need to be served over HTTP (opening `index.html` directly won't work):

    npm run serve

Then open http://localhost:8080.

## Tests

    npm test

Uses Node 22+'s built-in test runner. No dependencies to install.

## Adding content

Theme content lives in `content/themes/`. Puzzles are built ahead of time into monthly drop files under `drops/`, and the drops are committed:

    npm run build:drop -- --id YYYY-MM --start YYYY-MM-DD

The next drop must start the day after the previous drop's last daily (for 2026-10, that's 2026-11-07). Otherwise the date-hash fallback is used for the gap.

Run `npm test` afterwards.

## Deploy

**GitHub Pages:** push the repository, then in *Settings → Pages* choose "Deploy from a branch", branch `main`, folder `/ (root)`.

**itch.io:** the game is published at https://dalecook.itch.io/unstranded. Release builds are uploaded there directly and aren't kept in this repository.

## Credits

- Bonus-word dictionary, merged from: [ENABLE](https://github.com/dolph/dictionary) (public domain); the [Wordnik word list](https://github.com/wordnik/wordlist) (MIT licence, (c) Wordnik); [SCOWL / en-wl wordlist](https://github.com/en-wl/wordlist) en_US-large (Copyright 2000-2026 Kevin Atkinson and contributors; permission to use, copy, modify, distribute and sell word lists created from SCOWL is granted without fee provided this copyright notice appears in all copies and supporting documentation; provided "as is" without warranty; full terms in the SCOWL README, https://github.com/en-wl/wordlist, with the affix data under Geoff Kuenning's Ispell BSD licence). Offensive words are removed using a curated blocklist and the [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) list (CC BY 4.0).
- Theme word pools informed by [dariusk/corpora](https://github.com/dariusk/corpora) (CC0).
- Inspired by *Strands* from The New York Times. UnStranded is an independent fan project and is not affiliated with The New York Times.
