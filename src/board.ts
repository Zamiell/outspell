export const BOARD_SIZE = 15;
export const CENTER = 7;

export type Premium = 'TW' | 'DW' | 'TL' | 'DL';

export interface Tile {
  /** Always an uppercase A–Z letter, including for blanks. */
  letter: string;
  blank: boolean;
}

export type Board = (Tile | null)[][];

export function createBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Tile | null>(BOARD_SIZE).fill(null));
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function isBoardEmpty(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell === null));
}

// One quadrant of the standard layout; mirrored into the other three.
const QUADRANT: Record<Premium, [number, number][]> = {
  TW: [[0, 0], [0, 7], [7, 0]],
  DW: [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]],
  TL: [[1, 5], [5, 1], [5, 5]],
  DL: [[0, 3], [3, 0], [2, 6], [6, 2], [3, 7], [7, 3], [6, 6]],
};

export const PREMIUMS: readonly (readonly (Premium | null)[])[] = (() => {
  const grid: (Premium | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array<Premium | null>(BOARD_SIZE).fill(null),
  );
  const last = BOARD_SIZE - 1;
  for (const [premium, cells] of Object.entries(QUADRANT) as [Premium, [number, number][]][]) {
    for (const [r, c] of cells) {
      grid[r][c] = grid[r][last - c] = grid[last - r][c] = grid[last - r][last - c] = premium;
    }
  }
  return grid;
})();

/** "H8"-style label: column letter A–O, row number 1–15. */
export function cellLabel(row: number, col: number): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}
