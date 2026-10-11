import './style.css';
import wordsUrl from '../dictionary/enable1.txt?url';
import { DIFFICULTIES, type Difficulty } from './ai.ts';
import { BOARD_SIZE, CENTER, PREMIUMS, cellLabel, inBounds } from './board.ts';
import { define } from './definitions.ts';
import { Dictionary } from './dictionary.ts';
import { Game, type GameSnapshot, MIN_BAG_FOR_EXCHANGE, type Turn } from './game.ts';
import { setupPopovers } from './popover.ts';
import { type Direction, type Placement, evaluateMove } from './rules.ts';
import { ALPHABET, BLANK, DISTRIBUTION, LETTER_VALUES } from './tiles.ts';

/** A tile the human has put on the board but not yet played. */
interface Pending {
  rackIndex: number;
  letter: string;
  blank: boolean;
}

/** Where the next tapped or typed tile goes, and which way the cursor then moves. */
interface Cursor {
  key: number;
  dir: Direction;
}

type DragSource = { kind: 'rack'; index: number } | { kind: 'cell'; key: number };

interface Drag {
  source: DragSource;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  tile: HTMLElement;
  ghost: HTMLElement | null;
  target: number | 'rack' | null;
  /** When over the rack: where the tile would be inserted among the visible tiles. */
  slot: number | null;
}

const AI_DELAY_MS = 600;
/** localStorage key for the game in progress. Bump the suffix if the snapshot format changes. */
const SAVE_KEY = 'outspell:game:v1';
/** localStorage key for the last difficulty picked, offered first next time. */
const DIFFICULTY_KEY = 'outspell:difficulty';
const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const ZOOM_FACTOR = 1.8;
const DRAG_THRESHOLD_PX = 6;
/** On touch, the dragged tile floats this far above the finger so you can see where it's going. */
const TOUCH_LIFT_PX = 56;

/** Phone-sized layout: everything on one screen, the board zooms, moves live in a sheet. */
const compactLayout = window.matchMedia('(max-width: 820px)');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardViewport = $('board-viewport');
const boardEl = $('board');
const rackEl = $('rack');
const statusEl = $('status');
const logEl = $('log');
const bagEl = $('bag');
const zoomButton = $<HTMLButtonElement>('zoom');
const menuButton = $<HTMLButtonElement>('menu');
const buttons = {
  play: $<HTMLButtonElement>('play'),
  recall: $<HTMLButtonElement>('recall'),
  shuffle: $<HTMLButtonElement>('shuffle'),
  swap: $<HTMLButtonElement>('swap'),
  pass: $<HTMLButtonElement>('pass'),
};
const blankPicker = $<HTMLDialogElement>('blank-picker');
const newGameDialog = $<HTMLDialogElement>('new-game-dialog');

let dict: Dictionary;
let game: Game;
let pending = new Map<number, Pending>(); // keyed by row * BOARD_SIZE + col
let selected: number | null = null; // rack index picked before tapping a square
let cursor: Cursor | null = null;
let swapping: Set<number> | null = null; // rack indices chosen for exchange
let lastAIMove = new Set<number>();
let aiThinking = false;
let notice = '';
let loggedTurns = -1;
let zoomed = false;
let drag: Drag | null = null;
let suppressClick = false;

const cellKey = (row: number, col: number) => row * BOARD_SIZE + col;
const rowOf = (key: number) => Math.floor(key / BOARD_SIZE);
const colOf = (key: number) => key % BOARD_SIZE;
const human = () => game.players[0];
const ai = () => game.players[1];
const myTurn = () => !game.over && !aiThinking && !game.currentPlayer.isAI;
const occupied = (key: number) => game.board[rowOf(key)][colOf(key)] !== null;
const isFree = (key: number) => !occupied(key) && !pending.has(key);

function pendingPlacements(): Placement[] {
  return [...pending].map(([key, p]) => ({ row: rowOf(key), col: colOf(key), letter: p.letter, blank: p.blank }));
}

function usedRackIndices(): Set<number> {
  return new Set([...pending.values()].map((p) => p.rackIndex));
}

/** The square `delta` steps from `key` in `dir`, or null off the board. */
function step(key: number, dir: Direction, delta = 1): number | null {
  const row = rowOf(key) + (dir === 'down' ? delta : 0);
  const col = colOf(key) + (dir === 'across' ? delta : 0);
  return inBounds(row, col) ? cellKey(row, col) : null;
}

