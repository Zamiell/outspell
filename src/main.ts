import './style.css';
import wordsUrl from '../dictionary/enable1.txt?url';
import { BOARD_SIZE, CENTER, PREMIUMS, cellLabel } from './board.ts';
import { define } from './definitions.ts';
import { Dictionary } from './dictionary.ts';
import { Game, MIN_BAG_FOR_EXCHANGE, type Turn } from './game.ts';
import { setupPopovers } from './popover.ts';
import { type Placement, evaluateMove } from './rules.ts';
import { ALPHABET, BLANK, DISTRIBUTION, LETTER_VALUES } from './tiles.ts';

/** A tile the human has put on the board but not yet played. */
interface Pending {
  rackIndex: number;
  letter: string;
  blank: boolean;
}

const AI_DELAY_MS = 600;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $('board');
const rackEl = $('rack');
const statusEl = $('status');
const logEl = $('log');
const bagEl = $('bag');
const buttons = {
  play: $<HTMLButtonElement>('play'),
  recall: $<HTMLButtonElement>('recall'),
  shuffle: $<HTMLButtonElement>('shuffle'),
  swap: $<HTMLButtonElement>('swap'),
  pass: $<HTMLButtonElement>('pass'),
};
const blankPicker = $<HTMLDialogElement>('blank-picker');
const gameOverDialog = $<HTMLDialogElement>('game-over');

let dict: Dictionary;
let game: Game;
let pending = new Map<number, Pending>(); // keyed by row * BOARD_SIZE + col
let selected: number | null = null; // rack index
let swapping: Set<number> | null = null; // rack indices chosen for exchange
let lastAIMove = new Set<number>();
let aiThinking = false;
let notice = '';
let loggedTurns = -1;

const cellKey = (row: number, col: number) => row * BOARD_SIZE + col;
const human = () => game.players[0];
const ai = () => game.players[1];
const myTurn = () => !game.over && !aiThinking && !game.currentPlayer.isAI;

function pendingPlacements(): Placement[] {
  return [...pending].map(([key, p]) => ({
    row: Math.floor(key / BOARD_SIZE),
    col: key % BOARD_SIZE,
    letter: p.letter,
    blank: p.blank,
  }));
}

// ---------------------------------------------------------------- rendering

function tileEl(letter: string, value: number, extraClass = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `tile ${extraClass}`;
  el.innerHTML = `<span class="letter">${letter}</span>${value ? `<span class="points">${value}</span>` : ''}`;
  return el;
}

function renderBoard(): void {
  boardEl.replaceChildren();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const key = cellKey(row, col);
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.key = String(key);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', cellLabel(row, col));

      const placed = game.board[row][col];
      const mine = pending.get(key);
      if (placed) {
        const value = placed.blank ? 0 : LETTER_VALUES[placed.letter];
        cell.append(tileEl(placed.letter, value, `${placed.blank ? 'blank' : ''} ${lastAIMove.has(key) ? 'recent' : ''}`));
      } else if (mine) {
        const tile = tileEl(mine.letter, mine.blank ? 0 : LETTER_VALUES[mine.letter], `pending ${mine.blank ? 'blank' : ''}`);
        tile.draggable = myTurn();
        tile.addEventListener('dragstart', (e) => e.dataTransfer!.setData('text/plain', `cell:${key}`));
        cell.append(tile);
      } else {
        const premium = PREMIUMS[row][col];
        if (row === CENTER && col === CENTER) cell.classList.add('center', 'DW');
        else if (premium) {
          cell.classList.add(premium);
          cell.textContent = premium;
        }
        if (selected !== null) cell.classList.add('droppable');
      }
      boardEl.append(cell);
    }
  }
}

function renderRack(): void {
  rackEl.replaceChildren();
  const used = new Set([...pending.values()].map((p) => p.rackIndex));
  human().rack.forEach((t, i) => {
    if (used.has(i)) return;
    const tile = tileEl(t === BLANK ? '' : t, LETTER_VALUES[t], t === BLANK ? 'blank' : '');
    tile.dataset.index = String(i);
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-label', t === BLANK ? 'Blank tile' : `${t}, ${LETTER_VALUES[t]} points`);
    if (selected === i) tile.classList.add('selected');
    if (swapping?.has(i)) tile.classList.add('marked');
    tile.draggable = myTurn() && !swapping;
    tile.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/plain', `rack:${i}`);
      selected = null;
    });
    rackEl.append(tile);
  });
}

