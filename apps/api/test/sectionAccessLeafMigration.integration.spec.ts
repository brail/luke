/**
 * Migration `20261001220553_section_access_leaf_overrides` (ADR-027): rewrites section-access data
 * written while a parent section decided on its own, so every user keeps the parent-and-child
 * visibility they had once parents are derived from their children.
 *
 * Each test seeds rows inside one transaction, runs the migration file there, reads the result and
 * rolls back: the test database already holds the migration, and nothing here outlives the test.
 * The expected rows are written out literally, from the migration's own frozen view of the
 * sections, so a later change to the enum or the permissions does not move them.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PRISMA_MIGRATIONS_DIR } from '@luke/db';

import { createTestUser, setupTestDb } from './helpers';

const MIGRATION = readFileSync(
  join(PRISMA_MIGRATIONS_DIR, '20261001220553_section_access_leaf_overrides', 'migration.sql'),
  'utf8'
);

/** `sectionEnum` as the migration froze it. */
const SECTIONS = [
  'dashboard', 'settings', 'settings.users', 'settings.storage', 'settings.mail', 'settings.ldap',
  'settings.nav', 'settings.nav_sync', 'settings.google', 'settings.collection_control',
  'maintenance', 'maintenance.config', 'maintenance.import_export', 'maintenance.backup',
  'maintenance.mode', 'maintenance.audit_log', 'product', 'product.pricing',
  'product.collection_layout', 'product.merchandising_plan', 'product.control', 'admin',
  'admin.brands', 'admin.seasons', 'admin.vendors', 'admin.collection_layout_configuration',
  'admin.calendar_configuration', 'admin.phase_catalog', 'sales', 'sales.statistics', 'planning',
  'settings.company',
];
const childrenOf = (parent: string) => SECTIONS.filter(s => s.startsWith(`${parent}.`));
const all = (children: string[], enabled: boolean) =>
  Object.fromEntries(children.map(child => [child, enabled]));

let client: Client;

beforeEach(async () => {
  await setupTestDb();
  client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
});

afterEach(async () => {
  await client.query('ROLLBACK');
  await client.end();
});

async function override(userId: string, section: string, enabled: boolean) {
  await client.query(
    `INSERT INTO user_section_access (id, "userId", section, enabled, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())`,
    [userId, section, enabled]
  );
}

async function storeConfig(key: string, value: string, isEncrypted = false) {
  await client.query(
    `INSERT INTO app_configs (id, key, value, "isEncrypted", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())`,
    [key, value, isEncrypted]
  );
}

const migrate = () => client.query(MIGRATION);

/** Every override of the user after the migration, section → enabled. */
async function overridesOf(userId: string): Promise<Record<string, boolean>> {
  const { rows } = await client.query<{ section: string; enabled: boolean }>(
    'SELECT section, enabled FROM user_section_access WHERE "userId" = $1',
    [userId]
  );
  return Object.fromEntries(rows.map(row => [row.section, row.enabled]));
}

async function configRow(key: string) {
  const { rows } = await client.query<{ value: string; isEncrypted: boolean }>(
    'SELECT value, "isEncrypted" FROM app_configs WHERE key = $1',
    [key]
  );
  return rows[0];
}

/** A rewritten role map: every section `'auto'` unless `entries` says otherwise. */
const roleMap = (entries: Record<string, string>) => ({
  ...Object.fromEntries(SECTIONS.map(section => [section, 'auto'])),
  ...entries,
});
const disabled = (...parents: string[]) =>
  Object.fromEntries(parents.flatMap(childrenOf).map(child => [child, 'disabled']));

describe('without a stored role map (static role gates)', () => {
  it('a parent switched off closes every child explicitly, whatever the child said', async () => {
    const { user: viewer } = await createTestUser('viewer');
    const { user: admin } = await createTestUser('admin');
    await override(viewer.id, 'admin', false);
    await override(viewer.id, 'admin.brands', true);
    await override(admin.id, 'settings', false); // administrators follow the same rule

    await migrate();

    expect(await overridesOf(viewer.id)).toEqual(all(childrenOf('admin'), false));
    expect(await overridesOf(admin.id)).toEqual(all(childrenOf('settings'), false));
  });

  it('a parent switched on is deleted, the child overrides under it stay', async () => {
    const { user: withChild } = await createTestUser('viewer');
    const { user: parentOnly } = await createTestUser('viewer');
    await override(withChild.id, 'admin', true);
    await override(withChild.id, 'admin.brands', true);
    await override(parentOnly.id, 'admin', true);

    await migrate();

    expect(await overridesOf(withChild.id)).toEqual({ 'admin.brands': true });
    // The viewer's static table closes `admin` and every child: nothing was reachable, nothing added.
    expect(await overridesOf(parentOnly.id)).toEqual({});
  });

  it('a child switched on under a parent the role closes is deleted; other child overrides stay', async () => {
    const { user: viewerOn } = await createTestUser('viewer');
    const { user: viewerOff } = await createTestUser('viewer');
    const { user: editor } = await createTestUser('editor');
    await override(viewerOn.id, 'admin.brands', true);
    await override(viewerOff.id, 'admin.brands', false);
    await override(editor.id, 'product.pricing', true); // `product` is open for an editor

    await migrate();

    expect(await overridesOf(viewerOn.id)).toEqual({});
    expect(await overridesOf(viewerOff.id)).toEqual({ 'admin.brands': false });
    expect(await overridesOf(editor.id)).toEqual({ 'product.pricing': true });
  });

  it('leaves sections without a parent and the kill switch alone', async () => {
    const { user: viewer } = await createTestUser('viewer');
    await override(viewer.id, 'dashboard', false);
    await override(viewer.id, 'planning', true);
    await storeConfig('app.sections.disabled', '["settings.storage"]');

    await migrate();

    expect(await overridesOf(viewer.id)).toEqual({ dashboard: false, planning: true });
    expect(await configRow('app.sections.disabled')).toEqual({
      value: '["settings.storage"]',
      isEncrypted: false,
    });
    expect(await configRow('rbac.sectionAccessDefaults')).toBeUndefined();
  });
});

