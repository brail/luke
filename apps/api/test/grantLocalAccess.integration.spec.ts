/**
 * `db:grant-local-access`, run as an operator would run it, against a real database.
 *
 * It issues a single-use reset link for one named, existing, active administrator — the way back in
 * when nobody can sign in — and does nothing else: no role, activation, approval or verification
 * change. Issuing is one transaction with its audit row, so a failure leaves nothing behind, and the
 * link is printed only after that commit, once, on standard output: it is a bearer credential, and
 * nothing else the command touches may carry it.
 */

import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { runGrantLocalAccess, type CommandIo } from '../scripts/lib/grantLocalAccessCli';
import * as auditLog from '../src/lib/auditLog';
import * as ldapAuth from '../src/lib/ldapAuth';
import { appRouter } from '../src/routers/index';
import { confirmPasswordReset } from '../src/services/auth.service';

import { createTestContext, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

const DATABASE_URL = 'postgresql://luke:secret@db.internal:5432/luke';
const NEW_PASSWORD = 'Recovered-Passw0rd!';

beforeEach(async () => {
  prisma = await setupTestDb();
  await prisma.appConfig.create({ data: { key: 'app.baseUrl', value: 'https://luke.example', isEncrypted: false } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A terminal that records what the command prints and answers its question. */
function terminal(options: { interactive?: boolean; answer?: string | (() => Promise<string>) } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIo = {
    out: line => out.push(line),
    err: line => err.push(line),
    interactive: options.interactive ?? false,
    ask: async () => (typeof options.answer === 'function' ? options.answer() : (options.answer ?? '')),
  };
  return { io, out, err, text: () => [...out, ...err].join('\n') };
}

function run(args: string[], io: CommandIo) {
  return runGrantLocalAccess(args, io, prisma, DATABASE_URL);
}

/** The token in the printed link, if one was printed. */
function printedToken(lines: string[]): string | undefined {
  return lines.join('\n').match(/\/auth\/reset\?token=([0-9a-f]{64})/)?.[1];
}

/** An administrator who signs in through the directory only: no LOCAL identity. */
async function directoryAdmin() {
  const { user } = await createTestUser('admin');
  await prisma.identity.deleteMany({ where: { userId: user.id } });
  await prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: `cn=${user.username}` } });
  return user;
}

/** Everything the command could have written for `userId`. */
async function writtenFor(userId: string) {
  const [identities, tokens, audits] = await Promise.all([
    prisma.identity.count({ where: { userId, provider: 'LOCAL' } }),
    prisma.userToken.count({ where: { userId, type: 'RESET' } }),
    prisma.auditLog.count({ where: { targetId: userId, action: 'USER_LOCAL_ACCESS_FORCED' } }),
  ]);
  return { identities, tokens, audits };
}

describe('issuing a link', () => {
  it('prints the link once, with the application origin, and the link sets the password', async () => {
    const user = await directoryAdmin();
    const t = terminal();

    expect(await run(['--username', user.username, '--yes'], t.io)).toBe(0);

    const token = printedToken(t.out)!;
    expect(t.out.join('\n')).toContain(`https://luke.example/auth/reset?token=${token}`);
    expect(t.text().split(token)).toHaveLength(2); // exactly once
    expect(t.out[0]).toBe('Target database: db.internal:5432/luke');
    expect(t.text()).not.toContain('secret');

    await confirmPasswordReset(createTestContext(null), { token, newPassword: NEW_PASSWORD });
    expect(await writtenFor(user.id)).toMatchObject({ identities: 1, tokens: 0 });
  });

  it('records the issuance without the token, and tells the administrators without it', async () => {
    const user = await directoryAdmin();
    const t = terminal();

    await run(['--username', user.username, '--yes'], t.io);

    const token = printedToken(t.out)!;
    const row = await prisma.auditLog.findFirstOrThrow({ where: { targetId: user.id, action: 'USER_LOCAL_ACCESS_FORCED' } });
    expect(row).toMatchObject({ actorId: null, result: 'SUCCESS' });
    expect(row.metadata).toEqual({ source: 'cli', identityCreated: true, readinessBypassed: false, resetTokensRevoked: 0 });

    const notices = await prisma.notification.findMany({ where: { title: 'Link di recupero emesso da riga di comando' } });
    expect(notices.length).toBeGreaterThan(0);
    expect(JSON.stringify([row, notices])).not.toContain(token);
  });

  it('makes every earlier reset link of the account stop working', async () => {
    const { user } = await createTestUser('admin');
    const earlier = terminal();
    await run(['--username', user.username, '--yes'], earlier.io);

    const later = terminal();
    await run(['--username', user.username, '--yes'], later.io);

    await expect(
      confirmPasswordReset(createTestContext(null), { token: printedToken(earlier.out)!, newPassword: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: user.id, action: 'USER_LOCAL_ACCESS_FORCED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ identityCreated: false, resetTokensRevoked: 1 });
  });

  it('prints only the path when app.baseUrl is not stored', async () => {
    await prisma.appConfig.deleteMany({ where: { key: 'app.baseUrl' } });
    const { user } = await createTestUser('admin');
    const t = terminal();

    expect(await run(['--username', user.username, '--yes'], t.io)).toBe(0);

    expect(t.out.join('\n')).toMatch(/^ {2}\/auth\/reset\?token=[0-9a-f]{64}$/m);
  });
});

describe('refusals: nothing is written and nothing secret is printed', () => {
  it.each([
    ['an unknown username', async () => ({ id: 'none', username: 'nobody-here' })],
    ['an editor', async () => (await createTestUser('editor')).user],
    [
      'a deactivated administrator',
      async () => {
        const { user } = await createTestUser('admin');
        return prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      },
    ],
    [
      'a LOCAL identity left under an old username',
      async () => {
        const { user } = await createTestUser('admin');
        return prisma.user.update({ where: { id: user.id }, data: { username: `${user.username}-renamed` } });
      },
    ],
    [
      "a LOCAL identity of that username owned by another account",
      async () => {
        const user = await directoryAdmin();
        const { user: other } = await createTestUser('viewer');
        await prisma.identity.create({ data: { userId: other.id, provider: 'LOCAL', providerId: user.username } });
        return user;
      },
    ],
  ])('%s', async (_name, target) => {
    const user = await target();
    const t = terminal();

    expect(await run(['--username', user.username, '--yes'], t.io)).toBe(1);

    expect(t.err.join('\n')).toMatch(/^Refused: .*Nothing written\.$/m);
    expect(printedToken(t.out)).toBeUndefined();
    expect(await writtenFor(user.id)).toEqual({ identities: user.id === 'none' ? 0 : expect.any(Number), tokens: 0, audits: 0 });
  });

  it('pending approval: refused without --anyway, issued with it and recorded as such', async () => {
    const { user } = await createTestUser('admin');
    await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });

    const refused = terminal();
    expect(await run(['--username', user.username, '--yes'], refused.io)).toBe(1);
    expect(await writtenFor(user.id)).toMatchObject({ tokens: 0, audits: 0 });

    const forced = terminal();
    expect(await run(['--username', user.username, '--yes', '--anyway'], forced.io)).toBe(0);
    expect(forced.out.join('\n')).toContain('Warning: the account is pending approval');
    const row = await prisma.auditLog.findFirstOrThrow({ where: { targetId: user.id, action: 'USER_LOCAL_ACCESS_FORCED' } });
    expect(row.metadata).toMatchObject({ readinessBypassed: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ pendingApproval: true });
  });

  it('--dry-run checks everything and writes nothing', async () => {
    const user = await directoryAdmin();
    const t = terminal();

    expect(await run(['--username', user.username, '--dry-run'], t.io)).toBe(0);

    expect(t.out.join('\n')).toContain('Dry run: nothing written.');
    expect(printedToken(t.out)).toBeUndefined();
    expect(await writtenFor(user.id)).toEqual({ identities: 0, tokens: 0, audits: 0 });
  });
});

describe('confirmation', () => {
  it('refuses without --yes when there is no terminal to confirm on', async () => {
    const { user } = await createTestUser('admin');
    const t = terminal({ interactive: false });

    expect(await run(['--username', user.username], t.io)).toBe(1);
    expect(await writtenFor(user.id)).toMatchObject({ tokens: 0, audits: 0 });
  });

  it('refuses a wrong answer, and issues on the username typed back', async () => {
    const { user } = await createTestUser('admin');

    const wrong = terminal({ interactive: true, answer: 'someone-else' });
    expect(await run(['--username', user.username], wrong.io)).toBe(1);
    expect(await writtenFor(user.id)).toMatchObject({ tokens: 0, audits: 0 });

    const right = terminal({ interactive: true, answer: user.username });
    expect(await run(['--username', user.username], right.io)).toBe(0);
    expect(printedToken(right.out)).toBeDefined();
  });

  it('catches an account changed while the operator was confirming, and writes nothing', async () => {
    const { user } = await createTestUser('admin');
    const t = terminal({
      interactive: true,
      answer: async () => {
        await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
        return user.username;
      },
    });

    expect(await run(['--username', user.username], t.io)).toBe(1);

    expect(t.err.join('\n')).toContain('deactivated');
    expect(await writtenFor(user.id)).toMatchObject({ tokens: 0, audits: 0 });
  });
});

describe('a failed audit write', () => {
  it('rolls the whole issuance back — identity, token, the earlier links it revoked — and prints no link', async () => {
    const user = await directoryAdmin();
    const earlier = await prisma.userToken.create({
      data: { userId: user.id, type: 'RESET', tokenHash: 'earlier-link', expiresAt: new Date(Date.now() + 60_000) },
    });
    // The real `logAudit`, writing to a store that refuses: an ordinary action would be swallowed,
    // so this fails only if the command requires the write.
    const realLogAudit = auditLog.logAudit;
    vi.spyOn(auditLog, 'logAudit').mockImplementation((ctx, params, options) =>
      realLogAudit(
        // Only `auditLog.create` is reached by `logAudit`.
        { ...ctx, prisma: { auditLog: { create: vi.fn().mockRejectedValue(new Error('audit store unavailable')) } } as unknown as auditLog.AuditContext['prisma'] },
        params,
        options,
      ),
    );
    const t = terminal();

    expect(await run(['--username', user.username, '--yes'], t.io)).toBe(1);

    expect(t.err.join('\n')).toContain('Failed: audit store unavailable. Nothing written.');
    expect(printedToken(t.out)).toBeUndefined();
    expect(await prisma.identity.count({ where: { userId: user.id, provider: 'LOCAL' } })).toBe(0);
    expect((await prisma.userToken.findMany({ where: { userId: user.id } })).map(token => token.id)).toEqual([earlier.id]);
  });
});

// The reason the command exists: under ldap-only, with LDAP refusing everyone and no administrator
// able to sign in locally, the printed link leads back in through the break-glass path.
it('end to end: ldap-only, LDAP refusing everyone, the link leads to a local sign-in', async () => {
  await prisma.appConfig.create({ data: { key: 'auth.strategy', value: 'ldap-only', isEncrypted: false } });
  vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user: null, reason: 'invalid_credentials' });
  const user = await directoryAdmin();
  const login = () => appRouter.createCaller(createTestContext(null)).auth.login({ username: user.username, password: NEW_PASSWORD });
  await expect(login()).rejects.toBeInstanceOf(TRPCError);

  const t = terminal();
  expect(await run(['--username', user.username, '--yes'], t.io)).toBe(0);
  await confirmPasswordReset(createTestContext(null), { token: printedToken(t.out)!, newPassword: NEW_PASSWORD });

  await expect(login()).resolves.toMatchObject({ user: { id: user.id } });
});