/** A move-log entry; each word played is a button that shows its definition. */
function turnEl(turn: Turn): HTMLElement {
  const li = document.createElement('li');
  li.className = turn.player.isAI ? 'ai' : 'you';
  const who = turn.player.isAI ? 'AI' : 'You';
  if (turn.kind === 'pass') {
    li.textContent = `${who} passed`;
  } else if (turn.kind === 'exchange') {
    li.textContent = `${who} swapped ${turn.count} tile${turn.count === 1 ? '' : 's'}`;
  } else {
    li.append(`${who}: `);
    turn.move.words.forEach(({ word }, i) => {
      if (i > 0) li.append(i === 1 ? ' + ' : ', ');
      const button = document.createElement('button');
      button.className = 'word';
      button.textContent = word;
      button.dataset.popover = `word:${word}`;
      button.setAttribute('aria-haspopup', 'dialog');
      li.append(button);
    });
    li.append(` — ${turn.move.score}${turn.move.bingo ? ' (bingo!)' : ''}`);
  }
  return li;
}

/** Tiles you can't see: everything not on the board or your own rack (bag + AI rack). */
function unseenTiles(): Map<string, number> {
  const counts = new Map(Object.entries(DISTRIBUTION));
  const remove = (t: string) => counts.set(t, counts.get(t)! - 1);
  for (const row of game.board) for (const tile of row) if (tile) remove(tile.blank ? BLANK : tile.letter);
  for (const t of human().rack) remove(t);
  return counts;
}

function bagPopover(): Node {
  const counts = unseenTiles();
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const root = document.createElement('div');
  root.className = 'bag-popover';
  root.innerHTML = `<h3>Unseen tiles · ${total}</h3><p class="muted">${game.bag.size} in the bag + ${ai().rack.length} on the AI's rack</p>`;
  const grid = document.createElement('div');
  grid.className = 'unseen';
  for (const letter of [...ALPHABET, BLANK]) {
    const n = counts.get(letter) ?? 0;
    const item = document.createElement('div');
    item.className = `unseen-item${n === 0 ? ' gone' : ''}`;
    item.innerHTML = `<span class="mini-tile">${letter === BLANK ? '_' : letter}</span><span class="count">${n}</span>`;
    item.title = `${letter === BLANK ? 'Blank' : letter}: ${n} unseen`;
    grid.append(item);
  }
  root.append(grid);
  return root;
}

function wordPopover(word: string): Node {
  const root = document.createElement('div');
  root.className = 'definition';
  root.innerHTML = `<h3>${word}</h3><p class="muted">Looking up…</p>`;
  define(word).then(
    (def) => {
      const body = document.createElement('div');
      if (!def) {
        body.innerHTML = `<p class="muted">No definition found. It's valid in ENABLE, but Wiktionary doesn't have it.</p>`;
      } else {
        const list = document.createElement('ol');
        for (const m of def.meanings) {
          const li = document.createElement('li');
          li.innerHTML = `<em></em> `;
          li.querySelector('em')!.textContent = m.partOfSpeech;
          li.append(m.definition);
          list.append(li);
        }
        body.append(list);
      }
      root.replaceChildren(root.firstElementChild!, body);
      popovers.reposition();
    },
    () => {
      root.querySelector('p')!.textContent = "Couldn't reach the dictionary. Check your connection and try again.";
      popovers.reposition();
    },
  );
  return root;
}

const popovers = setupPopovers((id) => (id === 'bag' ? bagPopover() : wordPopover(id.slice('word:'.length))));