describe('with a stored role map', () => {
  it('reads a role it holds from it, with the permission fallback for the rest, and rewrites it', async () => {
    await storeConfig(
      'rbac.sectionAccessDefaults',
      JSON.stringify({
        viewer: {
          admin: 'auto', // `maintenance:read`: closed for a viewer
          'admin.seasons': 'enabled',
          settings: 'enabled',
          'settings.storage': 'auto', // `config:read`, taken from viewers by this release: closed
          dashboard: 'bogus',
          'settings.brands': 'enabled', // a pre-2.0 section
        },
        editor: 'not-an-object', // read as the permission fallback for every section
        auditor: { settings: 'enabled' }, // a role no user can hold
      })
    );
    const { user: viewerParentOn } = await createTestUser('viewer');
    const { user: viewerParentOnChildOff } = await createTestUser('viewer');
    const { user: viewerSettingsOn } = await createTestUser('viewer');
    const { user: viewerChildOn } = await createTestUser('viewer');
    const { user: editorParentOn } = await createTestUser('editor');
    await override(viewerParentOn.id, 'admin', true);
    await override(viewerParentOnChildOff.id, 'admin', true);
    await override(viewerParentOnChildOff.id, 'admin.brands', false);
    await override(viewerSettingsOn.id, 'settings', true);
    await override(viewerChildOn.id, 'admin.brands', true);
    await override(editorParentOn.id, 'admin', true);

    await migrate();

    // Case v: the parent override kept every child the role opens reachable; the rewrite closes
    // them for the role, so the user gets them explicitly. All six are open for a viewer here:
    // `admin.seasons` by the map, the other five by their permission.
    expect(await overridesOf(viewerParentOn.id)).toEqual(all(childrenOf('admin'), true));
    // A child override of its own is kept as it is, and not written twice.
    expect(await overridesOf(viewerParentOnChildOff.id)).toEqual({
      ...all(childrenOf('admin'), true),
      'admin.brands': false,
    });
    // The map opens `settings` for a viewer: the role default already gives what was reachable.
    expect(await overridesOf(viewerSettingsOn.id)).toEqual({});
    // Case iii with the gate closed by the map.
    expect(await overridesOf(viewerChildOn.id)).toEqual({});
    // A role whose value is not an object reads the permission fallback, which opens the six.
    expect(await overridesOf(editorParentOn.id)).toEqual(all(childrenOf('admin'), true));

    const stored = await configRow('rbac.sectionAccessDefaults');
    expect(stored?.isEncrypted).toBe(false);
    expect(JSON.parse(stored!.value)).toEqual({
      viewer: roleMap({
        settings: 'enabled',
        ...disabled('admin', 'maintenance'),
      }),
      editor: roleMap(disabled('settings', 'maintenance', 'admin')),
    });
  });

  it('keeps a role it does not hold on the static table, and does not add it', async () => {
    await storeConfig('rbac.sectionAccessDefaults', JSON.stringify({ viewer: { 'admin.brands': 'disabled' } }));
    const { user: editor } = await createTestUser('editor');
    await override(editor.id, 'admin', true);

    await migrate();

    // The static table closes `admin` and its children for an editor: nothing to insert.
    expect(await overridesOf(editor.id)).toEqual({});
    expect(Object.keys(JSON.parse((await configRow('rbac.sectionAccessDefaults'))!.value))).toEqual(['viewer']);
  });

  it('reads a value flagged as encrypted like any other, and clears the flag', async () => {
    await storeConfig('rbac.sectionAccessDefaults', JSON.stringify({ viewer: { admin: 'enabled' } }), true);
    const { user: viewer } = await createTestUser('viewer');
    await override(viewer.id, 'admin', true);

    await migrate();

    expect(await overridesOf(viewer.id)).toEqual({}); // the map opened `admin`: nothing to insert
    const stored = await configRow('rbac.sectionAccessDefaults');
    expect(stored?.isEncrypted).toBe(false);
    expect(JSON.parse(stored!.value).viewer.admin).toBe('enabled');
  });

  it.each([
    ['not JSON (ciphertext included)', '9f86d081884c7d65', true],
    ['JSON but not an object', '["viewer"]', false],
  ])('deletes a row the old reader could not use: %s', async (_label, value, isEncrypted) => {
    await storeConfig('rbac.sectionAccessDefaults', value, isEncrypted);
    const { user: viewer } = await createTestUser('viewer');
    await override(viewer.id, 'admin', true);

    await migrate();

    expect(await configRow('rbac.sectionAccessDefaults')).toBeUndefined();
    expect(await overridesOf(viewer.id)).toEqual({});
  });
});
