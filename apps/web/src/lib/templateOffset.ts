/**
 * The offset a milestone template proposes for a new item of a phase that takes `durationDays`
 * calendar days (#158): the furthest offset among the template's phase items — 0 when it has none —
 * plus that duration. Null when the phase declares no duration: nothing to propose.
 */
export function suggestedTemplateOffset(
  items: { phaseId: string | null; offsetDays: number }[],
  durationDays: number | null | undefined,
): number | null {
  if (!durationDays) return null;
  const phaseOffsets = items.filter(item => item.phaseId).map(item => item.offsetDays);
  return (phaseOffsets.length > 0 ? Math.max(...phaseOffsets) : 0) + durationDays;
}
