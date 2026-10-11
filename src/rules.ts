import { type Board, type Tile, CENTER, PREMIUMS, BOARD_SIZE, inBounds, isBoardEmpty } from './board.ts';
import type { Dictionary } from './dictionary.ts';
import { LETTER_VALUES } from './tiles.ts';

export type Direction = 'across' | 'down';

export interface Placement extends Tile {
  row: number;
  col: number;
}

export interface FormedWord {
  word: string;
  score: number;
}

export interface ScoredMove {
  placements: Placement[];
  direction: Direction;
  /** The word along the line of play first, then any cross-words. */
  words: FormedWord[];
  score: number;
  bingo: boolean;
}

export type Evaluation = { ok: true; move: ScoredMove } | { ok: false; error: string };

export const BINGO_TILES = 7;
export const BINGO_BONUS = 50;

const key = (row: number, col: number) => row * BOARD_SIZE + col;

/**
 * Validates a set of newly placed tiles against the board and dictionary and
 * scores it. Shared by the human and the AI so both play by identical rules.
 * Does not check the player's rack.
 */
export function evaluateMove(board: Board, placements: readonly Placement[], dict: Dictionary): Evaluation {
  if (placements.length === 0) return { ok: false, error: 'No tiles placed.' };

  const placed = new Map<number, Placement>();
  for (const p of placements) {
    if (!inBounds(p.row, p.col)) return { ok: false, error: 'Tile is off the board.' };
    if (board[p.row][p.col]) return { ok: false, error: 'That square is already taken.' };
    if (placed.has(key(p.row, p.col))) return { ok: false, error: 'Two tiles on one square.' };
    placed.set(key(p.row, p.col), p);
  }

  const rows = new Set(placements.map((p) => p.row));
  const cols = new Set(placements.map((p) => p.col));
  let direction: Direction;
  if (rows.size === 1) direction = 'across';
  else if (cols.size === 1) direction = 'down';
  else return { ok: false, error: 'Tiles must be in a single row or column.' };

  const at = (r: number, c: number): Tile | null =>
    inBounds(r, c) ? (placed.get(key(r, c)) ?? board[r][c]) : null;
  const [dr, dc] = direction === 'across' ? [0, 1] : [1, 0];

  const sorted = [...placements].sort((a, b) => a.row - b.row || a.col - b.col);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  for (let r = first.row, c = first.col; r <= last.row && c <= last.col; r += dr, c += dc) {
    if (!at(r, c)) return { ok: false, error: 'Tiles must form one continuous line.' };
  }

  if (isBoardEmpty(board)) {
    if (!placed.has(key(CENTER, CENTER))) return { ok: false, error: 'The first word must cover the centre square.' };
  } else {
    const touches = placements.some((p) =>
      [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([or, oc]) => inBounds(p.row + or, p.col + oc) && board[p.row + or][p.col + oc]),
    );
    if (!touches) return { ok: false, error: 'Your word must connect to tiles already on the board.' };
  }

  const readWord = (row: number, col: number, wr: number, wc: number): FormedWord => {
    while (at(row - wr, col - wc)) {
      row -= wr;
      col -= wc;
    }
    let word = '';
    let sum = 0;
    let multiplier = 1;
    for (let tile = at(row, col); tile; row += wr, col += wc, tile = at(row, col)) {
      word += tile.letter;
      let value = tile.blank ? 0 : LETTER_VALUES[tile.letter];
      if (placed.has(key(row, col))) {
        const premium = PREMIUMS[row][col];
        if (premium === 'DL') value *= 2;
        else if (premium === 'TL') value *= 3;
        else if (premium === 'DW') multiplier *= 2;
        else if (premium === 'TW') multiplier *= 3;
      }
      sum += value;
    }
    return { word, score: sum * multiplier };
  };

  const words: FormedWord[] = [];
  const main = readWord(first.row, first.col, dr, dc);
  if (main.word.length >= 2) words.push(main);
  // A lone tile that only forms a vertical word is really a "down" play.
  else if (placements.length === 1) direction = 'down';
  for (const p of sorted) {
    const cross = readWord(p.row, p.col, dc, dr);
    if (cross.word.length >= 2) words.push(cross);
  }
  if (words.length === 0) return { ok: false, error: 'You must form a word of at least two letters.' };

  for (const { word } of words) {
    if (!dict.has(word)) return { ok: false, error: `"${word}" is not in the dictionary.` };
  }

  const bingo = placements.length >= BINGO_TILES;
  const score = words.reduce((sum, w) => sum + w.score, 0) + (bingo ? BINGO_BONUS : 0);
  return { ok: true, move: { placements: sorted, direction, words, score, bingo } };
}