function nextFree(key: number, dir: Direction): number | null {
  let next = step(key, dir);
  while (next !== null && !isFree(next)) next = step(next, dir);
  return next;
}

/** Guess the likely direction: down if the square only touches tiles above/below. */
function defaultDirection(key: number): Direction {
  const filled = (k: number | null) => k !== null && !isFree(k);
  const horizontal = filled(step(key, 'across', -1)) || filled(step(key, 'across', 1));
  const vertical = filled(step(key, 'down', -1)) || filled(step(key, 'down', 1));
  return vertical && !horizontal ? 'down' : 'across';
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
        tile.dataset.key = String(key);
        cell.append(tile);
      } else {
        const premium = PREMIUMS[row][col];
        if (premium) cell.classList.add(premium);
        if (cursor?.key === key) {
          cell.classList.add('cursor');
          cell.innerHTML = `<span class="cursor-arrow">${cursor.dir === 'across' ? '▶' : '▼'}</span>`;
        } else if (row === CENTER && col === CENTER) {
          cell.classList.add('center');
        } else if (premium) {
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
  const used = usedRackIndices();
  human().rack.forEach((t, i) => {
    if (used.has(i)) return;
    const tile = tileEl(t === BLANK ? '' : t, LETTER_VALUES[t], t === BLANK ? 'blank' : '');
    tile.dataset.index = String(i);
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-label', t === BLANK ? 'Blank tile' : `${t}, ${LETTER_VALUES[t]} points`);
    if (selected === i) tile.classList.add('selected');
    if (swapping?.has(i)) tile.classList.add('marked');
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
  else if (pending.size === 0) {
    statusEl.textContent = cursor
      ? `Tap tiles to spell ${cursor.dir}. Tap the arrow to turn it.`
      : 'Your turn. Tap a square, then tap tiles — or drag them.';
  } else {
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
  $('difficulty-label').textContent = DIFFICULTY_NAMES[game.difficulty];
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
  buttons.play.textContent = swapping ? `Swap ${swapping.size}` : 'Play';
  buttons.play.disabled = !canAct || (swapping ? swapping.size === 0 : !valid);
  buttons.recall.textContent = swapping ? 'Cancel' : 'Recall';
  buttons.recall.disabled = !canAct || (!swapping && pending.size === 0 && cursor === null);
  buttons.shuffle.disabled = !canAct || !!swapping;
  buttons.swap.disabled = !canAct || !!swapping || game.bag.size < MIN_BAG_FOR_EXCHANGE;
  buttons.swap.title = game.bag.size < MIN_BAG_FOR_EXCHANGE ? `Needs ${MIN_BAG_FOR_EXCHANGE}+ tiles in the bag` : '';
  buttons.pass.disabled = !canAct || !!swapping;

  boardEl.classList.toggle('zoomed', zoomed);
  boardViewport.classList.toggle('zoomed', zoomed);
  zoomButton.setAttribute('aria-pressed', String(zoomed));

  popovers.refresh((id) => id === 'bag');
  saveGame();
}

// ---------------------------------------------------------------- zoom (phones)

/** Scrolls the zoomed board so `key` is in view; `center` recentres even if it's already visible. */
function scrollToCell(key: number, center: boolean): void {
  if (!zoomed) return;
  const cell = boardEl.offsetWidth / BOARD_SIZE;
  const x = (colOf(key) + 0.5) * cell;
  const y = (rowOf(key) + 0.5) * cell;
  const { scrollLeft, scrollTop, clientWidth, clientHeight } = boardViewport;
  const margin = cell * 1.5;
  const visible =
    x - margin >= scrollLeft && x + margin <= scrollLeft + clientWidth && y - margin >= scrollTop && y + margin <= scrollTop + clientHeight;
  if (visible && !center) return;
  boardViewport.scrollTo({ left: x - clientWidth / 2, top: y - clientHeight / 2, behavior: 'smooth' });
}

function setZoom(on: boolean, focusKey?: number): void {
  const wasZoomed = zoomed;
  zoomed = on && compactLayout.matches;
  boardEl.classList.toggle('zoomed', zoomed);
  boardViewport.classList.toggle('zoomed', zoomed);
  zoomButton.setAttribute('aria-pressed', String(zoomed));
  if (!zoomed) boardViewport.scrollTo({ left: 0, top: 0 });
  else if (focusKey !== undefined) {
    // Jump (not smooth) when first zooming so the tapped square stays under the finger.
    const cell = boardEl.offsetWidth / BOARD_SIZE;
    const left = (colOf(focusKey) + 0.5) * cell - boardViewport.clientWidth / 2;
    const top = (rowOf(focusKey) + 0.5) * cell - boardViewport.clientHeight / 2;
    if (wasZoomed) scrollToCell(focusKey, false);
    else boardViewport.scrollTo({ left, top });
  }
}

/** The best square to centre on when zooming in without a specific target. */
function focusPoint(): number {
  if (cursor) return cursor.key;
  const keys = [...pending.keys()];
  if (keys.length) return keys[keys.length - 1];
  return cellKey(CENTER, CENTER);
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

/** Puts a rack tile on a square. Blanks ask for a letter unless `blankAs` is given. */
async function placeTile(rackIndex: number, key: number, blankAs?: string): Promise<boolean> {
  if (!isFree(key) || usedRackIndices().has(rackIndex)) return false;
  const tile = human().rack[rackIndex];
  let letter = tile;
  if (tile === BLANK) {
    const chosen = blankAs ?? (await chooseBlankLetter());
    if (!chosen || !isFree(key)) return false;
    letter = chosen;
  }
  pending.set(key, { rackIndex, letter, blank: tile === BLANK });
  selected = null;
  notice = '';
  return true;
}

/** Places a rack tile at the cursor and advances the cursor to the next free square. */
async function placeAtCursor(rackIndex: number, blankAs?: string): Promise<void> {
  if (!cursor) return;
  const { key, dir } = cursor;
  if (await placeTile(rackIndex, key, blankAs)) {
    const next = nextFree(key, dir);
    cursor = next === null ? null : { key: next, dir };
  }
  render();
  if (cursor) scrollToCell(cursor.key, false);
}

/** Takes a placed tile back to the rack; the cursor moves there so you can retype it. */
function takeBack(key: number): void {
  if (!pending.delete(key)) return;
  cursor = { key, dir: cursor?.dir ?? defaultDirection(key) };
  notice = '';
}

function moveWithinBoard(from: number, to: number): void {
  const tile = pending.get(from);
  if (!tile || !isFree(to)) return;
  pending.delete(from);
  pending.set(to, tile);
}

/** Backspace: remove the tile just behind the cursor (or the last one placed). */
function backspace(): void {
  if (cursor) {
    let k = step(cursor.key, cursor.dir, -1);
    while (k !== null && occupied(k)) k = step(k, cursor.dir, -1);
    if (k !== null && pending.has(k)) takeBack(k);
  } else {
    const keys = [...pending.keys()];
    if (keys.length) takeBack(keys[keys.length - 1]);
  }
  render();
}

function clearPlacement(): void {
  pending.clear();
  selected = null;
  cursor = null;
  swapping = null;
  notice = '';
}

function finishHumanTurn(action: () => void): void {
  try {
    action();
  } catch (err) {
    notice = (err as Error).message;
    render();
    return;
  }
  clearPlacement();
  lastAIMove = new Set();
  setZoom(false);
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
  void promptNewGame({
    title: you === them ? "It's a tie" : you > them ? 'You win!' : 'The AI wins',
    subtitle: `You ${you} — AI ${them}. Play again?`,
    cancellable: false,
  });
}

/**
 * Asks for a difficulty and starts a game with it. When `cancellable`, the
 * current game carries on if the player backs out.
 */
async function promptNewGame({ title = 'New game', subtitle = 'How tough should the AI be?', cancellable = false } = {}): Promise<void> {
  $('new-game-title').textContent = title;
  $('new-game-subtitle').textContent = subtitle;
  $('new-game-cancel').hidden = !cancellable;
  const last = readStoredDifficulty();
  for (const b of newGameDialog.querySelectorAll<HTMLButtonElement>('.difficulty-options button[value]')) {
    b.classList.toggle('last-used', b.value === last);
  }
  newGameDialog.returnValue = '';
  newGameDialog.showModal();
  newGameDialog.querySelector<HTMLButtonElement>(`button[value="${last}"]`)?.focus();
  const choice = await new Promise<string>((resolve) =>
    newGameDialog.addEventListener('close', () => resolve(newGameDialog.returnValue), { once: true }),
  );
  if (!DIFFICULTIES.includes(choice as Difficulty)) return; // cancelled
  try {
    localStorage.setItem(DIFFICULTY_KEY, choice);
  } catch {
    // ignore: we just won't remember it
  }
  startGame(new Game(dict, { difficulty: choice as Difficulty }));
}

function readStoredDifficulty(): Difficulty {
  try {
    const stored = localStorage.getItem(DIFFICULTY_KEY) as Difficulty | null;
    if (stored && DIFFICULTIES.includes(stored)) return stored;
  } catch {
    // fall through
  }
  return 'medium';
}

// Escape would close the dialog without a choice; only allow that when there's a game to go back to.
newGameDialog.addEventListener('cancel', (e) => {
  if ($('new-game-cancel').hidden) e.preventDefault();
});

function startGame(g: Game): void {
  game = g;
  clearPlacement();
  // Re-highlight the AI's last move when resuming.
  const last = game.history.at(-1);
  lastAIMove = new Set(last?.kind === 'play' && last.player.isAI ? last.move.placements.map((p) => cellKey(p.row, p.col)) : []);
  loggedTurns = -1;
  setSheetOpen(false);
  setZoom(false);
  afterTurn();
}

// ---------------------------------------------------------------- saving

/**
 * Saves the game to this browser's localStorage so a refresh doesn't lose it.
 * Tiles placed but not yet played aren't saved; they're simply back on the rack.
 * Storage can be unavailable (private mode, blocked site data), so failures are ignored.
 */
function saveGame(): void {
  try {
    if (game.over) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(game.toSnapshot()));
  } catch {
    // Not fatal: the game just won't survive a refresh.
  }
}

function loadSavedGame(): Game | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = new Game(dict, {}, JSON.parse(raw) as GameSnapshot);
    return saved.over ? null : saved;
  } catch (err) {
    console.warn('Discarding saved game:', err);
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

function setSheetOpen(open: boolean): void {
  document.body.classList.toggle('sheet-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
}

// ---------------------------------------------------------------- taps

boardEl.addEventListener('click', (e) => {
  if (!myTurn() || swapping) return;
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
  if (!cell) return;
  const key = Number(cell.dataset.key);
  if (pending.has(key)) {
    takeBack(key);
  } else if (occupied(key)) {
    return;
  } else if (selected !== null) {
    const index = selected;
    void placeTile(index, key).then(() => render());
    return;
  } else if (cursor?.key === key) {
    cursor = { key, dir: cursor.dir === 'across' ? 'down' : 'across' };
  } else {
    cursor = { key, dir: defaultDirection(key) };
  }
  if (!zoomed && compactLayout.matches) setZoom(true, key);
  render();
});

function onRackActivate(target: EventTarget | null): void {
  const tile = (target as HTMLElement).closest<HTMLElement>('.tile');
  if (!tile || !myTurn()) return;
  const index = Number(tile.dataset.index);
  if (swapping) {
    if (!swapping.delete(index)) swapping.add(index);
  } else if (cursor) {
    void placeAtCursor(index);
    return;
  } else {
    selected = selected === index ? null : index;
  }
  render();
}
rackEl.addEventListener('click', (e) => onRackActivate(e.target));
rackEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    onRackActivate(e.target);
  }
});

// A drag can end with a click on whatever was under the pointer; swallow that one click.
// Any new press starts a fresh gesture, so it clears the flag. Keyboard and programmatic
// clicks (detail 0) are never swallowed.
document.addEventListener('pointerdown', () => (suppressClick = false), true);
document.addEventListener(
  'click',
  (e) => {
    if (!suppressClick || e.detail === 0) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  },
  true,
);

// ---------------------------------------------------------------- dragging (mouse and touch)

function startDrag(e: PointerEvent, source: DragSource, tile: HTMLElement): void {
  if (!myTurn() || swapping || e.button !== 0) return;
  drag = { source, pointerId: e.pointerId, pointerType: e.pointerType, startX: e.clientX, startY: e.clientY, tile, ghost: null, target: null, slot: null };
  try {
    tile.setPointerCapture(e.pointerId);
  } catch {
    // Not an active pointer (e.g. synthetic events); document listeners still track it.
  }
}

rackEl.addEventListener('pointerdown', (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile');
  if (tile) startDrag(e, { kind: 'rack', index: Number(tile.dataset.index) }, tile);
});
boardEl.addEventListener('pointerdown', (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile.pending');
  if (tile) startDrag(e, { kind: 'cell', key: Number(tile.dataset.key) }, tile);
});

function setDropTarget(target: number | 'rack' | null): void {
  if (!drag || drag.target === target) return;
  boardEl.querySelector('.drop-target')?.classList.remove('drop-target');
  rackEl.classList.remove('drop-target');
  drag.target = target;
  if (target === 'rack') rackEl.classList.add('drop-target');
  else if (target !== null) boardEl.querySelector(`[data-key="${target}"]`)?.classList.add('drop-target');
}

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.ghost = drag.tile.cloneNode(true) as HTMLElement;
    drag.ghost.className = 'tile ghost';
    document.body.append(drag.ghost);
    drag.tile.classList.add('dragging');
    selected = null;
  }
  const lift = drag.pointerType === 'mouse' ? 0 : TOUCH_LIFT_PX;
  const x = e.clientX;
  const y = e.clientY - lift;
  drag.ghost.style.left = `${x}px`;
  drag.ghost.style.top = `${y}px`;

  // Finger on the rack means reordering. Otherwise a board square under the (lifted) tile
  // wins, and anywhere else in the dock still counts as the rack.
  const underFinger = document.elementFromPoint(e.clientX, e.clientY);
  const onRack = !!underFinger?.closest('#rack');
  const key = onRack ? null : cellAt(x, y);
  const overDock = onRack || [document.elementFromPoint(x, y), underFinger].some((el) => el?.closest('.dock'));
  if (key !== null) {
    const own = drag.source.kind === 'cell' && drag.source.key === key;
    setDropTarget(isFree(key) || own ? key : null);
    showRackGap(null);
  } else if (overDock) {
    setDropTarget('rack');
    showRackGap(rackSlotAt(x));
  } else {
    setDropTarget(null);
    showRackGap(null);
  }
});

