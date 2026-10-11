import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseMove, findBestMove } from '../src/ai.ts';
import { type Board, BOARD_SIZE, createBoard } from '../src/board.ts';
import { Dictionary } from '../src/dictionary.ts';
import { Game, removeTiles } from '../src/game.ts';
import { type Placement, evaluateMove } from '../src/rules.ts';

const WORDS = ['CAT', 'CATS', 'AT', 'TA', 'ACT', 'SCAT', 'TAX', 'AX', 'XI', 'TI', 'IT', 'SIT', 'SAT', 'TACIT', 'TAXI', 'AS', 'IS', 'ES', 'SET', 'TEA', 'EAT', 'ATE', 'SEAT', 'TEAS', 'EATS', 'QI', 'QAT', 'ZA', 'ZAX'];
const dict = new Dictionary(WORDS);

/** Placements spelling `word` from (row, col), skipping squares already filled. Lowercase = blank. */
function tiles(board: Board, row: number, col: number, dir: 'across' | 'down', word: string): Placement[] {
  return [...word].flatMap((ch, i) => {
    const r = row + (dir === 'down' ? i : 0);
    const c = col + (dir === 'across' ? i : 0);
    return board[r][c] ? [] : [{ row: r, col: c, letter: ch.toUpperCase(), blank: ch !== ch.toUpperCase() }];
  });
}

function place(board: Board, row: number, col: number, dir: 'across' | 'down', word: string): void {
  [...word].forEach((letter, i) => {
    board[row + (dir === 'down' ? i : 0)][col + (dir === 'across' ? i : 0)] = { letter, blank: false };
  });
}

test('first move must cover the centre and is scored with premiums', () => {
  const board = createBoard();
  const offCentre = evaluateMove(board, [{ row: 0, col: 1, letter: 'A', blank: false }, { row: 0, col: 2, letter: 'T', blank: false }], dict);
  assert.equal(offCentre.ok, false);

  // CAT at H8 across; centre H8 is a DW: C(3)+A(1)+T(1) = 5 * 2 = 10.
  const result = evaluateMove(board, tiles(board, 7, 7, 'across', 'CAT'), dict);
  assert.ok(result.ok);
  assert.equal(result.move.score, 10);
});

test('blanks score zero and invalid cross-words are rejected', () => {
  const board = createBoard();
  place(board, 7, 7, 'across', 'CAT');
  const result = evaluateMove(board, tiles(board, 7, 7, 'across', 'CATs'), dict);
  assert.ok(result.ok);
  assert.equal(result.move.score, 5); // C3 A1 T1 S0, no premium on K8

  // Putting X under the A of CAT makes "AX" down (fine) but "XQ" across is nonsense.
  const bad: Placement[] = [{ row: 8, col: 8, letter: 'X', blank: false }, { row: 8, col: 9, letter: 'Q', blank: false }];
  assert.equal(evaluateMove(board, bad, dict).ok, false);
});

test('disconnected and gapped plays are rejected', () => {
  const board = createBoard();
  place(board, 7, 7, 'across', 'CAT');
  assert.equal(evaluateMove(board, tiles(board, 0, 0, 'across', 'AT'), dict).ok, false);
  const gapped: Placement[] = [{ row: 0, col: 7, letter: 'A', blank: false }, { row: 2, col: 7, letter: 'T', blank: false }];
  assert.equal(evaluateMove(board, gapped, dict).ok, false);
});

test('removeTiles respects counts', () => {
  assert.deepEqual(removeTiles(['A', 'A', 'B'], ['A', 'B']), ['A']);
  assert.equal(removeTiles(['A', 'B'], ['A', 'A']), null);
});

/** Reference search: try every dictionary word at every position and direction. */
function bruteForceBest(board: Board, rack: string[]): number {
  let best = 0;
  for (const word of WORDS) {
    for (const dir of ['across', 'down'] as const) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const placements: Placement[] = [];
          let fits = true;
          for (let i = 0; i < word.length && fits; i++) {
            const row = r + (dir === 'down' ? i : 0);
            const col = c + (dir === 'across' ? i : 0);
            if (row >= BOARD_SIZE || col >= BOARD_SIZE) fits = false;
            else if (board[row][col]) fits = board[row][col]!.letter === word[i];
            else placements.push({ row, col, letter: word[i], blank: false });
          }
          if (!fits || !removeTiles(rack, placements.map((p) => p.letter))) continue;
          const result = evaluateMove(board, placements, dict);
          if (result.ok) best = Math.max(best, result.move.score);
        }
      }
    }
  }
  return best;
}

