/**
 * Fixed-width (1-3 char) uppercase initials from a name, e.g. "Uomo" → "U",
 * "Bimbo Ragazza" → "BR". Used as a compact badge so a label never crowds out
 * adjacent content regardless of how long the source name is.
 */
export function initials(name: string, maxWords = 3): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).map(w => w[0]!.toUpperCase()).join('');
}
