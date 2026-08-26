/**
 * Company logo: the key is derived by the server, not the client.
 *
 * `company.profile.update` used to do `{ ...input }` inside the upsert, so
 * `logoKey` came in from the client and ended up in the database with nobody
 * checking it — only to be dereferenced by `readFileBuffer` on every PDF
 * export. Now a `fileObjectId` is passed and the server verifies its
 * ownership, state, and bucket before writing the key.
 *
 * Enter through `appRouter.createCaller(ctx).company.profile`, never through the
 * imported sub-router: `router({ company: companyRouter })` rebuilds an
 * aggregate, and the coverage gate measures invocations on `appRouter`.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach } from 'vitest';

import { appRouter } from '../src/routers/index';

import { createContextForRole } from './helpers/testContext';

describe('company.profile.update — logo', () => {
  let ctx: any;

  /** Creates a FileObject in the state required by the test. */
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

  /** Waits for the post-commit cleanup to have removed the row. */
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
    // Pins down the fact that `confirmUpload` creates pending: if someone
    // "fixed" it by going back to immediate confirmation, every upload in
    // S3 mode would stop linking, and this test would say so.
    const file = await seedFile({ confirmedAt: new Date() });

    await expect(
      caller().update({ ...base, fileObjectId: file.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rifiuta un id inesistente invece di salvare senza logo', async () => {
    // The realistic case isn't a malicious id: it's the reaper that swept away
    // the pending row while the user was distracted.
    await expect(
      caller().update({ ...base, fileObjectId: randomUUID() })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('logoKey: null cancella e ripulisce il blob precedente', async () => {
    const file = await seedFile();
    await caller().update({ ...base, fileObjectId: file.id });

    const profile = await caller().update({ ...base, logoKey: null });
    expect(profile.logoKey).toBeNull();

    // The cleanup runs in `setImmediate` after the commit. We assert on the
    // `FileObject` row, which `deleteObjectByKey` deletes together with the blob:
    // it's observable without mocking storage, and proves the real function ran
    // and not a stub.
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
    // Replacing `...input` with a destructure is the point where a field gets
    // lost without anyone noticing.
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
    // Deliberate cast: the schema no longer accepts a plain string, and the test
    // pins down that the rejection happens at runtime and not just at compile time.
    await expect(
      caller().update({ ...base, logoKey: '../brand-logos/x.png' } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