/** Insertion index among the visible rack tiles for a pointer at screen x. */
function rackSlotAt(x: number): number {
  const tiles = [...rackEl.querySelectorAll<HTMLElement>('.tile:not(.dragging)')];
  return tiles.filter((t) => {
    const r = t.getBoundingClientRect();
    return r.left + r.width / 2 < x;
  }).length;
}

/** Opens a gap in the rack where the dragged tile would land. */
function showRackGap(slot: number | null): void {
  if (!drag || drag.slot === slot) return;
  drag.slot = slot;
  rackEl.querySelector('.rack-gap')?.remove();
  if (slot === null) return;
  const gap = document.createElement('div');
  gap.className = 'rack-gap';
  const tiles = rackEl.querySelectorAll('.tile:not(.dragging)');
  rackEl.insertBefore(gap, tiles[slot] ?? null);
}

/** The board square at a screen point, by geometry so the gaps between squares still count. */
function cellAt(x: number, y: number): number | null {
  const view = boardViewport.getBoundingClientRect();
  if (x < view.left || x >= view.right || y < view.top || y >= view.bottom) return null;
  const board = boardEl.getBoundingClientRect();
  const col = Math.floor(((x - board.left) / board.width) * BOARD_SIZE);
  const row = Math.floor(((y - board.top) / board.height) * BOARD_SIZE);
  return inBounds(row, col) ? cellKey(row, col) : null;
}

