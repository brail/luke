#!/usr/bin/env -S pnpm exec tsx
/**
 * Luke — Clone production into RC via the built-in backup/export/import pipeline.
 *
 * Successor to `refresh-rc-db.sh`, once the backup system (this script's only dependency)
 * has shipped to `main`. Unlike that script, this one never touches Docker, never opens a
 * network path between the prod and RC stacks, and never copies prod's master key
 * (`~/.luke/secret.key`) anywhere — it only talks to each instance's already-authenticated
 * HTTP/tRPC API, the same surface a human admin uses from the browser.
 *
 * Flow:
 *   1. Log into PROD (`auth.login`) with credentials prompted interactively — never persisted,
 *      never passed as a CLI arg (would land in shell history).
 *   2. Create a fresh `DB` backup on PROD (or reuse one via `--backup-id`), wait for it to
 *      complete.
 *   3. `maintenance.backup.prepareExport` re-wraps that backup's DEK with a passphrase this
 *      script generates at random (never printed, never reused across runs) instead of the
 *      server master key — this is what makes the package decryptable on a different instance.
 *      Download the resulting `.lukebak` via the short-lived signed export link.
 *   4. Log into RC, upload the package to `/upload/backup-import` (re-wraps the DEK again,
 *      this time with RC's own master key).
 *   5. Check schema compatibility against RC's currently-applied migrations:
 *      - OLDER  → run the migration bridge (applies RC's pending migrations inside a disposable
 *        temp database, never touching RC's real one) and wait for the resulting `MIGRATED`
 *        backup, which is what actually proves "the new migrations apply cleanly to a real,
 *        prod-shaped dataset" — the point of this whole exercise.
 *      - SAME   → nothing to bridge, proceed straight to restore.
 *      - NEWER_OR_UNKNOWN → hard stop, no bypass (same rule the app itself enforces).
 *   6. Restore that backup into RC's real database (after an interactive confirmation, unless
 *      `--yes`).
 *
 * Known limitation: the AppConfig rows carried inside the dump (LDAP/SMTP passwords, etc.)
 * stay encrypted with PROD's master key at the column level — a separate encryption layer from
 * the backup's own DEK (see `apps/api/src/lib/configManager.ts`). RC cannot decrypt those
 * specific values after this restore; reading them throws at the point of use rather than at
 * boot. This is deliberate, not a bug to route around: it guarantees RC can never silently reuse
 * prod's real external credentials. Re-save those keys with RC-appropriate values afterward if
 * you need working LDAP/SMTP on RC.
 *
 * Known limitation #2: the upload step buffers the whole `.lukebak` package in memory (no
 * streaming multipart client in scope here). Fine for a `DB`-only backup on this app's data
 * volume; reconsider if this is ever extended to `DB_AND_FILES`.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

import { createTRPCClient, httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@luke/api';

import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 20 * 60 * 1_000; // 20 min — generous for a DB-only pg_dump/restore

// Raw control characters, spelled out via escapes rather than literal bytes in source
// (literal control chars are invisible and easy to mis-paste/mis-diff).
const KEY_ENTER_LF = '\n';
const KEY_ENTER_CR = '\r';
const KEY_EOF = '\x04'; // Ctrl+D
const KEY_INTERRUPT = '\x03'; // Ctrl+C
const KEY_BACKSPACE = '\x7f';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

/** Reads a line from stdin without echoing it — used for passwords, never even asterisks. */
function promptHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (chunk: string) => {
      if (chunk === KEY_ENTER_LF || chunk === KEY_ENTER_CR || chunk === KEY_EOF) {
        stdin.removeListener('data', onData);
        stdin.setRawMode?.(wasRaw ?? false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(input);
        return;
      }
      if (chunk === KEY_INTERRUPT) {
        process.stdout.write('\n');
        process.exit(130);
      }
      if (chunk === KEY_BACKSPACE) {
        input = input.slice(0, -1);
        return;
      }
      input += chunk;
    };
    stdin.on('data', onData);
  });
}

/** Strips a trailing slash so callers can join paths with a plain template literal. */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function makeClient(baseUrl: string, token?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
        headers: () => (token ? { Authorization: `Bearer ${token}` } : {}),
      }),
    ],
  });
}

async function login(label: string, baseUrl: string): Promise<string> {
  console.log(`\n== Logging into ${label} (${baseUrl}) ==`);
  const username = await prompt('Username: ');
  const password = await promptHidden('Password: ');
  const anon = makeClient(baseUrl);
  const result = await anon.auth.login.mutate({ username, password });
  return result.token;
}

type BackupStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