function renderStatus(): void {
  if (notice) {
    statusEl.textContent = notice;
    statusEl.className = 'status error';
    return;
  }
  statusEl.className = 'status';
  if (game.over) statusEl.textContent = 'Game over.';
  else if (aiThinking || game.currentPlayer.isAI) statusEl.textContent = 'AI is thinking…';
  else if (swapping) statusEl.textContent = 'Pick the tiles to swap, then press Confirm.';
  else if (pending.size === 0) statusEl.textContent = 'Your turn — drag tiles onto the board, or tap a tile then a square.';
  else {
    const result = evaluateMove(game.board, pendingPlacements(), dict);
    if (result.ok) {
      statusEl.textContent = `${result.move.words.map((w) => w.word).join(', ')} for ${result.move.score} points`;
      statusEl.className = 'status good';
    } else {
      statusEl.textContent = result.error;
      statusEl.className = 'status warn';
    }
  }
}

function render(): void {
  renderBoard();
  renderRack();
  renderStatus();

  $('score-you').querySelector('.value')!.textContent = String(human().score);
  $('score-ai').querySelector('.value')!.textContent = String(ai().score);
  $('score-you').classList.toggle('active', !game.over && !game.currentPlayer.isAI);
  $('score-ai').classList.toggle('active', !game.over && game.currentPlayer.isAI);
  bagEl.textContent = `${game.bag.size} in bag`;

  // Only rebuild the log when it changes, so an open definition stays open.
  if (loggedTurns !== game.history.length) {
    logEl.replaceChildren(...game.history.toReversed().map(turnEl));
    loggedTurns = game.history.length;
  }

  const canAct = myTurn();
  const valid = pending.size > 0 && evaluateMove(game.board, pendingPlacements(), dict).ok;
  buttons.play.textContent = swapping ? `Confirm swap (${swapping.size})` : 'Play';
  buttons.play.disabled = !canAct || (swapping ? swapping.size === 0 : !valid);
  buttons.recall.textContent = swapping ? 'Cancel' : 'Recall';
  buttons.recall.disabled = !canAct || (!swapping && pending.size === 0);
  buttons.shuffle.disabled = !canAct || !!swapping;
  buttons.swap.disabled = !canAct || !!swapping || game.bag.size < MIN_BAG_FOR_EXCHANGE;
  buttons.swap.title = game.bag.size < MIN_BAG_FOR_EXCHANGE ? `Needs ${MIN_BAG_FOR_EXCHANGE}+ tiles in the bag` : '';
  buttons.pass.disabled = !canAct || !!swapping;

  popovers.refresh((id) => id === 'bag');
}

// ---------------------------------------------------------------- actions

function chooseBlankLetter(): Promise<string | null> {
  return new Promise((resolve) => {
    const container = $('blank-letters');
    container.replaceChildren(
      ...[...ALPHABET].map((letter) => {
        const b = document.createElement('button');
        b.textContent = letter;
        b.addEventListener('click', () => blankPicker.close(letter));
        return b;
      }),
    );
    blankPicker.returnValue = '';
    blankPicker.addEventListener(
      'close',
      () => resolve(ALPHABET.includes(blankPicker.returnValue) && blankPicker.returnValue ? blankPicker.returnValue : null),
      { once: true },
    );
    blankPicker.showModal();
  });
}

async function placeFromRack(rackIndex: number, key: number): Promise<void> {
  const row = Math.floor(key / BOARD_SIZE);
  const col = key % BOARD_SIZE;
  if (game.board[row][col] || pending.has(key)) return;
  const tile = human().rack[rackIndex];
  let letter = tile;
  if (tile === BLANK) {
    const chosen = await chooseBlankLetter();
    if (!chosen) return;
    letter = chosen;
  }
  pending.set(key, { rackIndex, letter, blank: tile === BLANK });
  selected = null;
  notice = '';
  render();
}

function moveWithinBoard(from: number, to: number): void {
  const tile = pending.get(from);
  const row = Math.floor(to / BOARD_SIZE);
  const col = to % BOARD_SIZE;
  if (!tile || game.board[row][col] || pending.has(to)) return;
  pending.delete(from);
  pending.set(to, tile);
  render();
}

function finishHumanTurn(action: () => void): void {
  try {
    action();
  } catch (err) {
    notice = (err as Error).message;
    render();
    return;
  }
  pending.clear();
  selected = null;
  swapping = null;
  lastAIMove = new Set();
  notice = '';
  afterTurn();
}

