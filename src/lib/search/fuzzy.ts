/**
 * Search that forgives spelling.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A TYPO MUST NOT RETURN NOTHING.
 *
 *  People type dish names the way they say them: "ndole" for Ndolé, "koky"
 *  for Koki, "achou" for Achu, "poulet dj" for Poulet DG — on a phone, with
 *  autocorrect fighting them. An exact substring match answered all of those
 *  with an empty page, and an empty page reads as "this app has nothing".
 *
 *  So matching is in three layers, cheapest first:
 *    1. accents, case and punctuation never matter ("ndole" = "Ndolé");
 *    2. a word within a small edit distance of a word in the text, or one
 *       that SOUNDS the same once common spelling swaps are folded
 *       (c/k, ou/u, y/i, ph/f, silent h, doubled letters);
 *    3. the whole query against the whole text with the spaces taken out
 *       ("pouletdj" ≈ "poulet dg").
 *  Exact matches always come first; similar ones are offered when there are
 *  no exact ones, and the screen says they are "close", not "the answer".
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Lower case, no accents, "&" read as "et", anything else not a letter or digit becomes a space. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** How a word sounds, roughly: the swaps French and Cameroonian spellings make. */
export function soundKey(word: string): string {
  return word
    .replace(/ph/g, "f")
    .replace(/qu/g, "k")
    .replace(/ck/g, "k")
    .replace(/c(?=[aou]|$)/g, "k")
    .replace(/ou/g, "u")
    .replace(/y/g, "i")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/e$/, "");
}

/** Optimal-string-alignment distance (Damerau: a swapped pair costs one). Stops early past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    rows.push(row);
  }
  return rows[a.length][b.length];
}

/** Edits forgiven for a word of this length: none for 1–3 letters, then 1, 2, 3. */
function allowance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 8) return 2;
  return 3;
}

function wordScore(query: string, word: string): number {
  if (word === query) return 1;
  if (query.length >= 2 && word.startsWith(query)) return 0.95;
  if (query.length >= 3 && word.includes(query)) return 0.9;
  const distance = editDistance(query, word, allowance(Math.max(query.length, word.length)));
  if (distance <= allowance(Math.max(query.length, word.length))) return 0.85 - 0.08 * distance;
  const qs = soundKey(query);
  const ws = soundKey(word);
  if (qs.length >= 2 && qs === ws) return 0.82;
  const soundDistance = editDistance(qs, ws, allowance(Math.max(qs.length, ws.length)));
  if (soundDistance <= allowance(Math.max(qs.length, ws.length))) return 0.72 - 0.06 * soundDistance;
  return 0;
}

/** 0 (unrelated) … 1 (contains the query exactly). */
export function matchScore(query: string, text: string): number {
  const q = normalizeText(query);
  const t = normalizeText(text);
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;

  const words = t.split(" ");
  const queryWords = q.split(" ");
  const perWord = queryWords.map((qw) => Math.max(0, ...words.map((w) => wordScore(qw, w))));
  const byWords = perWord.reduce((sum, score) => sum + score, 0) / perWord.length;

  // The whole thing, spaces out: catches split or joined words ("pouletdj").
  const qc = q.replace(/ /g, "");
  const tc = t.replace(/ /g, "");
  const compactDistance = editDistance(qc, tc, allowance(Math.max(qc.length, tc.length)));
  const compact = compactDistance <= allowance(Math.max(qc.length, tc.length)) ? 0.85 - 0.08 * compactDistance : 0;

  return Math.max(byWords, compact);
}

/** True when `text` contains the query once accents, case and punctuation are set aside. */
export function containsQuery(text: string, query: string): boolean {
  const q = normalizeText(query);
  return q.length > 0 && normalizeText(text).includes(q);
}

export interface FuzzyResult<T> {
  /** Items that contain the query (accents and case aside). */
  exact: T[];
  /** Only when there is no exact match: the closest items, best first. */
  similar: T[];
}

/**
 * Split items into exact and similar matches. `texts` lists what an item can
 * be found by (its name, its dishes, its neighbourhood…).
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  texts: (item: T) => string[],
  { threshold = 0.65, limit = 24 }: { threshold?: number; limit?: number } = {},
): FuzzyResult<T> {
  if (!normalizeText(query)) return { exact: items, similar: [] };
  const exact = items.filter((item) => texts(item).some((text) => containsQuery(text, query)));
  if (exact.length > 0) return { exact, similar: [] };

  const similar = items
    .map((item) => ({ item, score: Math.max(0, ...texts(item).map((text) => matchScore(query, text))) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
  return { exact: [], similar };
}
