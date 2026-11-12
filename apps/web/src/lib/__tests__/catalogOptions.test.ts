/**
 * A row keeps a deactivated catalog item (#126): the picker lists it, marked, so the row shows what it
 * holds and saves it unchanged; a new row, with nothing chosen yet, gets no extra option.
 */

import { describe, expect, it } from 'vitest';

import { withHeldOption } from '../catalogOptions';

const active = [{ value: 'BOOT', label: 'BOOT' }, { value: 'MULE', label: 'Mule' }];

describe('withHeldOption', () => {
  it('lists a held value no active item has, marked as inactive', () => {
    expect(withHeldOption(active, 'SANDALO')).toEqual([...active, { value: 'SANDALO', label: 'SANDALO (non attiva)' }]);
  });

  it('lists a held value unmarked while the items are still loading', () => {
    expect(withHeldOption(undefined, 'BOOT')).toEqual([{ value: 'BOOT', label: 'BOOT' }]);
  });

  it('adds nothing for a held active value', () => {
    expect(withHeldOption(active, 'MULE')).toBe(active);
  });

  it('adds nothing for a new row', () => {
    for (const held of ['', null, undefined]) expect(withHeldOption(active, held)).toBe(active);
  });
});
