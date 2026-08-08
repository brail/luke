/**
 * `collectionLayoutRevision.create` produces only manual revisions, by construction.
 *
 * The input used to accept `cause` and `milestoneId`, and a guard in the router had to reject
 * the combinations reserved for the system — also checking the *name* of the revision type,
 * because `cause` defaulted to MANUAL and that alone wasn't enough. Now those fields aren't in
 * the input schema: the router always writes `cause: 'MANUAL'`, and there's nothing left to
 * reject. These tests pin down the property that replaced the guard — no input can get an
 * automatic revision created through this endpoint.
 *
 * Integration tier: the path goes through `resolveLayoutBrandAccess`, which reads the layout
 * from the database.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
let adminSession: UserSession;
let layoutId: string;

const asAdmin = () => createCallerWithSession(adminSession);

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();

  const admin = await createTestUser('admin');
  adminSession = admin.session;

  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `RC${uid}`, name: `Revision Brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `RC${uid}`, name: `Revision Season ${uid}`, year: 2034, isActive: true } }),
  ]);

  const layout = await asAdmin().collectionLayout.getOrCreate({
    brandId: brand.id,
    seasonId: season.id,
    availableGenders: ['UOMO'],
  });
  layoutId = layout.id;
});

describe('collectionLayoutRevision.create', () => {
  it('crea una revisione manuale, senza evento collegato', async () => {
    const revision = await asAdmin().collectionLayoutRevision.create({
      collectionLayoutId: layoutId,
      revisionTypeValue: 'REVISIONE_PROGETTUALE',
      notes: 'Revisione manuale di controllo',
    });

    expect(revision.revisionTypeValue).toBe('REVISIONE_PROGETTUALE');
    expect(revision.cause).toBe('MANUAL');
    expect(revision.milestoneId).toBeNull();
  });

  it('ignora cause e milestoneId anche se il client li manda lo stesso', async () => {
    // The cast is the point of the test: TypeScript already prevents passing those fields, here
    // we verify that not even an untyped client (direct HTTP) can force them through.
    const forged = {
      collectionLayoutId: layoutId,
      revisionTypeValue: 'REVISIONE_COSTRUTTIVA',
      cause: 'MILESTONE',
      milestoneId: randomUUID(),
    } as unknown as Parameters<ReturnType<typeof asAdmin>['collectionLayoutRevision']['create']>[0];

    const revision = await asAdmin().collectionLayoutRevision.create(forged);

    expect(revision.cause).toBe('MANUAL');
    expect(revision.milestoneId).toBeNull();
  });

  it('accetta un tipo di revisione che non esiste a catalogo', async () => {
    // No FK, no validation against the catalog: the pages print the string as-is. This is the
    // property that automatic revisions rely on, since they don't have (and shouldn't have) a
    // seeded entry.
    const revision = await asAdmin().collectionLayoutRevision.create({
      collectionLayoutId: layoutId,
      revisionTypeValue: 'TIPO_MAI_SEMINATO',
    });

    expect(revision.revisionTypeValue).toBe('TIPO_MAI_SEMINATO');
  });
});
