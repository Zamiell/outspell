import { MAX_LEVEL, chooseMove, isLevel } from './ai.ts';
import { type Board, BOARD_SIZE, createBoard } from './board.ts';
import type { Dictionary } from './dictionary.ts';
import { type Placement, type ScoredMove, evaluateMove } from './rules.ts';
import { ALPHABET, BLANK, Bag, DISTRIBUTION, type Rng, rackValue } from './tiles.ts';

export const HUMAN_RACK_SIZE = 6;
export const AI_RACK_SIZE = 7;
/** Standard rule: you may only exchange while the bag holds at least this many. */
export const MIN_BAG_FOR_EXCHANGE = 7;
/** Game ends after this many consecutive scoreless turns (three each). */
const MAX_SCORELESS_TURNS = 6;

export interface Player {
  name: string;
  isAI: boolean;
  rackSize: number;
  rack: string[];
  score: number;
}

export type Turn =
  | { kind: 'play'; player: Player; move: ScoredMove }
  | { kind: 'exchange'; player: Player; count: number }
  | { kind: 'pass'; player: Player };

/** A turn as saved: the player is stored by index. */
export type SavedTurn =
  | { kind: 'play'; player: number; move: ScoredMove }
  | { kind: 'exchange'; player: number; count: number }
  | { kind: 'pass'; player: number };

/** Plain-JSON form of a game, for saving it and restoring it later. */
export interface GameSnapshot {
  version: 1;
  /** AI difficulty, 1–10. Missing in older saves (see `levelOf`). */
  level?: number;
  /** Older saves used named difficulties instead of levels. */
  difficulty?: 'easy' | 'medium' | 'hard';
  board: Board;
  bag: string[];
  players: { rack: string[]; score: number; rackSize: number }[];
  current: number;
  over: boolean;
  scorelessTurns: number;
  history: SavedTurn[];
}

export interface GameOptions {
  /** AI difficulty, 1–10 (default 10: always the best move). */
  level?: number;
  humanRackSize?: number;
  aiRackSize?: number;
  rng?: Rng;
}

export class Game {
  readonly board: Board;
  readonly bag: Bag;
  readonly players: Player[];
  readonly level: number;
  current = 0;
  over = false;
  history: Turn[] = [];
  private scorelessTurns = 0;
  private readonly rng: Rng;

  /** Starts a new game, or resumes `snapshot` (throws if the snapshot isn't a valid game). */
  constructor(
    readonly dict: Dictionary,
    { level = MAX_LEVEL, humanRackSize = HUMAN_RACK_SIZE, aiRackSize = AI_RACK_SIZE, rng = Math.random }: GameOptions = {},
    snapshot?: GameSnapshot,
  ) {
    this.rng = rng;
    this.level = snapshot ? levelOf(snapshot) : level;
    this.players = [
      { name: 'You', isAI: false, rackSize: humanRackSize, rack: [], score: 0 },
      { name: 'AI', isAI: true, rackSize: aiRackSize, rack: [], score: 0 },
    ];
    if (snapshot) {
      validateSnapshot(snapshot);
      this.board = snapshot.board.map((row) => row.map((tile) => (tile ? { ...tile } : null)));
      this.bag = new Bag(rng, snapshot.bag);
      snapshot.players.forEach((saved, i) => Object.assign(this.players[i], { ...saved, rack: [...saved.rack] }));
      this.current = snapshot.current;
      this.over = snapshot.over;
      this.scorelessTurns = snapshot.scorelessTurns;
      this.history = snapshot.history.map((turn) => ({ ...turn, player: this.players[turn.player] }));
      return;
    }
    this.board = createBoard();
    this.bag = new Bag(rng);
    for (const p of this.players) p.rack = this.bag.draw(p.rackSize);
    this.current = rng() < 0.5 ? 0 : 1;
  }

  toSnapshot(): GameSnapshot {
    return {
      version: 1,
      level: this.level,
      board: this.board.map((row) => row.map((tile) => (tile ? { ...tile } : null))),
      bag: this.bag.contents,
      players: this.players.map(({ rack, score, rackSize }) => ({ rack: [...rack], score, rackSize })),
      current: this.current,
      over: this.over,
      scorelessTurns: this.scorelessTurns,
      history: this.history.map((turn) => ({ ...turn, player: this.players.indexOf(turn.player) })),
    };
  }

  get currentPlayer(): Player {
    return this.players[this.current];
  }

  /** Validates, scores and applies a play for the current player. Throws on an illegal play. */
  play(placements: readonly Placement[]): Turn {
    const player = this.currentPlayer;
    const remaining = removeTiles(player.rack, placements.map((p) => (p.blank ? BLANK : p.letter)));
    if (!remaining) throw new Error("You don't have those tiles.");
    const result = evaluateMove(this.board, placements, this.dict);
    if (!result.ok) throw new Error(result.error);

    for (const p of result.move.placements) this.board[p.row][p.col] = { letter: p.letter, blank: p.blank };
    player.rack = remaining;
    player.score += result.move.score;
    player.rack.push(...this.bag.draw(player.rackSize - player.rack.length));
    return this.endTurn({ kind: 'play', player, move: result.move });
  }

