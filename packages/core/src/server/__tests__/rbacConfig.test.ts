import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { effectiveSectionAccess } from '../../rbac/effectiveAccess.js';
import { SECTION_ACCESS_DEFAULTS } from '../../schemas/rbac.js';
import {
  getRbacConfig,
  invalidateRbacCache,
  mergeSectionAccessDefaults,
  setRbacConfigWarningHandler,
} from '../rbacConfig.js';

import type { IPrismaConfigClient } from '../../runtime/env.js';

/** A client whose AppConfig holds exactly `rows`, key → stored value. */
function clientWith(rows: Record<string, string>): IPrismaConfigClient {
  return {
    appConfig: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key in rows ? { key: where.key, value: rows[where.key], isEncrypted: false } : null,
    },
  } as unknown as IPrismaConfigClient;
}

/** What a user of `role` with no override gets on `section`, given the stored role map `stored`. */
async function sectionFor(role: string, section: Parameters<typeof effectiveSectionAccess>[0]['section'], stored?: unknown) {
  const rows: Record<string, string> =
    stored === undefined ? {} : { 'rbac.sectionAccessDefaults': typeof stored === 'string' ? stored : JSON.stringify(stored) };
  const { sectionAccessDefaults, disabledSections } = await getRbacConfig(clientWith(rows), { bypassCache: true });
  return effectiveSectionAccess({ role, sectionAccessDefaults, userOverrides: null, section, disabledSections });
}

beforeEach(() => invalidateRbacCache());
afterEach(() => setRbacConfigWarningHandler(undefined));

describe('getRbacConfig — the stored role map over the static table', () => {
  it('gives a section the stored map omits its static value, not the permission fallback', async () => {
    // `admin.brands` is denied to a viewer by the static table and granted by `brands:read`.
    expect(SECTION_ACCESS_DEFAULTS.viewer['admin.brands']).toBe(false);
    await expect(sectionFor('viewer', 'admin.brands', { viewer: { dashboard: 'enabled' } })).resolves.toBe(false);
  });

  it('ignores an invalid entry alone, keeping the valid denials of the same row', async () => {
    const stored = { viewer: { 'admin.brands': 'yes', 'product.pricing': 'disabled' } };
    await expect(sectionFor('viewer', 'admin.brands', stored)).resolves.toBe(false);
    await expect(sectionFor('viewer', 'product.pricing', stored)).resolves.toBe(false);
  });

  it('gives a role the code does not know nothing from the row', async () => {
    await expect(sectionFor('auditor', 'settings.users', { auditor: { 'settings.users': 'enabled' } })).resolves.toBe(false);
  });

  it('drops a section the code does not know and keeps the rest of the row', async () => {
    const stored = { viewer: { 'settings.brands': 'enabled', 'admin.brands': 'enabled' } };
    await expect(sectionFor('viewer', 'admin.brands', stored)).resolves.toBe(true);
  });

  it('reaches the permission fallback through an explicit auto', async () => {
    await expect(sectionFor('viewer', 'admin.brands', { viewer: { 'admin.brands': 'auto' } })).resolves.toBe(true);
  });

  it('falls back to the static table for an unparseable or non-object row', async () => {
    await expect(sectionFor('viewer', 'product.pricing', '{ not json')).resolves.toBe(true);
    await expect(sectionFor('viewer', 'admin.brands', '["viewer"]')).resolves.toBe(false);
    await expect(sectionFor('viewer', 'admin.brands', { viewer: 'enabled' })).resolves.toBe(false);
  });
});

describe('getRbacConfig — reporting what it ignored', () => {
  it('names the ignored entries, never their values', async () => {
    const handler = vi.fn();
    setRbacConfigWarningHandler(handler);

    await getRbacConfig(
      clientWith({
        'rbac.sectionAccessDefaults': JSON.stringify({ viewer: { 'admin.brands': 'secret-ish' }, editor: 42 }),
        'app.sections.disabled': 'nope',
      }),
      { bypassCache: true }
    );

    expect(handler).toHaveBeenCalledWith('rbac.sectionAccessDefaults', ['editor', 'viewer.admin.brands']);
    expect(handler).toHaveBeenCalledWith('app.sections.disabled', ['row']);
    expect(JSON.stringify(handler.mock.calls)).not.toContain('secret-ish');
  });

  it('reports nothing for a valid row', async () => {
    const handler = vi.fn();
    setRbacConfigWarningHandler(handler);
    await getRbacConfig(clientWith({ 'rbac.sectionAccessDefaults': JSON.stringify({ viewer: { 'admin.brands': 'enabled' } }) }), { bypassCache: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps the fallback when the handler throws', async () => {
    setRbacConfigWarningHandler(() => {
      throw new Error('logger down');
    });
    await expect(sectionFor('viewer', 'admin.brands', '{ not json')).resolves.toBe(false);
  });
});

describe('mergeSectionAccessDefaults', () => {
  it('merges per section, and gives every role every section', () => {
    const merged = mergeSectionAccessDefaults({ viewer: { 'admin.brands': 'enabled' } });
    expect(merged.viewer['admin.brands']).toBe('enabled');
    expect(merged.viewer['settings.users']).toBe('disabled');
    expect(merged.editor['product.pricing']).toBe('enabled');
    expect(Object.keys(merged.admin)).toHaveLength(Object.keys(SECTION_ACCESS_DEFAULTS.admin).length);
  });
});
