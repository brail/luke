import 'server-only';

import type { Section } from '@luke/core';

import { assertSectionAccess } from './assertSectionAccess';

import type { ReactNode } from 'react';

/**
 * The layout of a section folder: renders its pages only for a user who can see `section` (#217). A
 * parent is on as soon as one child is (ADR-027), so each sub-section folder needs its own. It runs when
 * the server renders the section, not between its own pages nor for a segment the client router serves
 * from its cache: a revocation reaches a user already inside at the next server render (a reload at the
 * latest). The data stays behind the API permissions. `sectionLayouts.test.ts` fails on a page left
 * without one.
 */
export function sectionLayout(section: Section) {
  return async function SectionLayout({ children }: { children: ReactNode }) {
    await assertSectionAccess(section);
    return children;
  };
}