function afterTurn(): void {
  render();
  if (game.over) {
    showGameOver();
    return;
  }
  if (!game.currentPlayer.isAI) return;
  aiThinking = true;
  render();
  // Let the browser paint "thinking" before the (synchronous) search runs.
  setTimeout(() => {
    const turn = game.playAI();
    lastAIMove = new Set(turn.kind === 'play' ? turn.move.placements.map((p) => cellKey(p.row, p.col)) : []);
    aiThinking = false;
    afterTurn();
  }, AI_DELAY_MS);
}

function showGameOver(): void {
  const you = human().score;
  const them = ai().score;
  $('game-over-title').textContent = you === them ? "It's a tie" : you > them ? 'You win!' : 'The AI wins';
  $('game-over-score').textContent = `You ${you} — AI ${them}`;
  gameOverDialog.showModal();
}

function newGame(): void {
  game = new Game(dict);
  loggedTurns = -1;
  pending = new Map();
  selected = null;
  swapping = null;
  lastAIMove = new Set();
  notice = '';
  afterTurn();
}

// ---------------------------------------------------------------- events

boardEl.addEventListener('click', (e) => {
  if (!myTurn() || swapping) return;
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
  if (!cell) return;
  const key = Number(cell.dataset.key);
  if (pending.has(key)) {
    pending.delete(key); // tap a tile you placed to take it back
    notice = '';
    render();
  } else if (selected !== null) {
    void placeFromRack(selected, key);
  }
});

boardEl.addEventListener('dragover', (e) => {
  if (myTurn()) e.preventDefault();
});
boardEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
  const data = e.dataTransfer?.getData('text/plain') ?? '';
  if (!cell || !myTurn()) return;
  const key = Number(cell.dataset.key);
  const [source, id] = data.split(':');
  if (source === 'rack') void placeFromRack(Number(id), key);
  else if (source === 'cell') moveWithinBoard(Number(id), key);
});

rackEl.addEventListener('dragover', (e) => e.preventDefault());
rackEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const [source, id] = (e.dataTransfer?.getData('text/plain') ?? '').split(':');
  if (source === 'cell' && pending.delete(Number(id))) render();
});

function onRackActivate(target: EventTarget | null): void {
  const tile = (target as HTMLElement).closest<HTMLElement>('.tile');
  if (!tile || !myTurn()) return;
  const index = Number(tile.dataset.index);
  if (swapping) {
    if (!swapping.delete(index)) swapping.add(index);
  } else {
    selected = selected === index ? null : index;
  }
  render();
}
rackEl.addEventListener('click', (e) => onRackActivate(e.target));
rackEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onRackActivate(e.target);
  }
});

buttons.play.addEventListener('click', () => {
  if (swapping) {
    const tiles = [...swapping].map((i) => human().rack[i]);
    finishHumanTurn(() => game.exchange(tiles));
  } else {
    finishHumanTurn(() => game.play(pendingPlacements()));
  }
});

buttons.recall.addEventListener('click', () => {
  swapping = null;
  pending.clear();
  selected = null;
  notice = '';
  render();
});

buttons.shuffle.addEventListener('click', () => {
  pending.clear();
  selected = null;
  const rack = human().rack;
  for (let i = rack.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rack[i], rack[j]] = [rack[j], rack[i]];
  }
  render();
});

buttons.swap.addEventListener('click', () => {
  pending.clear();
  selected = null;
  swapping = new Set();
  notice = '';
  render();
});

buttons.pass.addEventListener('click', () => {
  if (confirm('Pass your turn?')) finishHumanTurn(() => game.pass());
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') {
    selected = null;
    render();
  } else if (e.key === 'Enter' && !buttons.play.disabled && !(e.target as HTMLElement).closest('.rack')) {
    buttons.play.click();
  }
});

gameOverDialog.addEventListener('close', newGame);

// ---------------------------------------------------------------- start

Dictionary.load(wordsUrl)
  .then((loaded) => {
    dict = loaded;
    newGame();
  })
  .catch((err: Error) => {
    statusEl.textContent = err.message;
    statusEl.className = 'status error';
  });