test('AI finds the same top score as a brute-force search', () => {
  const racks = [['C', 'A', 'T', 'S', 'X', 'I', 'E'], ['Q', 'I', 'Z', 'A', 'X', 'T', 'E'], ['S', 'E', 'A', 'T', 'I', 'C', 'T']];
  const board = createBoard();
  for (let turn = 0; turn < 6; turn++) {
    const rack = racks[turn % racks.length];
    const expected = bruteForceBest(board, rack);
    const move = findBestMove(board, rack, dict);
    assert.equal(move?.score ?? 0, expected, `turn ${turn}`);
    if (!move) break;
    for (const p of move.placements) board[p.row][p.col] = { letter: p.letter, blank: p.blank };
  }
});

test('the human holds 6 tiles and the AI holds 7', () => {
  const game = new Game(dict, { rng: () => 0.1 });
  assert.equal(game.players[0].rack.length, 6);
  assert.equal(game.players[1].rack.length, 7);
});

test('a human play scores, refills the rack to 6 and passes the turn', () => {
  const game = new Game(dict, { rng: () => 0.9 });
  game.current = 0;
  game.players[0].rack = ['C', 'A', 'T', 'E', 'E', 'E'];
  game.play(tiles(game.board, 7, 7, 'down', 'CAT'));
  assert.equal(game.players[0].score, 10);
  assert.equal(game.players[0].rack.length, 6);
  assert.equal(game.currentPlayer.isAI, true);
});

test('a saved game restores exactly and keeps playing', () => {
  let seed = 42;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const game = new Game(dict, { rng });
  for (let i = 0; i < 4 && !game.over; i++) game.playAI();

  const snapshot = JSON.parse(JSON.stringify(game.toSnapshot()));
  const restored = new Game(dict, {}, snapshot);
  assert.deepEqual(restored.toSnapshot(), game.toSnapshot());
  assert.equal(restored.history.length, game.history.length);
  // History entries point at the restored game's own player objects.
  assert.ok(restored.history.every((turn) => restored.players.includes(turn.player)));

  // Both copies make the same next move.
  if (!game.over) assert.deepEqual(restored.playAI().kind, game.playAI().kind);
  assert.deepEqual(restored.toSnapshot().board, game.toSnapshot().board);
});

test('corrupted saves are rejected', () => {
  const good = new Game(dict, { rng: () => 0.3 }).toSnapshot();
  const extraTile = structuredClone(good);
  extraTile.players[0].rack.push('Z');
  assert.throws(() => new Game(dict, {}, extraTile), /wrong number of Z/);
  assert.throws(() => new Game(dict, {}, { ...good, version: 2 } as never), /unknown version/);
  assert.throws(() => new Game(dict, {}, { ...good, board: [] }), /bad board/);
});

test('lower levels play legal moves that score no more than the best', () => {
  const board = createBoard();
  place(board, 7, 7, 'across', 'CAT');
  const rack = ['S', 'E', 'A', 'T', 'X', 'I', 'Q'];
  const best = findBestMove(board, rack, dict)!;
  assert.equal(chooseMove(board, rack, dict, 10)!.score, best.score);
  for (let level = 1; level < 10; level++) {
    for (let i = 0; i < 5; i++) {
      const move = chooseMove(board, rack, dict, level, () => i / 5)!;
      assert.ok(evaluateMove(board, move.placements, dict).ok);
      assert.ok(move.score <= best.score);
    }
  }
  const low = chooseMove(board, rack, dict, 2, () => 0)!;
  assert.ok(low.score < best.score, `level 2 scored ${low.score}, best is ${best.score}`);
});

test('level is saved, and older saves get a sensible level', () => {
  const game = new Game(dict, { level: 4, rng: () => 0.4 });
  const snapshot = JSON.parse(JSON.stringify(game.toSnapshot()));
  assert.equal(new Game(dict, {}, snapshot).level, 4);
  delete snapshot.level;
  assert.equal(new Game(dict, {}, snapshot).level, 10);
  assert.equal(new Game(dict, {}, { ...snapshot, difficulty: 'easy' }).level, 3);
  assert.throws(() => new Game(dict, {}, { ...snapshot, level: 11 }), /bad level/);
});
