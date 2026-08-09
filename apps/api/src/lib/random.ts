/**
 * Returns one random element from a non-empty array.
 */
export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
