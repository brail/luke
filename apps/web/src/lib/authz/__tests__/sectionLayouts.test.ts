/**
 * Every page of the signed-in app is guarded by the section it belongs to (#217): a sub-section
 * page by its own layout, not only by its parent's, so a sub-section turned off cannot be opened by
 * URL. A new page with no guard, or the wrong one, fails here.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Section } from '@luke/core';

import { leafSections } from '../../sectionTree';

const APP = fileURLToPath(new URL('../../../app/(app)/', import.meta.url));

/** Pages open to every signed-in user. `dashboard` is also where a denied section lands. */
const GENERAL_PAGES = new Set(['about', 'dashboard', 'notifications', 'profile']);

/** Top-level folders that are a section without children. */
const LEAF_FOLDERS: Partial<Record<string, Section>> = { calendar: 'planning' };

const LEAVES = new Set<string>(leafSections());

/** The guard a page needs: the layout folder that must check it, and the leaf it must check. */
function guardFor(pageDir: string): { layoutDir: string; leaf: string } {
  const [top, segment] = pageDir.split(sep);
  const leafFolder = LEAF_FOLDERS[top];
  if (leafFolder) return { layoutDir: top, leaf: leafFolder };
  // `/settings/nav-sync` → `settings.nav_sync`; deeper pages share their sub-section's layout.
  return { layoutDir: join(top, segment ?? ''), leaf: `${top}.${(segment ?? '').replaceAll('-', '_')}` };
}

const pageDirs = readdirSync(APP, { recursive: true, encoding: 'utf8' })
  .filter(path => path.endsWith(`${sep}page.tsx`) || path === 'page.tsx')
  .map(dirname)
  .filter(dir => !GENERAL_PAGES.has(dir.split(sep)[0]));

describe('section guards of the app pages', () => {
  it('finds the sectioned pages', () => {
    expect(pageDirs.length).toBeGreaterThan(20);
  });

  it.each(pageDirs)('%s is guarded by its own section', pageDir => {
    const { layoutDir, leaf } = guardFor(pageDir);
    expect(LEAVES.has(leaf), `${pageDir} maps to ${leaf}, which is not a section without children`).toBe(true);

    const layout = readFileSync(join(APP, layoutDir, 'layout.tsx'), 'utf8');
    const guarded = [...layout.matchAll(/sectionLayout\('([^']+)'\)/g)].map(m => m[1]);
    expect(guarded).toContain(leaf);
  });

  it('gives every section without children a page, the dashboard aside', () => {
    const covered = new Set(pageDirs.map(dir => guardFor(dir).leaf));
    const uncovered = leafSections().filter(section => section !== 'dashboard' && !covered.has(section));
    expect(uncovered).toEqual([]);
  });
});
