import { BOARD_SIZE } from './board.ts';

export interface TrieNode {
  children: Map<string, TrieNode>;
  terminal: boolean;
}

export class Dictionary {
  readonly root: TrieNode = { children: new Map(), terminal: false };
  private count = 0;

  constructor(words: Iterable<string>) {
    for (const raw of words) {
      const word = raw.trim().toUpperCase();
      if (word.length < 2 || word.length > BOARD_SIZE || !/^[A-Z]+$/.test(word)) continue;
      let node = this.root;
      for (const ch of word) {
        let next = node.children.get(ch);
        if (!next) {
          next = { children: new Map(), terminal: false };
          node.children.set(ch, next);
        }
        node = next;
      }
      if (!node.terminal) this.count++;
      node.terminal = true;
    }
  }

  /** Fetches a newline-separated word list (e.g. dictionary/enable1.txt). */
  static async load(url: string): Promise<Dictionary> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't load the dictionary (${response.status}).`);
    return new Dictionary((await response.text()).split('\n'));
  }

  get size(): number {
    return this.count;
  }

  has(word: string): boolean {
    let node: TrieNode | undefined = this.root;
    for (const ch of word.toUpperCase()) {
      node = node.children.get(ch);
      if (!node) return false;
    }
    return node.terminal;
  }
}
