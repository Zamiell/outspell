import { type Board, type Tile, BOARD_SIZE, CENTER, isBoardEmpty } from './board.ts';
import type { Dictionary, TrieNode } from './dictionary.ts';
import { type Placement, type ScoredMove, evaluateMove } from './rules.ts';
import { ALPHABET, BLANK } from './tiles.ts';

/**
 * Greedy AI: generates every legal move for the rack and returns the single
 * highest-scoring one. No lookahead, no rack leave, no defence.
 */
export function findBestMove(board: Board, rack: readonly string[], dict: Dictionary): ScoredMove | null {
  let best: ScoredMove | null = null;
  forEachMove(board, rack, dict, (placements) => {
    const result = evaluateMove(board, placements, dict);
    if (result.ok && (!best || result.move.score > best.score)) best = result.move;
  });
  return best;
}

/** All candidate placements (main word guaranteed valid; cross-words pre-checked). */
export function generateMoves(board: Board, rack: readonly string[], dict: Dictionary): Placement[][] {
  const moves: Placement[][] = [];
  forEachMove(board, rack, dict, (p) => moves.push(p));
  return moves;
}

function forEachMove(
  board: Board,
  rack: readonly string[],
  dict: Dictionary,
  visit: (placements: Placement[]) => void,
): void {
  const counts = new Map<string, number>();
  for (const t of rack) counts.set(t, (counts.get(t) ?? 0) + 1);

  // Search rows of the board for "across" plays, then rows of the transposed
  // board for "down" plays, mapping coordinates back afterwards.
  const transposed: Board = board.map((_, r) => board.map((row) => row[r]));
  generateAcross(board, counts, dict, visit);
  generateAcross(transposed, counts, dict, (p) =>
    visit(p.map(({ row, col, letter, blank }) => ({ row: col, col: row, letter, blank }))),
  );
}

function generateAcross(
  board: Board,
  rack: Map<string, number>,
  dict: Dictionary,
  emit: (placements: Placement[]) => void,
): void {
  const filled = (r: number, c: number) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] !== null;
  const empty = isBoardEmpty(board);
  const isAnchor = (r: number, c: number) =>
    !board[r][c] && (empty ? r === CENTER && c === CENTER : filled(r - 1, c) || filled(r + 1, c) || filled(r, c - 1) || filled(r, c + 1));

  /** Tries each way the rack can supply `letter`: a real tile, then a blank. */
  const withTile = (letter: string, fn: (blank: boolean) => void) => {
    for (const [tile, blank] of [[letter, false], [BLANK, true]] as const) {
      const n = rack.get(tile) ?? 0;
      if (n === 0) continue;
      rack.set(tile, n - 1);
      fn(blank);
      rack.set(tile, n);
    }
  };

  for (let row = 0; row < BOARD_SIZE; row++) {
    const crossChecks = Array.from({ length: BOARD_SIZE }, (_, col) => crossCheck(board, row, col, dict));

    for (let anchor = 0; anchor < BOARD_SIZE; anchor++) {
      if (!isAnchor(row, anchor)) continue;
      const placed: Placement[] = [];

      const extendRight = (node: TrieNode, col: number) => {
        const existing = col < BOARD_SIZE ? board[row][col] : null;
        if (existing) {
          const next = node.children.get(existing.letter);
          if (next) extendRight(next, col + 1);
          return;
        }
        if (node.terminal && col > anchor) emit([...placed]);
        if (col >= BOARD_SIZE) return;
        const allowed = crossChecks[col];
        for (const [letter, next] of node.children) {
          if (allowed && !allowed.has(letter)) continue;
          withTile(letter, (blank) => {
            placed.push({ row, col, letter, blank });
            extendRight(next, col + 1);
            placed.pop();
          });
        }
      };

      if (anchor > 0 && board[row][anchor - 1]) {
        // Tiles already sit left of the anchor: they form a fixed prefix.
        let start = anchor - 1;
        while (start > 0 && board[row][start - 1]) start--;
        let node: TrieNode | undefined = dict.root;
        for (let c = start; c < anchor && node; c++) node = node.children.get(board[row][c]!.letter);
        if (node) extendRight(node, anchor);
        continue;
      }

      // Otherwise build a left part from the rack across empty, non-anchor
      // squares (which have no cross-word constraints).
      let limit = 0;
      while (anchor - limit - 1 >= 0 && !board[row][anchor - limit - 1] && !isAnchor(row, anchor - limit - 1)) limit++;

      const left: Tile[] = [];
      const leftPart = (node: TrieNode, remaining: number) => {
        const start = anchor - left.length;
        placed.push(...left.map((t, i) => ({ row, col: start + i, ...t })));
        extendRight(node, anchor);
        placed.length = 0;
        if (remaining === 0) return;
        for (const [letter, next] of node.children) {
          withTile(letter, (blank) => {
            left.push({ letter, blank });
            leftPart(next, remaining - 1);
            left.pop();
          });
        }
      };
      leftPart(dict.root, limit);
    }
  }
}

/**
 * Letters that may go in an empty square given the tiles above and below it,
 * or null when there are no vertical neighbours (anything goes).
 */
function crossCheck(board: Board, row: number, col: number, dict: Dictionary): Set<string> | null {
  if (board[row][col]) return null;
  let prefix = '';
  for (let r = row - 1; r >= 0 && board[r][col]; r--) prefix = board[r][col]!.letter + prefix;
  let suffix = '';
  for (let r = row + 1; r < BOARD_SIZE && board[r][col]; r++) suffix += board[r][col]!.letter;
  if (!prefix && !suffix) return null;
  return new Set([...ALPHABET].filter((letter) => dict.has(prefix + letter + suffix)));
}
