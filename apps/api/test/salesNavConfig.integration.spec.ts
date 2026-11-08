/**
 * The portafoglio's direct NAV reads answer a broken configuration as the NAV settings page does.
 *
 * With the replica empty, `getFilters` and `download` fall back to NAV. An incomplete
 * configuration used to answer a masked 500 (`download`) or an empty list logged as an unreachable
 * server (`getFilters`), and `getFilters` swallowed a stored value that does not decrypt. Only an
 * unreachable server degrades `getFilters` to the empty list (#213).
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as nav from '@luke/nav';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: Awaited<ReturnType<typeof setupTestDb>>;
let ids: { brandId: string; seasonId: string };

const NAV_ROWS = {
  'integrations.nav.host': 'nav.test',
  'integrations.nav.database': 'NAV',
  'integrations.nav.user': 'u',
  'integrations.nav.password': 'p',
  'integrations.nav.company': 'C',
};
const INCOMPLETE = { code: 'PRECONDITION_FAILED', message: expect.stringMatching(/^Configurazione NAV incompleta/) };
const UNREADABLE = { code: 'BAD_REQUEST', message: 'Un valore salvato non è leggibile: inseriscilo di nuovo e salva.' };

const store = (rows: Record<string, string>, encrypted: string[] = []) =>
  prisma.appConfig.createMany({
    data: Object.entries(rows).map(([key, value]) => ({ key, value, isEncrypted: encrypted.includes(key) })),
  });

beforeEach(async () => {
  prisma = await setupTestDb();
  await prisma.appConfig.deleteMany({ where: { key: { startsWith: 'integrations.nav.' } } });
  const uid = randomUUID().slice(0, 6).toUpperCase();
  // No replica rows for this pair: both procedures take the direct NAV path.
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `SN${uid}`, name: `Sales ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `S${uid}`, name: `Season ${uid}`, isActive: true } }),
  ]);
  ids = { brandId: brand.id, seasonId: season.id };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ['getFilters', async () => (await createCallerAs('admin')).sales.statistics.portafoglio.getFilters(ids)],
  ['download', async () => (await createCallerAs('admin')).sales.statistics.portafoglio.download(ids)],
] as const)('sales.statistics.portafoglio.%s on the direct NAV path', (_name, call) => {
  it('answers an incomplete configuration with the settings page text, connecting to nothing', async () => {
    const getPool = vi.spyOn(nav, 'getPool');
    await expect(call()).rejects.toMatchObject(INCOMPLETE);
    expect(getPool).not.toHaveBeenCalled();
  });

  it('refuses an invalid stored port, connecting to nothing', async () => {
    const getPool = vi.spyOn(nav, 'getPool');
    await store({ ...NAV_ROWS, 'integrations.nav.port': 'not-a-port' });
    await expect(call()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringMatching(/^La porta NAV salvata/) });
    expect(getPool).not.toHaveBeenCalled();
  });

  it('asks again for a stored value that does not decrypt, connecting to nothing', async () => {
    const getPool = vi.spyOn(nav, 'getPool');
    await store({ ...NAV_ROWS, 'integrations.nav.password': 'not-a-ciphertext' }, ['integrations.nav.password']);
    await expect(call()).rejects.toMatchObject(UNREADABLE);
    expect(getPool).not.toHaveBeenCalled();
  });
});

it('answers a NAV query the server refuses as NAV preview does, on download', async () => {
  await store(NAV_ROWS);
  // The pool is never used: the query helper that would use it is the one stubbed.
  vi.spyOn(nav, 'getPool').mockResolvedValue({} as Awaited<ReturnType<typeof nav.getPool>>);
  vi.spyOn(nav, 'queryPortafoglioOrdini').mockRejectedValue(new Error("Invalid object name 'C$Sales Header'"));
  const caller = await createCallerAs('admin');
  await expect(caller.sales.statistics.portafoglio.download(ids)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: 'Query NAV non riuscita: verifica connessione e company',
  });
});

describe('an unreachable NAV server', () => {
  beforeEach(async () => {
    await store(NAV_ROWS);
    vi.spyOn(nav, 'getPool').mockRejectedValue(new Error('connect ETIMEDOUT'));
  });

  it('leaves getFilters with no salespersons', async () => {
    const caller = await createCallerAs('admin');
    await expect(caller.sales.statistics.portafoglio.getFilters(ids)).resolves.toMatchObject({ salespersons: [] });
  });

  it('fails download, which has no fallback, as NAV preview does: the driver error in the log only', async () => {
    const caller = await createCallerAs('admin');
    await expect(caller.sales.statistics.portafoglio.download(ids)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Query NAV non riuscita: verifica connessione e company',
    });
  });
});