function endDrag(drop: boolean): void {
  if (!drag) return;
  const { source, target, ghost, slot } = drag;
  ghost?.remove();
  drag.tile.classList.remove('dragging');
  showRackGap(null);
  setDropTarget(null);
  drag = null;
  if (!ghost) return; // never moved far enough: it was a tap, handled by click

  suppressClick = true;
  if (!drop || target === null) {
    render();
    return;
  }
  if (source.kind === 'rack' && typeof target === 'number') {
    cursor = null;
    void placeTile(source.index, target).then((placed) => {
      if (placed && compactLayout.matches) setZoom(true, target);
      render();
    });
    return;
  }
  if (source.kind === 'cell' && typeof target === 'number') {
    moveWithinBoard(source.key, target);
  } else if (target === 'rack') {
    let index: number;
    if (source.kind === 'cell') {
      index = pending.get(source.key)!.rackIndex;
      pending.delete(source.key);
    } else {
      index = source.index;
    }
    if (slot !== null) moveInRack(index, slot);
  }
  render();
}

/** Moves one rack tile to `slot` among the visible tiles (tiles on the board stay hidden at the end). */
function moveInRack(index: number, slot: number): void {
  const used = usedRackIndices();
  const visible = human().rack.map((_, i) => i).filter((i) => i !== index && !used.has(i));
  visible.splice(slot, 0, index);
  applyRackOrder([...visible, ...used]);
}

