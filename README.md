# Outspell

A browser Scrabble game: you against a greedy AI.

### ▶ [Play it at zamiell.github.io/outspell](https://zamiell.github.io/outspell/)

## Rules

- Standard 15×15 board, tile distribution and letter values.
- **You get 6 tiles; the AI gets the standard 7.** The 50-point bingo needs all 7 tiles in one play, so only the AI can get it.
- **The AI is greedy.** Each turn it finds every legal move against the full dictionary and plays the highest-scoring one. It doesn't look ahead, think about the tiles it keeps, or play defence. If it has no move, it passes.
- Words are checked against **ENABLE** (public domain, 172,823 words). It predates some newer words, so QI and ZA aren't valid.
- The game ends when someone plays out with the bag empty, or after six scoreless turns in a row. Leftover tiles are scored as in standard Scrabble.

## How to play

- **Tap a square, then tap tiles.** An arrow shows where the next tile goes. Each tile you tap lands there and the arrow moves on, skipping tiles already on the board. Tap the arrow to switch between across and down.
- **Or drag tiles** from your rack to the board, with a finger or a mouse. On touch screens the tile floats above your finger so you can see where it'll land.
- **On a keyboard**, click a square and type. Backspace takes the last tile back and Enter plays.
- Tap a placed tile to take it back, or press **Recall** for all of them.
- The status line previews the words and score as you go. Press **Play** when the move is valid.
- **Blanks** ask which letter they should be (typing a letter you don't have uses a blank automatically).
- **Swap** exchanges tiles (only while the bag has at least 7). **Shuffle** reorders your rack. **Pass** skips your turn.
- **Tap "N in bag"** to see the unseen tiles. These are the bag plus the AI's rack combined, since you can't tell which is which.
- **Tap any word in the move list** (or hover with a mouse) for its definition, from [Wiktionary](https://en.wiktionary.org).

**On phones** the whole game fits on one screen. The board zooms in when you start placing tiles and zooms back out when you play; the magnifier button toggles it. The move list is behind the ☰ button.

## Development

```bash
npm install
npm run dev        # starts the dev server and opens the game in your browser
npm test           # unit tests, including AI vs a brute-force search
npm run typecheck
npm run build      # static site in dist/
```

The rack sizes are `HUMAN_RACK_SIZE` and `AI_RACK_SIZE` in `src/game.ts`. To use a different word list, replace `dictionary/enable1.txt` with any file of one word per line.

## Deployment

Every push to `main` runs the tests, builds the site and publishes it to GitHub Pages ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). If the tests fail, nothing is deployed.

## Layout

| Path | Purpose |
| --- | --- |
| `src/tiles.ts` | Letter values, distribution, tile bag |
| `src/board.ts` | 15×15 board and premium squares |
| `src/dictionary.ts` | Trie over the word list |
| `src/rules.ts` | Move validation and scoring, shared by human and AI |
| `src/ai.ts` | Anchor-based move generator (Appel–Jacobson) and greedy best-move pick |
| `src/game.ts` | Turns, racks, exchanges, end-of-game scoring |
| `src/definitions.ts` | Wiktionary definition lookups |
| `src/popover.ts` | Tap-or-hover popovers |
| `src/main.ts`, `src/style.css`, `index.html` | Browser UI |
| `dictionary/enable1.txt` | The ENABLE word list |
| `test/` | Unit tests |

## License

[MIT](LICENSE). The ENABLE word list in `dictionary/` is public domain.
