/**
 * A layout's genders and a row's gender are persisted as plain strings, and the row is checked
 * against the layout's list. Both inputs accepted any string, so a layout could be created with
 * genders the rest of the app does not know.
 */
import { describe, expect, it } from 'vitest';

import { CollectionLayoutRowInputSchema, CollectionLayoutSettingsSchema } from '../collectionLayout.js';

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
