import { describe, expect, it } from 'vitest';

import { suggestedTemplateOffset } from '../templateOffset';

describe('suggestedTemplateOffset', () => {
  it("follows #158's example: Design takes 30 days, then Prototype 20", () => {
    expect(suggestedTemplateOffset([], 30)).toBe(30);
    expect(suggestedTemplateOffset([{ phaseId: 'design', offsetDays: 30 }], 20)).toBe(50);
  });

  it('starts from the furthest phase item, whatever the order, and ignores items with no phase', () => {
    const items = [
      { phaseId: 'b', offsetDays: 40 },
      { phaseId: 'a', offsetDays: 10 },
      { phaseId: null, offsetDays: 90 },
    ];
    expect(suggestedTemplateOffset(items, 5)).toBe(45);
  });

  it('proposes nothing for a phase with no duration', () => {
    expect(suggestedTemplateOffset([{ phaseId: 'a', offsetDays: 10 }], null)).toBeNull();
    expect(suggestedTemplateOffset([], undefined)).toBeNull();
  });
});