/** Reorders the rack (`order` lists old indices in their new order), keeping placed tiles and selections pointing at the right tiles. */
function applyRackOrder(order: number[]): void {
  const rack = human().rack;
  const newIndex = new Map(order.map((oldIndex, i) => [oldIndex, i]));
  human().rack = order.map((i) => rack[i]);
  for (const p of pending.values()) p.rackIndex = newIndex.get(p.rackIndex)!;
  if (selected !== null) selected = newIndex.get(selected)!;
  if (swapping) swapping = new Set([...swapping].map((i) => newIndex.get(i)!));
}

document.addEventListener('pointerup', (e) => {
  if (drag && e.pointerId === drag.pointerId) endDrag(true);
});
document.addEventListener('pointercancel', (e) => {
  if (drag && e.pointerId === drag.pointerId) endDrag(false);
});

// ---------------------------------------------------------------- buttons

buttons.play.addEventListener('click', () => {
  if (swapping) {
    const tiles = [...swapping].map((i) => human().rack[i]);
    finishHumanTurn(() => game.exchange(tiles));
  } else {
    finishHumanTurn(() => game.play(pendingPlacements()));
  }
});

buttons.recall.addEventListener('click', () => {
  clearPlacement();
  setZoom(false);
  render();
});

buttons.shuffle.addEventListener('click', () => {
  // Shuffle the rack in place, keeping any tiles already on the board where they are.
  const order = human().rack.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  applyRackOrder(order);
  selected = null;
  render();
});

