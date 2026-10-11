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

  /** Fetches newline-separated word lists and combines them into one dictionary. */
  static async load(...urls: string[]): Promise<Dictionary> {
    const texts = await Promise.all(
      urls.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Couldn't load the dictionary (${response.status}).`);
        return response.text();
      }),
    );
    return new Dictionary(texts.flatMap((text) => text.split('\n')));
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
