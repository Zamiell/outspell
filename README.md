# Scrabble

Outspell emulator: a browser Scrabble game, human vs AI.

- **You get 6 tiles**; the AI gets the standard 7 (see `HUMAN_RACK_SIZE` / `AI_RACK_SIZE` in `src/game.ts`).
- **The AI is greedy.** Each turn it generates every legal move against the full dictionary and plays the highest-scoring one. It doesn't look ahead, consider its rack leave, or play defence. If it has no move, it passes.
- Standard board, tile distribution, letter values and 50-point bingo for using 7 tiles.
- Words are checked against **ENABLE** (`dictionary/enable1.txt`, public domain, 172,823 words). To use a different list, replace that file with one word per line.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

Drag tiles from your rack onto the board (or tap a tile, then a square). The status line previews the words and score as you go; press **Play** (or Enter) when it's valid. Tap a placed tile to take it back. Blanks ask which letter they should be. **Swap** lets you pick tiles to exchange.

Tap (or hover with a mouse) any word in the **Moves** list for its definition, fetched from [Wiktionary](https://en.wiktionary.org). Tap **N in bag** to see the unseen tiles (the bag plus the AI's rack, since you can't tell which is which).

## Layout

| File | Purpose |
| --- | --- |
| `src/tiles.ts` | Letter values, distribution, tile bag |
| `src/board.ts` | 15×15 board and premium squares |
| `src/dictionary.ts` | Trie over the word list in `dictionary/` |
| `src/definitions.ts` | Wiktionary definition lookups |
| `src/popover.ts` | Tap-or-hover popovers |
| `src/rules.ts` | Move validation and scoring, shared by human and AI |
| `src/ai.ts` | Anchor-based move generator (Appel–Jacobson) + greedy best-move pick |
| `src/game.ts` | Turns, racks, exchanges, end-of-game scoring |
| `src/main.ts`, `src/style.css`, `index.html` | Browser UI |

## Test

```bash
npm test
npm run typecheck
```

The tests include a check that the AI's chosen score matches a brute-force search over every word/position.
