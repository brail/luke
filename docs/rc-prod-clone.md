# Cloning PROD into RC before a release

Procedure for validating a `vX.Y.Z-rc.N` tag against real production data — not
just an empty or stale RC database — **before** promoting it to a stable release.

## Why not a direct database clone

The obvious "pull" approach would be a Docker network shared between the prod and
RC stacks, a read-only Postgres role on prod, and prod's master key copied to the
RC volume so that encrypted `AppConfig` values stay readable. Rejected because:

- prod's master key (`~/.luke/secret.key`) must never leave its volume. It is the
  root of trust of the whole application: it derives `nextauth.secret`, `api.jwt`
  and `cookie.secret`, and decrypts every secret in `AppConfig`. Copying it to RC
  means that compromising RC includes compromising prod;
- it needs a Docker network shared between two otherwise isolated stacks;
- it needs a prod Postgres credential stored in RC's configuration.

`scripts/refresh-rc-db.sh` takes a variant of that route (see the comment at the
top of the file): with both stacks on the same Docker host, it streams `pg_dump`
from prod into RC and copies prod's master key into the RC API container. It is
kept only as a fallback until the flow below has been used successfully in a real
release, and is then to be retired.

## The alternative: the existing backup, export and import system

`apps/api/src/lib/backup/` already implements the invariant this needs: a portable
`.lukebak` package whose DEK is re-wrapped with a passphrase (Argon2id) instead of
the server's master key — decryptable on any instance, without any master key
crossing the boundary between prod and RC.

`scripts/rc-prod-clone.ts` orchestrates this flow over HTTP and tRPC, through the
same APIs an administrator would use from the dashboard, with no extra privileged
access:

1. Log into PROD (`auth.login`; credentials prompted at runtime, never stored).
2. Create a fresh `DB` backup, or reuse an existing one with `--backup-id`.
3. `maintenance.backup.prepareExport` with a passphrase the script generates at
   random (never printed, never reused), then download the `.lukebak` package from
   the short-lived signed link.
4. Log into RC and upload the package to `/upload/backup-import`.
5. `checkRestoreCompatibility` on the schema:
   - **OLDER** → `runMigrationBridge` applies this release's pending migrations in
     a disposable temporary database, **without touching RC's real database**.
     This is the step that concretely proves the migrations apply cleanly to real
     production data.
   - **SAME** → proceed straight to the restore.
   - **NEWER_OR_UNKNOWN** → hard stop, no bypass (the same rule the product itself
     enforces).
6. Interactive confirmation (skippable with `--yes`), then `backup.restore` on RC's
   real database.

No shared network, no prod Postgres credential in RC, no master key leaving its
volume: only an encrypted file and a one-off generated passphrase cross the
boundary, and both are discarded at the end of the run.

## Prerequisites

- The backup system available on both instances (prod and RC).
- An admin account on **prod** with `maintenance:read`, `maintenance:backup_create`
  and `maintenance:backup_export`.
- An admin account on **RC** with `maintenance:read` and
  `maintenance:backup_restore`.
- `@luke/api` and `@trpc/client` installed at the root (`pnpm install`).

## Usage

```bash
pnpm rc:clone --prod-url https://luke.example.com --rc-url http://rc.luke.febos.local
```

Options:

| Flag | Default | Notes |
|---|---|---|
| `--backup-id <id>` | creates a new backup | reuses an already completed PROD backup |
| `--label <text>` | `rc-clone-<timestamp>` | label of the created or imported backup |
| `--restore-files` | `false` | also replicates storage objects (buckets) |
| `--wipe-audit-log` | `false` | by default RC's current audit log is preserved |
| `--yes` | `false` | skips the interactive pre-restore confirmation |

`--prod-url` and `--rc-url` are always required, with no equivalent environment
variables: the direct `process.env` rule in `.semgrep/rules/no-direct-env.yml`
covers the root `scripts/` directory.

Username and password are prompted interactively, and the password is never
echoed. Never pass them as command-line arguments: they would end up in the shell
history.

## Known limitations

- Sensitive `AppConfig` values (LDAP and SMTP passwords) remain encrypted at column
  level with **prod's** master key — encryption independent of the backup's DEK;
  see `apps/api/src/lib/configManager.ts`. After the restore, reading them on RC
  throws at runtime at the point of use, not at boot. This is intended: RC can
  never silently reuse real production credentials against external systems.
  Reset them by hand with RC-appropriate values if RC needs working LDAP or SMTP.
- The `.lukebak` package is buffered entirely in memory during upload (no
  streaming multipart client in scope). Acceptable for `DB`-only backups; to be
  revisited if the flow is ever extended to `DB_AND_FILES`.

## Relationship with `refresh-rc-db.sh`

The two scripts coexist for now. `refresh-rc-db.sh` remains the operational
fallback until this flow has been used successfully in at least one real release.
Deprecating or removing `refresh-rc-db.sh` is a separate decision, to be taken
only after that validation.
