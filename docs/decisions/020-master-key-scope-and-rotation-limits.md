# ADR-020 — Master Key Scope and Rotation Limits

## Status

Accepted

## Context

[ADR-001](001-jwt-hs256-hkdf.md) chose HS256 with HKDF-SHA256 derivation from a 32-byte master key at `~/.luke/secret.key`. That choice still stands. What no longer holds is the record's account of the key's scope and of what rotating it does.

ADR-001 describes the master key as a token-signing secret and nothing else. It is not. The same raw bytes are the AES-256-GCM key for encrypted `AppConfig` rows and the wrapping key for every backup's data-encryption key. The rotation procedure it gives — delete the file and restart — therefore reaches well beyond tokens: unless a copy of the original key is kept, it leaves encrypted data unreadable. The record does not say so. [ADR-018](018-runtime-configuration-and-bootstrap-environment.md) noted the omission without superseding ADR-001.

Three further statements in ADR-001 no longer match the code: that the server fails fast when the key is unavailable, that rotation invalidates every token, and that no secret is stored in the database.

This record supersedes ADR-001 and states the master key's scope, what rotation actually does, and how sessions are revoked today. ADR-001 remains, translated, as the historical record of the original decision.

## Decision

### Derivation is unchanged

- `getMasterKey` in `packages/core/src/crypto/secrets.server.ts` reads `~/.luke/secret.key`, 32 bytes. When the file is absent it creates it with mode 0600, creating `~/.luke` with mode 0700 if that is missing too. Those modes apply at creation only: on an existing file or directory nothing re-checks them, and the sole validation is the 32-byte length.
- `deriveSecret` applies HKDF-SHA256 with the salt `luke`, a 32-byte output and base64url encoding. Four info domains are in use: `api.jwt`, `nextauth.secret`, `cookie.secret`, and `luke:download-token` in `apps/api/src/utils/downloadToken.ts`, which ADR-001 and `CLAUDE.md` both omit. Nothing constrains the set: a new domain is introduced by calling `deriveSecret` with a new string.
- API tokens are signed HS256 with `iss: 'urn:luke'`, `aud: 'luke.api'` and a 5-second clock tolerance. Their lifetime is 8 hours, supplied by `JWT_EXPIRES_IN` in `apps/api/src/lib/auth.ts` and matching the NextAuth `SESSION_MAX_AGE`. The `'7d'` default in `apps/api/src/lib/jwt.ts` is unused, as [ADR-019](019-tokenversion-session-revocation.md) records.

### The master key is not only a signing key

- `encryptValue` and `decryptValue` in `apps/api/src/lib/configManager.ts` pass the raw master key straight to `createCipheriv` and `createDecipheriv` for AES-256-GCM. No derivation step separates configuration encryption from the master key.
- Every `AppConfig` row flagged `isEncrypted` is therefore readable only under the exact key that wrote it. The rows written encrypted today include the LDAP bind password and its connection settings, the SMTP password, the S3 access and secret keys, the SMB and Drive blobs, the Google service key and OAuth secrets, the NAV password, and `auth.nextAuthSecret`. That set is not fixed: encryption is chosen by the caller rather than declared by the registry ([ADR-018](018-runtime-configuration-and-bootstrap-environment.md)), and the generic configuration procedures take `encrypt` from their input, so any registered key can also be stored encrypted.
- `wrapDek` and `unwrapDek` in `apps/api/src/lib/backup/crypto.ts` are `encryptValue` and `decryptValue`. Each backup's data-encryption key is wrapped under the master key and stored both in `BackupRecord.wrappedDekHex` and in the `<backupId>.meta.json` sidecar written by `apps/api/src/lib/backup/dumpPipeline.ts`. The blob itself is sealed with the DEK, so without the key that wrapped it the blob remains intact and unreadable.
- The one path in that module independent of the master key is the passphrase pair `wrapDekWithPassphrase` and `unwrapDekWithPassphrase`, which derive a wrapping key from an operator passphrase with Argon2id — the first to seal a DEK into a `.lukebak` export, the second to recover it from one on any instance.

### Rotation is not a supported revocation procedure

Deleting or replacing `~/.luke/secret.key` on an instance that already holds data is not supported as a way to revoke sessions.

Two situations must be kept apart. **Replacing the key while the original is retained** — moving the file aside, or holding a copy elsewhere — is recoverable: the encrypted rows and wrapped DEKs become readable again as soon as the original bytes are back in place. **Losing the original** is not recoverable. ADR-001's procedure does not distinguish them, and the troubleshooting recipes in the operational documentation delete the file outright.

On an instance that already holds data, replacing or deleting the key:

