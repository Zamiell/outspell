import { findBestMove } from './ai.ts';
import { type Board, createBoard } from './board.ts';
import type { Dictionary } from './dictionary.ts';
import { type Placement, type ScoredMove, evaluateMove } from './rules.ts';
import { BLANK, Bag, type Rng, rackValue } from './tiles.ts';

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

export interface GameOptions {
  humanRackSize?: number;
  aiRackSize?: number;
  rng?: Rng;
}

export class Game {
  readonly board: Board = createBoard();
  readonly bag: Bag;
  readonly players: Player[];
  current = 0;
  over = false;
  history: Turn[] = [];
  private scorelessTurns = 0;

  constructor(
    readonly dict: Dictionary,
    { humanRackSize = HUMAN_RACK_SIZE, aiRackSize = AI_RACK_SIZE, rng = Math.random }: GameOptions = {},
  ) {
    this.bag = new Bag(rng);
    this.players = [
      { name: 'You', isAI: false, rackSize: humanRackSize, rack: [], score: 0 },
      { name: 'AI', isAI: true, rackSize: aiRackSize, rack: [], score: 0 },
    ];
    for (const p of this.players) p.rack = this.bag.draw(p.rackSize);
    this.current = rng() < 0.5 ? 0 : 1;
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

  /** The AI plays its highest-scoring move, or passes if it has none. */
  playAI(): Turn {
    const move = findBestMove(this.board, this.currentPlayer.rack, this.dict);
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