buttons.swap.addEventListener('click', () => {
  clearPlacement();
  swapping = new Set();
  setZoom(false);
  render();
});

buttons.pass.addEventListener('click', () => {
  if (confirm('Pass your turn?')) finishHumanTurn(() => game.pass());
});

zoomButton.addEventListener('click', () => {
  setZoom(!zoomed, focusPoint());
  render();
});

menuButton.addEventListener('click', () => setSheetOpen(!document.body.classList.contains('sheet-open')));
$('sheet-backdrop').addEventListener('click', () => setSheetOpen(false));
$('new-game').addEventListener('click', () => {
  setSheetOpen(false);
  void promptNewGame({ subtitle: 'This ends the current game. How tough should the AI be?', cancellable: true });
});
compactLayout.addEventListener('change', () => {
  setZoom(false);
  setSheetOpen(false);
  render();
});

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (document.body.classList.contains('sheet-open')) setSheetOpen(false);
    selected = null;
    cursor = null;
    render();
    return;
  }
  if (!myTurn()) return;
  if (e.key === 'Enter' && !buttons.play.disabled) {
    buttons.play.click();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    backspace();
  } else if (/^[a-z]$/i.test(e.key) && cursor && !swapping) {
    // Type to place: use the real tile if you have it, otherwise a blank.
    const letter = e.key.toUpperCase();
    const used = usedRackIndices();
    const free = (t: string) => human().rack.findIndex((r, i) => r === t && !used.has(i));
    const index = free(letter);
    if (index !== -1) void placeAtCursor(index);
    else if (free(BLANK) !== -1) void placeAtCursor(free(BLANK), letter);
  }
});

// ---------------------------------------------------------------- start

Dictionary.load(wordsUrl)
  .then((loaded) => {
    dict = loaded;
    const saved = loadSavedGame();
    if (saved) startGame(saved);
    else void promptNewGame({ title: 'Welcome to Outspell', subtitle: 'Pick how tough the AI should be.' });
  })
  .catch((err: Error) => {
    statusEl.textContent = err.message;
    statusEl.className = 'status error';
  });
