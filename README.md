# UnStranded

An unlimited Strands-style word search that runs entirely in the browser.

- **Daily puzzle:** the first puzzle each day is the same for everyone.
- **Unlimited puzzles:** press **New puzzle** for a fresh board. Every board has a link (`?p=<seed>`) you can share.
- Works on phones and desktops. No accounts, no tracking. Progress and stats are stored in your browser.

## Play locally

ES modules need to be served over HTTP (opening `index.html` directly won't work):

    npm run serve

Then open http://localhost:8080.

## Tests

    npm test

Uses Node 22+'s built-in test runner. No dependencies to install.

## Adding themes

Edit `data/themes.json`. Each theme needs:

- `id`: unique, lowercase
- `clue`: the hint shown above the grid
- `spangram`: 6–14 letters, A–Z only (join multiple words: `PIZZATOPPINGS`)
- `words`: at least 10 words, 4–9 letters each, A–Z only

Run `npm test` afterwards. The theme tests check that every theme can fill the 48-letter board.

Note: changing `themes.json` changes which board a given seed or date produces.

## Deploy

**GitHub Pages:** push the repository, then in *Settings → Pages* choose "Deploy from a branch", branch `main`, folder `/ (root)`.

**itch.io:** zip the project folder contents (`index.html` must be at the top level of the zip), create a new project with *Kind of project: HTML*, upload the zip and tick "This file will be played in the browser". A viewport of 420 × 820 works well, and enable "Mobile friendly".

## Credits

- Bonus-word dictionary: [ENABLE](https://github.com/dolph/dictionary) word list (public domain), filtered with the [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) list (CC BY 4.0).
- Theme word pools informed by [dariusk/corpora](https://github.com/dariusk/corpora) (CC0).
- Inspired by *Strands* from The New York Times. UnStranded is an independent fan project and is not affiliated with The New York Times.
