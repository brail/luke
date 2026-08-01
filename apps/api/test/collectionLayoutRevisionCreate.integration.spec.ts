/**
 * `collectionLayoutRevision.create` produce solo revisioni manuali, per costruzione.
 *
 * Prima l'input accettava `cause` e `milestoneId`, e un guard nel router doveva rifiutare le
 * combinazioni riservate al sistema — controllando anche il *nome* del tipo di revisione, perché
 * `cause` aveva default MANUAL e da sola non bastava. Ora quei campi non sono nello schema di
 * input: il router scrive sempre `cause: 'MANUAL'`, e non c'è più niente da rifiutare. Questi test
 * fissano la proprietà che ha sostituito il guard — nessun input riesce a farsi creare una
 * revisione automatica da questo endpoint.
 *
 * Tier integration: il percorso passa da `resolveLayoutBrandAccess`, che legge il layout dal
 * database.
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
    // Il cast è il punto del test: TypeScript già impedisce di passare quei campi, qui si
    // verifica che nemmeno un client non tipizzato (HTTP diretto) riesca a forzarli.
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
    // Nessun FK, nessuna validazione contro il catalogo: le pagine stampano la stringa così
    // com'è. È la proprietà su cui si appoggiano le revisioni automatiche, che non hanno (e non
    // devono avere) una voce seminata.
    const revision = await asAdmin().collectionLayoutRevision.create({
      collectionLayoutId: layoutId,
      revisionTypeValue: 'TIPO_MAI_SEMINATO',
    });

    expect(revision.revisionTypeValue).toBe('TIPO_MAI_SEMINATO');
  });
});
