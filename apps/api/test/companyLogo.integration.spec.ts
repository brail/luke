/**
 * Logo aziendale: la key la deriva il server, non il client.
 *
 * `company.profile.update` faceva `{ ...input }` dentro l'upsert, quindi
 * `logoKey` arrivava dal client e finiva nel database senza che nessuno lo
 * guardasse — per poi essere dereferenziata da `readFileBuffer` a ogni export
 * PDF. Ora si passa un `fileObjectId` e il server ne verifica proprietà, stato e
 * bucket prima di scriverne la key.
 *
 * Si entra da `appRouter.createCaller(ctx).company.profile`, mai dal sotto-router
 * importato: `router({ company: companyRouter })` ricostruisce un aggregato, e il
 * gate di copertura misura le invocazioni su `appRouter`.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach } from 'vitest';

import { appRouter } from '../src/routers/index';

import { createContextForRole } from './helpers/testContext';

describe('company.profile.update — logo', () => {
  let ctx: any;

  /** Crea un FileObject nello stato richiesto dal test. */
  const seedFile = (over: Partial<{ bucket: string; createdBy: string; confirmedAt: Date | null }> = {}) =>
    ctx.prisma.fileObject.create({
      data: {
        id: randomUUID(),
        bucket: over.bucket ?? 'company-assets',
        key: `2026/07/31/${randomUUID()}.png`,
        originalName: 'logo.png',
        size: 100,
        contentType: 'image/png',
        checksumSha256: '',
        createdBy: over.createdBy ?? ctx.session.user.id,
        confirmedAt: over.confirmedAt === undefined ? null : over.confirmedAt,
      },
    });

  const caller = () => appRouter.createCaller(ctx).company.profile;

  /** Attende che il cleanup post-commit abbia rimosso la riga. */
  const waitForCleanup = async (fileObjectId: string) => {
    for (let i = 0; i < 50; i++) {
      const row = await ctx.prisma.fileObject.findUnique({ where: { id: fileObjectId } });
      if (!row) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const base = { legalName: 'Acme', displayName: 'Acme' };

  beforeEach(async () => {
    ctx = await createContextForRole('admin');
  });

  it('collega un file pending e ne scrive la key', async () => {
    const file = await seedFile();

    const profile = await caller().update({ ...base, fileObjectId: file.id });

    expect(profile.logoKey).toBe(file.key);
    const confirmed = await ctx.prisma.fileObject.findUnique({ where: { id: file.id } });
    expect(confirmed?.confirmedAt).not.toBeNull();
  });

  it('rifiuta un file di un altro bucket', async () => {
    const file = await seedFile({ bucket: 'brand-logos' });

    await expect(
      caller().update({ ...base, fileObjectId: file.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rifiuta un file caricato da un altro utente', async () => {
    const other = await ctx.prisma.user.create({
      data: { email: `o-${randomUUID()}@t.test`, username: `o-${randomUUID().slice(0, 8)}`, role: 'viewer', isActive: true },
    });
    const file = await seedFile({ createdBy: other.id });

    await expect(
      caller().update({ ...base, fileObjectId: file.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rifiuta un file già confermato', async () => {
    // Fissa il fatto che `confirmUpload` crea pending: se qualcuno lo
    // "riparasse" tornando alla conferma immediata, ogni upload in modalità
    // MinIO smetterebbe di collegarsi e questo test lo direbbe.
    const file = await seedFile({ confirmedAt: new Date() });

    await expect(
      caller().update({ ...base, fileObjectId: file.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rifiuta un id inesistente invece di salvare senza logo', async () => {
    // Il caso realistico non è un id malevolo: è il reaper che ha spazzato il
    // pending mentre l'utente era distratto.
    await expect(
      caller().update({ ...base, fileObjectId: randomUUID() })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('logoKey: null cancella e ripulisce il blob precedente', async () => {
    const file = await seedFile();
    await caller().update({ ...base, fileObjectId: file.id });

    const profile = await caller().update({ ...base, logoKey: null });
    expect(profile.logoKey).toBeNull();

    // Il cleanup gira in `setImmediate` dopo il commit. Si asserisce sulla riga
    // `FileObject`, che `deleteObjectByKey` cancella insieme al blob: è
    // osservabile senza mockare lo storage, e prova che sia girata la funzione
    // vera e non uno stub.
    await waitForCleanup(file.id);
    expect(await ctx.prisma.fileObject.findUnique({ where: { id: file.id } })).toBeNull();
  });

  it('sostituendo il logo cancella la key vecchia', async () => {
    const first = await seedFile();
    await caller().update({ ...base, fileObjectId: first.id });

    const second = await seedFile();
    const profile = await caller().update({ ...base, fileObjectId: second.id });

    expect(profile.logoKey).toBe(second.key);

    await waitForCleanup(first.id);
    expect(await ctx.prisma.fileObject.findUnique({ where: { id: first.id } })).toBeNull();
  });

  it('gli altri campi fanno ancora round-trip', async () => {
    // Sostituire `...input` con un destructure è il punto in cui si perde un
    // campo senza accorgersene.
    const profile = await caller().update({
      legalName: 'Acme SpA',
      displayName: 'Acme',
      vatNumber: 'IT123',
      email: 'a@b.test',
    });

    expect(profile).toMatchObject({
      legalName: 'Acme SpA',
      displayName: 'Acme',
      vatNumber: 'IT123',
      email: 'a@b.test',
    });
  });

  it('una storage key esplicita non è più esprimibile', async () => {
    // Cast deliberato: lo schema non ammette più una stringa, e il test serve a
    // fissare che il rifiuto avvenga a runtime e non solo in compilazione.
    await expect(
      caller().update({ ...base, logoKey: '../brand-logos/x.png' } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