- leaves every encrypted `AppConfig` row unreadable for as long as the original key is unavailable, and permanently if no copy of it survives. No re-entry or re-encryption routine exists: the seed skips rows that already exist, and `config.exportJson` returns `[ENCRYPTED]` rather than plaintext, so neither restores them;
- leaves every `BackupRecord.wrappedDekHex` undecryptable on the same terms, so historical backups cannot be restored. A `.lukebak` export taken beforehand does survive, because its data-encryption key is wrapped under an Argon2id passphrase key rather than under the master key — but **creating one requires the key that wrapped the DEK**: `maintenance.backup.prepareExport` calls `unwrapDek` before re-wrapping under the passphrase. Such an export is a precaution that must precede the change; it is never a recovery afterwards;
- is only partly visible to the startup and readiness checks, and how visible depends on what is stored encrypted. `getMasterKey` creates a new key when the file is absent and `validateMasterKey` only checks its length, so neither of them stops the process. `validateCriticalConfig` reads every key in `CRITICAL_CONFIG_KEYS` through the decrypting reader, so if `auth.strategy` is itself stored encrypted the decryption failure aborts startup in production and is logged as a warning elsewhere; where it is not encrypted, startup proceeds. The `secrets` probe derives `api.jwt` and cannot tell one key from another. The `ldap` probe can: it decrypts the stored LDAP settings before binding, so where LDAP is configured the condition surfaces there. Failing all of those, nothing at startup reports the change and it appears later as decryption failures at the point of use;
- does not end production web sessions at once, but does not leave them working either. The Auth.js cookie stays decryptable, because `apps/web/src/auth.ts` takes `NEXTAUTH_SECRET` from the environment in production instead of deriving it. The API token carried inside that session does not: it was signed with the previous `api.jwt` secret. The `jwt` callback renews it by calling `auth.refreshToken` with that same token as its bearer credential; the call is rejected and the session ends there. The effect is a delayed logout at the next refresh, not the immediate global invalidation ADR-001 describes.

Replacing the key does invalidate every API JWT, since they are signed with `api.jwt` derived from it. That much of ADR-001's reasoning holds; what makes the procedure unsupported is everything else it takes with it, above. The supported revocation mechanism is the one [ADR-019](019-tokenversion-session-revocation.md) describes, and no single runtime call there revokes every user's tokens: `me.revokeAllSessions` and `auth.logoutAll` revoke the caller's own; `users.revokeUserSessions` revokes one named user's; `me.changePassword`, `auth.confirmPasswordReset`, `users.update`, `users.revokeLocalAccess` and `users.hardDelete` revoke as a consequence of the change they make; `forceLogoutNonAdmins` revokes every non-admin user's and deliberately leaves administrators signed in.

A re-encryption routine for `AppConfig` and a rewrap for stored DEKs would make rotation viable. Both are a separate, security-reviewed project. Neither is authorized or designed by this record, and no untested runbook stands in for them.

## Consequences

- The master key is a durability dependency, not only a security one. Never deleting the `luke_api_data` volume is a data-retention rule, not merely a session-continuity one.
- An instance whose key has been replaced usually still starts; it does not when a critical key is itself stored encrypted, because `validateCriticalConfig` then aborts startup in production. Where it does start, visibility depends on configuration: with LDAP configured the readiness probe fails once it cannot decrypt the stored settings; otherwise the instance appears healthy while encrypted settings and historical backups cannot be read.
- Recovery depends entirely on what was kept beforehand — the original key file, or a `.lukebak` export made while the original key was still in place. Neither can be produced after the fact.
- ADR-001 states that the master key must not be in backups. That is accurate about the backup archives themselves: they carry the encrypted rows and never the key, so restoring one neither recovers the key nor makes those rows readable. A passphrase-wrapped `.lukebak` is the exception only in part — it restores the archive without the master key, while the encrypted values inside it stay unreadable. Whether a copy of the key should be held elsewhere, and under what custody, is a decision this record does not take.
- Until the separate project lands, revoking many sessions at once is done by incrementing token versions, not by touching the key.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- Replacement of the master key has no dedicated detection. `validateMasterKey` accepts a freshly created key and the `secrets` probe only derives `api.jwt`; neither test-decrypts a known row. Two checks surface it incidentally rather than by design: `validateCriticalConfig`, but only if a critical key is itself stored encrypted, and the `ldap` probe, but only where LDAP is configured.
- `luke:download-token` is derived outside the three documented info constants, so the list in `CLAUDE.md` and the one in `secrets.server.ts` disagree with the code.
- Current operational documentation still contradicts this record. `API_SETUP.md` and `APP_CONFIG.md` present deleting or moving the key as a routine operation, the latter on a ninety-day schedule whose backup step preserves nothing; `README.md` states that regenerating it invalidates every token; and `OPERATIONS.md` describes the startup check as a fail-fast guarantee that a lost key would trip. Correcting them is the immediate follow-up to this record.
- The comment at the head of `apps/api/src/lib/backup/crypto.ts` says the master key can be rotated without re-encrypting historical backups. That is true of the blob and false of the wrapped DEK the blob depends on.
- `auth.nextAuthSecret` is stored encrypted under the master key although nothing reads it (ADR-018).
