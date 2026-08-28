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

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import * as readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { AppRouter } from '@luke/api';

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
  console.log(`\n== Login su ${label} (${baseUrl}) ==`);
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
      console.log(`   ${label}: completato`);
      return;
    }
    if (status === 'FAILED') {
      throw new Error(`${label} fallito: ${record.errorMessage ?? 'errore sconosciuto'}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${label}: timeout in attesa di completamento (stato attuale: ${status})`);
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
    console.error('Uso: tsx scripts/rc-prod-clone.ts --prod-url <url> --rc-url <url> [--backup-id <id>] [--label <text>] [--restore-files] [--wipe-audit-log] [--yes]');
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
      console.log(`\n== Creo backup DB su PROD (label: ${label}) ==`);
      const created = await prod.maintenance.backup.create.mutate({ scope: 'DB', label });
      backupId = created.id;
      await waitForBackup(prod, backupId, 'Backup PROD');
    } else {
      console.log(`\n== Riuso backup PROD esistente: ${backupId} ==`);
    }

    console.log('== Preparo export passphrase-protected (.lukebak) ==');
    const passphrase = randomBytes(24).toString('base64url'); // mai stampata, mai riusata tra run
    const exported = await prod.maintenance.backup.prepareExport.mutate({ id: backupId, passphrase });

    console.log('== Scarico il pacchetto export da PROD ==');
    // Keep in step with `buildBackupExportDownloadUrl` in packages/core/src/net/url.ts. Hand-written
    // because @luke/core is not a dependency of the repo root (only @luke/api is), so this script
    // cannot import it — the paths moved once already, to the `/download/` and `/upload/` prefixes
    // Next.js proxies in production, and this copy is the one that went stale.
    const exportUrl = `${prodUrl}/download/backup/${backupId}/export?token=${encodeURIComponent(exported.token)}`;
    const res = await fetch(exportUrl);
    if (!res.ok || !res.body) throw new Error(`Download export fallito: HTTP ${res.status}`);
    // res.body is typed against lib.dom's ReadableStream; Readable.fromWeb wants node:stream/web's —
    // structurally identical at runtime (undici backs both), just two distinct TS declarations.
    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>), createWriteStream(packagePath));

    // ── 4. RC: login, import ────────────────────────────────────────────────
    const rcToken = await login('RC', rcUrl);
    const rc = makeClient(rcUrl, rcToken);

    console.log('\n== Importo il pacchetto su RC ==');
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
      throw new Error(`Import su RC fallito: HTTP ${importRes.status} ${body}`);
    }
    const importBody = await importRes.json(); // contratto della route: { id: string }, vedi apps/api/src/routes/backupImport.ts
    const importedId = (importBody as { id: string }).id;
    console.log(`   Importato come backup RC: ${importedId}`);

    // ── 5. Schema compatibility → migration bridge se necessario ────────────
    console.log('\n== Verifico compatibilità schema su RC ==');
    let compat = await rc.maintenance.backup.checkRestoreCompatibility.query({ id: importedId });
    console.log(`   Classificazione: ${compat.classification}`);

    let restoreTargetId = importedId;
    if (compat.classification === 'NEWER_OR_UNKNOWN') {
      throw new Error(
        `Schema del backup più recente o sconosciuto rispetto a RC (RC: ${compat.currentSchemaMigrationName}). ` +
        `Aggiorna prima l'immagine RC a una versione ≥ di quella del backup.`
      );
    }
    if (compat.classification === 'OLDER') {
      console.log(`   Migration da applicare (${compat.pendingMigrations.length}): ${compat.pendingMigrations.join(', ')}`);
      console.log('== Eseguo il migration bridge (in un database temporaneo disposable, non tocca RC) ==');
      const bridged = await rc.maintenance.backup.runMigrationBridge.mutate({
        id: importedId,
        acknowledgeMigrationBridge: true,
      });
      await waitForBackup(rc, bridged.id, 'Migration bridge');
      restoreTargetId = bridged.id;

      compat = await rc.maintenance.backup.checkRestoreCompatibility.query({ id: restoreTargetId });
      if (compat.classification !== 'SAME') {
        throw new Error(`Migration bridge completato ma lo schema risultante non è "SAME" (è "${compat.classification}") — anomalia, indagare prima di procedere.`);
      }
      console.log('   Migration bridge completato: le migration si applicano correttamente ai dati reali di PROD.');
    }

    // ── 6. Restore nel DB reale di RC ───────────────────────────────────────
    if (!values.yes) {
      const confirm = await prompt(
        `\nQuesto SOVRASCRIVE il database RC con i dati di PROD (backup ${restoreTargetId}). Continuare? [y/N] `
      );
      if (!/^[Yy]$/.test(confirm)) {
        console.log('Annullato.');
        return;
      }
    }

    console.log('== Ripristino su RC ==');
    await rc.maintenance.backup.restore.mutate({
      id: restoreTargetId,
      preserveAuditLog: !values['wipe-audit-log'],
      restoreFiles: values['restore-files'],
      confirmPhrase: 'RIPRISTINA',
    });

    console.log('\nFatto. RC ora riflette i dati di PROD con le migration di questa release applicate.');
    console.log('Promemoria: i segreti AppConfig cifrati (LDAP/SMTP) restano cifrati con la master key di PROD e non saranno leggibili su RC finché non li reimposti.');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}

main().catch(err => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
