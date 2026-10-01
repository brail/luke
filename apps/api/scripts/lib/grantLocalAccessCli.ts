/**
 * The command behind `db:grant-local-access`, as a function of its arguments, its terminal and its
 * database, so that it can be tested as the operator would run it. `scripts/grant-local-access.ts`
 * only connects the real ones.
 *
 * What it can do and what it never does are in `localAccess.service.ts` and the API README
 * ("Recovering administrator access"). Here: reading the arguments, telling the operator what is
 * about to happen, asking for the confirmation, and printing the link — once, on stdout, which is
 * the one channel the token ever travels on.
 */

import type { PrismaClient } from '@luke/db';

import { getConfig } from '../../src/lib/configManager.js';
import { notifyAdmins } from '../../src/lib/notifications.js';
import {
  LocalAccessRefused,
  grantLocalAccess,
  inspectLocalAccess,
  type ReadinessBlocker,
} from '../../src/services/localAccess.service.js';

import { describeTarget } from './target.js';

/** The terminal the command talks to. */
export interface CommandIo {
  /** Standard output: what the operator reads, the link included. */
  out(line: string): void;
  /** Standard error: refusals and failures. Never carries the link. */
  err(line: string): void;
  /** Whether a person can answer `ask`: standard input is a terminal. */
  interactive: boolean;
  ask(question: string): Promise<string>;
}

const USAGE = 'Usage: grant-local-access --username <name> [--anyway] [--yes] [--dry-run]';

interface Args {
  username: string;
  anyway: boolean;
  yes: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const args: Args = { username: '', anyway: false, yes: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--username') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return { error: '--username needs a value' };
      args.username = value;
    } else if (arg === '--anyway') args.anyway = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else return { error: `unknown argument: ${arg}` };
  }
  return args.username ? args : { error: '--username is required' };
}

const BLOCKER_TEXT: Record<ReadinessBlocker, string> = {
  pending_approval: 'the account is pending approval: sign-in stays refused until it is approved',
  email_unverified:
    'the email is not verified while auth.requireEmailVerification is on: sign-in stays refused until it is verified',
};

/** The application origin the link will point to, when `app.baseUrl` is stored and is one. */
async function applicationOrigin(prisma: PrismaClient): Promise<string | null> {
  const baseUrl = await getConfig(prisma, 'app.baseUrl', false);
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Runs the command.
 *
 * @returns The exit code: 0 when a link was issued or a dry run passed, 1 otherwise.
 */
export async function runGrantLocalAccess(
  argv: string[],
  io: CommandIo,
  prisma: PrismaClient,
  databaseUrl: string | undefined
): Promise<number> {
  const args = parseArgs(argv);
  if ('error' in args) {
    io.err(`${args.error}\n${USAGE}`);
    return 1;
  }

  io.out(`Target database: ${describeTarget(databaseUrl)}`);

  const inspection = await inspectLocalAccess(prisma, args.username);
  if ('refusal' in inspection) {
    io.err(`Refused: ${inspection.refusal}. Nothing written.`);
    return 1;
  }

  const { account, blockers, identityMissing } = inspection;
  const origin = await applicationOrigin(prisma);

  io.out(`Account: ${account.username} <${account.email}>, role ${account.role}, id ${account.id}`);
  io.out(
    identityMissing
      ? 'LOCAL identity: missing — it will be created, with a password nobody knows until the link is used'
      : 'LOCAL identity: present'
  );
  io.out(
    origin
      ? `Application: ${origin}`
      : 'Application: app.baseUrl is not stored or not an http(s) URL — only the path of the link will be printed'
  );
  io.out('Effects:');
  io.out('  - every reset link sent to this account before stops working, even if this one is never used;');
  io.out('  - the password and the open sessions change only when the new link is used.');

  for (const blocker of blockers) {
    io.out(`${args.anyway ? 'Warning' : 'Blocked'}: ${BLOCKER_TEXT[blocker]}.`);
  }
  if (blockers.length > 0 && !args.anyway) {
    io.err('Refused: fix the account first, or pass --anyway to issue a link that works once it is fixed. Nothing written.');
    return 1;
  }

  if (args.dryRun) {
    io.out('Dry run: nothing written.');
    return 0;
  }

  if (!args.yes) {
    if (!io.interactive) {
      io.err('No terminal to confirm on: run it from an interactive shell, or pass --yes. Nothing written.');
      return 1;
    }
    const answer = await io.ask(`Type the username (${account.username}) to confirm: `);
    if (answer.trim() !== account.username) {
      io.err('Not confirmed. Nothing written.');
      return 1;
    }
  }

  let grant;
  try {
    grant = await grantLocalAccess(prisma, { id: account.id, username: account.username }, { anyway: args.anyway });
  } catch (error) {
    io.err(
      error instanceof LocalAccessRefused
        ? `Refused: ${error.message}. Nothing written.`
        : `Failed: ${error instanceof Error ? error.message : 'unknown error'}. Nothing written.`
    );
    return 1;
  }

  const path = `/auth/reset?token=${grant.token}`;
  io.out('');
  io.out("The link below is a credential: whoever opens it first sets this administrator's password.");
  io.out(`Open it directly, over HTTPS, and clear this terminal afterwards. It works once, until ${grant.expiresAt.toISOString()}.`);
  io.out('');
  io.out(`  ${origin ? `${origin}${path}` : path}`);
  io.out('');

  // Best effort, and without the link: the audit row is already committed.
  await notifyAdmins(prisma, {
    category: 'SYSTEM',
    title: 'Link di recupero emesso da riga di comando',
    message: `È stato emesso un link per impostare la password locale di ${account.username}.`,
    data: { type: 'local_access_granted_cli', userId: account.id },
  }).catch(error => io.err(`Administrators not notified: ${error instanceof Error ? error.message : 'unknown error'}`));

  return 0;
}