async function waitForBackup(
  client: ReturnType<typeof makeClient>,
  id: string,
  label: string
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const record = await client.maintenance.backup.getById.query({ id });
    const status = record.status as BackupStatus;
    if (status === 'COMPLETED') {
      console.log(`   ${label}: completed`);
      return;
    }
    if (status === 'FAILED') {
      throw new Error(`${label} failed: ${record.errorMessage ?? 'unknown error'}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${label}: timed out waiting for completion (current status: ${status})`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'prod-url': { type: 'string' },
      'rc-url': { type: 'string' },
      'backup-id': { type: 'string' },
      label: { type: 'string' },
      'restore-files': { type: 'boolean', default: false },
      'wipe-audit-log': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
  });

  const prodUrlInput = values['prod-url'];
  const rcUrlInput = values['rc-url'];
  if (!prodUrlInput || !rcUrlInput) {
    console.error('Usage: tsx scripts/rc-prod-clone.ts --prod-url <url> --rc-url <url> [--backup-id <id>] [--label <text>] [--restore-files] [--wipe-audit-log] [--yes]');
    process.exit(1);
  }
  const prodUrl = stripTrailingSlash(prodUrlInput);
  const rcUrl = stripTrailingSlash(rcUrlInput);

  const label = values.label ?? `rc-clone-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const workDir = join(tmpdir(), `rc-prod-clone-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const packagePath = join(workDir, 'backup.lukebak');

  try {
    // ── 1-3. PROD: login, backup, export ────────────────────────────────────
    const prodToken = await login('PROD', prodUrl);
    const prod = makeClient(prodUrl, prodToken);

    let backupId = values['backup-id'];
    if (!backupId) {
      console.log(`\n== Creating a DB backup on PROD (label: ${label}) ==`);
      const created = await prod.maintenance.backup.create.mutate({ scope: 'DB', label });
      backupId = created.id;
      await waitForBackup(prod, backupId, 'Backup PROD');
    } else {
      console.log(`\n== Reusing existing PROD backup: ${backupId} ==`);
    }

    console.log('== Preparing a passphrase-protected export (.lukebak) ==');
    const passphrase = randomBytes(24).toString('base64url'); // never printed, never reused across runs
    const exported = await prod.maintenance.backup.prepareExport.mutate({ id: backupId, passphrase });

    console.log('== Downloading the export package from PROD ==');
    // Keep in step with `buildBackupExportDownloadUrl` in packages/core/src/net/url.ts. Hand-written
    // because @luke/core is not a dependency of the repo root (only @luke/api is), so this script
    // cannot import it — the paths moved once already, to the `/download/` and `/upload/` prefixes
    // Next.js proxies in production, and this copy is the one that went stale.
    const exportUrl = `${prodUrl}/download/backup/${backupId}/export?token=${encodeURIComponent(exported.token)}`;
    const res = await fetch(exportUrl);
    if (!res.ok || !res.body) throw new Error(`Export download failed: HTTP ${res.status}`);
    // res.body is typed against lib.dom's ReadableStream; Readable.fromWeb wants node:stream/web's —
    // structurally identical at runtime (undici backs both), just two distinct TS declarations.
    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>), createWriteStream(packagePath));

    // ── 4. RC: login, import ────────────────────────────────────────────────
    const rcToken = await login('RC', rcUrl);
    const rc = makeClient(rcUrl, rcToken);

    console.log('\n== Importing the package into RC ==');
    const fileBuffer = await readFile(packagePath);
    const form = new FormData();
    form.set('passphrase', passphrase);
    form.set('label', label);
    form.set('file', new Blob([fileBuffer]), 'backup.lukebak');

    // Mirrors `buildBackupImportUrl` — see the note on `exportUrl` above.
    const importRes = await fetch(`${rcUrl}/upload/backup-import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${rcToken}` },
      body: form,
    });
    if (!importRes.ok) {
      const body = await importRes.text().catch(() => '');
      throw new Error(`Import into RC failed: HTTP ${importRes.status} ${body}`);
    }
    const importBody = await importRes.json(); // route contract: { id: string }, see apps/api/src/routes/backupImport.ts
    const importedId = (importBody as { id: string }).id;
    console.log(`   Imported as RC backup: ${importedId}`);

    // ── 5. Schema compatibility → migration bridge if needed ────────────────
    console.log('\n== Checking schema compatibility on RC ==');
    let compat = await rc.maintenance.backup.checkRestoreCompatibility.query({ id: importedId });
    console.log(`   Classification: ${compat.classification}`);

    let restoreTargetId = importedId;
    if (compat.classification === 'NEWER_OR_UNKNOWN') {
      throw new Error(
        `Backup schema is newer than RC's, or unknown (RC: ${compat.currentSchemaMigrationName}). ` +
        `Upgrade the RC image to a version ≥ the backup's first.`
      );
    }
    if (compat.classification === 'OLDER') {
      console.log(`   Migrations to apply (${compat.pendingMigrations.length}): ${compat.pendingMigrations.join(', ')}`);
      console.log('== Running the migration bridge (in a disposable temporary database; RC is not touched) ==');
      const bridged = await rc.maintenance.backup.runMigrationBridge.mutate({
        id: importedId,
        acknowledgeMigrationBridge: true,
      });
      await waitForBackup(rc, bridged.id, 'Migration bridge');
      restoreTargetId = bridged.id;

      compat = await rc.maintenance.backup.checkRestoreCompatibility.query({ id: restoreTargetId });
      if (compat.classification !== 'SAME') {
        throw new Error(`Migration bridge completed, but the resulting schema is not "SAME" (it is "${compat.classification}") — an anomaly, investigate before proceeding.`);
      }
      console.log('   Migration bridge completed: the migrations apply cleanly to real PROD data.');
    }

    // ── 6. Restore into RC's real DB ────────────────────────────────────────
    if (!values.yes) {
      const confirm = await prompt(
        `\nThis OVERWRITES the RC database with PROD data (backup ${restoreTargetId}). Continue? [y/N] `
      );
      if (!/^[Yy]$/.test(confirm)) {
        console.log('Cancelled.');
        return;
      }
    }

    console.log('== Restoring on RC ==');
    await rc.maintenance.backup.restore.mutate({
      id: restoreTargetId,
      preserveAuditLog: !values['wipe-audit-log'],
      restoreFiles: values['restore-files'],
      confirmPhrase: 'RIPRISTINA',
    });

    console.log('\nDone. RC now reflects PROD data, with the migrations of this release applied.');
    console.log('Reminder: encrypted AppConfig secrets (LDAP/SMTP) stay encrypted with the PROD master key and will not be readable on RC until you set them again.');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}

main().catch(err => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
