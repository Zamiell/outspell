/** Word definitions from Wiktionary's REST API (https://en.wiktionary.org/api/rest_v1/). */

export interface Definition {
  meanings: { partOfSpeech: string; definition: string }[];
}

const API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const MAX_MEANINGS = 3;
const TIMEOUT_MS = 8000;
const cache = new Map<string, Promise<Definition | null>>();

interface WiktionaryEntry {
  partOfSpeech: string;
  language: string;
  definitions: { definition: string }[];
}

/** Resolves to null if Wiktionary has no English entry; rejects on network failure. */
export function define(word: string): Promise<Definition | null> {
  const key = word.toLowerCase();
  let result = cache.get(key);
  if (!result) {
    result = lookup(key);
    result.catch(() => cache.delete(key)); // let a later attempt retry
    cache.set(key, result);
  }
  return result;
}

async function lookup(word: string): Promise<Definition | null> {
  const response = await fetch(API + encodeURIComponent(word), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Dictionary lookup failed (${response.status})`);
  const data = (await response.json()) as Record<string, WiktionaryEntry[]>;
  const meanings = (data.en ?? [])
    .filter((entry) => entry.language === 'English')
    .flatMap((entry) =>
      entry.definitions.map((d) => ({ partOfSpeech: entry.partOfSpeech.toLowerCase(), definition: toText(d.definition) })),
    )
    .filter((m) => m.definition)
    .slice(0, MAX_MEANINGS);
  return meanings.length ? { meanings } : null;
}

/** Definitions arrive as HTML; keep only the text. */
function toText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