  /** Swaps the given tiles (use '?' for a blank) for fresh ones from the bag. */
  exchange(tiles: readonly string[]): Turn {
    const player = this.currentPlayer;
    if (tiles.length === 0) throw new Error('Choose at least one tile to exchange.');
    if (this.bag.size < MIN_BAG_FOR_EXCHANGE) {
      throw new Error(`You can only exchange while the bag has at least ${MIN_BAG_FOR_EXCHANGE} tiles.`);
    }
    const remaining = removeTiles(player.rack, tiles);
    if (!remaining) throw new Error("You don't have those tiles.");
    const drawn = this.bag.draw(tiles.length);
    this.bag.putBack(tiles);
    player.rack = [...remaining, ...drawn];
    return this.endTurn({ kind: 'exchange', player, count: tiles.length });
  }

  pass(): Turn {
    return this.endTurn({ kind: 'pass', player: this.currentPlayer });
  }

  /** The AI plays a move chosen for its level, or passes if it has none. */
  playAI(): Turn {
    const move = chooseMove(this.board, this.currentPlayer.rack, this.dict, this.level, this.rng);
    return move ? this.play(move.placements) : this.pass();
  }

  private endTurn(turn: Turn): Turn {
    this.history.push(turn);
    this.scorelessTurns = turn.kind === 'play' && turn.move.score > 0 ? 0 : this.scorelessTurns + 1;

    const player = turn.player;
    if (turn.kind === 'play' && player.rack.length === 0 && this.bag.size === 0) {
      // Going out: collect the value of everyone else's remaining tiles.
      for (const other of this.players) {
        if (other === player) continue;
        const value = rackValue(other.rack);
        other.score -= value;
        player.score += value;
      }
      this.over = true;
    } else if (this.scorelessTurns >= MAX_SCORELESS_TURNS) {
      for (const p of this.players) p.score -= rackValue(p.rack);
      this.over = true;
    }

    if (!this.over) this.current = (this.current + 1) % this.players.length;
    return turn;
  }
}

/** Returns the rack minus `tiles`, or null if the rack doesn't contain them all. */
export function removeTiles(rack: readonly string[], tiles: readonly string[]): string[] | null {
  const remaining = [...rack];
  for (const t of tiles) {
    const i = remaining.indexOf(t);
    if (i === -1) return null;
    remaining.splice(i, 1);
  }
  return remaining;
}

/** Named difficulties from older saves, mapped to the nearest (easier) level. */
const LEGACY_LEVELS = { easy: 3, medium: 6, hard: 10 } as const;

function levelOf(snap: GameSnapshot): number {
  return snap.level ?? (snap.difficulty ? LEGACY_LEVELS[snap.difficulty] : MAX_LEVEL);
}

/** Rejects anything that isn't a coherent game: wrong shape, or tiles that don't add up to one full set. */
function validateSnapshot(snap: GameSnapshot): void {
  const fail = (why: string): never => {
    throw new Error(`Invalid saved game: ${why}`);
  };
  if (snap?.version !== 1) fail('unknown version');
  if (snap.level !== undefined && !isLevel(snap.level)) fail('bad level');
  if (snap.difficulty !== undefined && !(snap.difficulty in LEGACY_LEVELS)) fail('bad difficulty');
  if (!Array.isArray(snap.board) || snap.board.length !== BOARD_SIZE || snap.board.some((r) => !Array.isArray(r) || r.length !== BOARD_SIZE)) {
    fail('bad board');
  }
  if (!Array.isArray(snap.players) || snap.players.length !== 2) fail('bad players');
  if (![0, 1].includes(snap.current)) fail('bad current player');
  if (!Array.isArray(snap.history) || snap.history.some((t) => ![0, 1].includes(t?.player))) fail('bad history');

  const counts = new Map<string, number>();
  const count = (t: unknown) => {
    if (typeof t !== 'string' || !(t in DISTRIBUTION)) fail('unknown tile');
    counts.set(t as string, (counts.get(t as string) ?? 0) + 1);
  };
  for (const row of snap.board) {
    for (const tile of row) {
      if (!tile) continue;
      if (!ALPHABET.includes(tile.letter) || tile.letter.length !== 1) fail('bad board tile');
      count(tile.blank ? BLANK : tile.letter);
    }
  }
  snap.bag.forEach(count);
  for (const p of snap.players) {
    if (!Array.isArray(p.rack) || !Number.isInteger(p.score) || !Number.isInteger(p.rackSize)) fail('bad player');
    p.rack.forEach(count);
  }
  for (const [tile, n] of Object.entries(DISTRIBUTION)) {
    if ((counts.get(tile) ?? 0) !== n) fail(`wrong number of ${tile} tiles`);
  }
}
