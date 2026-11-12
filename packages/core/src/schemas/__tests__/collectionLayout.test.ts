/**
 * A layout's genders and a row's gender are persisted as plain strings, and the row is checked
 * against the layout's list. Both inputs accepted any string, so a layout could be created with
 * genders the rest of the app does not know.
 */
import { describe, expect, it } from 'vitest';

import {
  COLLECTION_COLUMNS_DEFAULT_HIDDEN,
  COLLECTION_COLUMNS_MAX_VISIBLE,
  COLLECTION_TABLE_COLUMNS,
  CollectionLayoutRowInputSchema,
  CollectionLayoutSettingsSchema,
} from '../collectionLayout.js';

const hidden = CollectionLayoutSettingsSchema.shape.hiddenColumns;
/** Hides the first columns, in table order, so that `visible` stay visible. */
const hideToLeaveVisible = (visible: number) =>
  COLLECTION_TABLE_COLUMNS.slice(0, COLLECTION_TABLE_COLUMNS.length - visible).map(c => c.key);

describe('collection layout hidden columns (#118)', () => {
  it('accepts only column keys', () => {
    expect(hidden.safeParse([...hideToLeaveVisible(7).slice(1), 'dutyCategory']).success).toBe(false);
  });

  it('does not list a column twice', () => {
    const six = hideToLeaveVisible(7);
    expect(hidden.safeParse([...six, six[0]]).success).toBe(false);
  });

  it(`leaves at most ${COLLECTION_COLUMNS_MAX_VISIBLE} columns visible`, () => {
    expect(hidden.safeParse(hideToLeaveVisible(COLLECTION_COLUMNS_MAX_VISIBLE)).success).toBe(true);
    expect(hidden.safeParse(hideToLeaveVisible(COLLECTION_COLUMNS_MAX_VISIBLE + 1)).success).toBe(false);
    expect(hidden.safeParse(hideToLeaveVisible(0)).success).toBe(true);
  });

  it('null means the defaults, which the schema accepts', () => {
    expect(hidden.safeParse(null).success).toBe(true);
    expect(hidden.safeParse([...COLLECTION_COLUMNS_DEFAULT_HIDDEN]).success).toBe(true);
  });
});

describe('collection layout genders', () => {
  it('a layout accepts only COLLECTION_GENDER values', () => {
    expect(CollectionLayoutSettingsSchema.safeParse({ availableGenders: ['MAN', 'WOMAN'] }).success).toBe(true);
    expect(CollectionLayoutSettingsSchema.safeParse({ availableGenders: ['UOMO'] }).success).toBe(false);
  });

  it('a layout does not list a gender twice', () => {
    expect(CollectionLayoutSettingsSchema.safeParse({ availableGenders: ['MAN', 'MAN'] }).success).toBe(false);
  });

  it('a row accepts only COLLECTION_GENDER values', () => {
    const gender = CollectionLayoutRowInputSchema.shape.gender;
    expect(gender.safeParse('WOMAN').success).toBe(true);
    expect(gender.safeParse('UOMO').success).toBe(false);
  });
});
