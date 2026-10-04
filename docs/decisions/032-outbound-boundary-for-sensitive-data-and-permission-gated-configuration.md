# ADR-032 — Outbound Boundary for Sensitive Data and Permission-Gated Configuration Values

## Status

Accepted

## Context

[ADR-023](023-sensitive-data-outbound-boundary.md) replaced ADR-004's unconditional `select` rule with the boundary Luke actually enforces: a small set of secret and key fields must never leave the process, and two fields are returned deliberately behind stated gates. Its decision still holds, but three of its statements about those gates no longer describe the code.

Reading a decrypted configuration value was gated by an inline `role !== 'admin'` comparison; it is now gated by the `config:update` permission, and a refusal is logged like every other permission refusal ([ADR-029](029-resource-action-permissions-one-builder-logged-refusals.md)). That changes a condition of one of ADR-023's governed exceptions, so under [ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md) it is recorded by a superseding ADR rather than an erratum. Separately, `config.get` was removed, leaving four configuration procedures that return stored values, and `storage.getConfig` stopped returning the S3 secret key.

This record supersedes ADR-023 and restates its decision as it holds today. ADR-023 remains as the historical record, including the query census its context reported when it was accepted.

## Decision

### The guarded set and the outbound rule

The **guarded set** is `LocalCredential.passwordHash`, `UserToken.tokenHash`, and the backup key material `BackupRecord.wrappedDekHex` with its `ivHex` and `authTagHex`.

**A value from the guarded set must not cross the outbound trust boundary: a tRPC result, an HTTP response body, a log line, or an `AuditLog.metadata` record.** Reading one is confined to the code that consumes it for verification, for a crypto operation, or for a write.

This is a rule about what leaves the process, and nothing more. It makes no claim about in-process values or about storage; see Limits below.

Personal data is outside the guarded set. `Identity.metadata`, which holds LDAP attributes, is governed by no rule here; no response reads it today, which is an observation, not a rule.

### Explicit `select` is recommended practice, not a requirement

An explicit `select` narrows a query to what the caller needs and makes review cheaper, and it remains the preferred form — particularly where a nested `include` would otherwise pull a guarded field into memory. It is not an unconditional requirement: `count`, `aggregate` and the `*Many` writes accept no projection, and an existence check gains nothing from one. A missing `select` is not by itself a defect; a guarded value crossing the boundary is.

### Governed exceptions

- **`AuditLog.metadata`** is returned verbatim by `auditLog.list`, which requires `audit:read_all`. It is filtered on write rather than on read, and the filter is allowlist-first: `sanitizeMetadata` consults `FREE_TEXT_KEYS`, `MAP_VALUED_KEYS` and then `SAFE_KEY_LIST` before the `/password|token|secret|key|auth|credential|bind/i` pattern, so a key the allowlist vouches for is stored even when it matches the pattern — `key`, `configKey`, `hasBindPassword`, `passwordUpdated` and `secretKeyUpdated` among them. An unlisted key holding a scalar is redacted; one holding an object or an array is walked, and its children are filtered by their own names. What the allowlist admits is a deliberate decision recorded there, and it is bound to a type: a metadata key outside it fails type checking where metadata is written, and outside production it is refused at run time rather than redacted.
- **`AppConfig.value`** is returned by four procedures of the config router. **Reading a decrypted value requires `config:update`, a stronger permission than the `config:read` that reads stored and masked values.**
  - `config.viewValue` requires `config:read` and masks an encrypted value as `[ENCRYPTED]`; its raw mode requires `config:update` and writes an audit row.
  - `config.getMultiple` requires `config:read` and does not mask: without `decrypt` it returns the stored string as it stands, which for an encrypted key is the `iv:authTag:ciphertext` blob. With `decrypt` it requires `config:update`.
  - `config.list` requires `config:read` and returns `valuePreview` — `null` for an encrypted key, the stored value in full for every other, despite a name that implies a truncation.
  - `config.exportJson` requires `config:update` and never decrypts: an encrypted key exports as `[ENCRYPTED]`, the rest in full when `includeValues` is set and as `null` otherwise.

  Only `admin` holds either permission today, so both gates resolve to the same callers; the distinction holds by itself if `config:read` is ever granted to another role.
- **Integration settings return no stored secret.** These routers are the other paths through which stored configuration values leave. `storage.getConfig` (requiring `config:read` and the `settings.storage` section) reports whether an S3 secret key is stored instead of returning it, and returns the S3 access key decrypted by choice: an access key identifies the account and grants nothing without its secret. The LDAP and NAV settings respond through schemas without their password, with a flag that one is stored.

`User.tokenVersion` is returned by `auth.login` and `auth.refreshToken` by design: the session layer compares it to revoke sessions ([ADR-019](019-tokenversion-session-revocation.md)). It is not in the guarded set.

### Limits of this record

- **In-process values may carry guarded fields.** `createResetToken` returns the whole `UserToken` row, `tokenHash` included, although its declared type promises `{ id, expiresAt }`; its callers read only those two, and the plaintext token it also returns goes only to the email sender. The rule governs the boundary, not the shape of objects behind it.
- **Protected storage may hold guarded fields by design.** The `<backupId>.meta.json` sidecar stores `wrappedDekHex`, and the audit-log archive serializes whole audit rows into the private `backups` bucket.
- **ADR-023's audit traced the paths it examined** and found no guarded value reaching a client on them. That remains an observation about what was examined, not proof that no secret can escape by a path that was not.

## Consequences

- Enforcement is human review plus the write-time audit filter. No procedure validates its result with a tRPC `.output()` schema, neither ESLint rule ADR-004 proposed exists, and its shared-projection helper was never written. Hand-written projections — the backup list's explicit select among them — stand between a query and the wire.
- A reviewer's question is not "does this query have a `select`" but "can a guarded value reach a response, a log, or an audit record from here".
- A decrypted configuration value and a masked one are different capabilities with different permissions, so granting `config:read` to a new role does not grant decrypted reads.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- **A secret stored with `isEncrypted: false` is read back in plaintext** by any holder of `config:read`, because masking is driven by that flag and encryption is chosen by the caller rather than declared by the registry ([ADR-018](018-runtime-configuration-and-bootstrap-environment.md)). It is a property of how values are written, not of the outbound boundary.
- Several write paths return an unprojected row: `sectionAccess.set` through an `upsert`, and `company.profile.get` and `company.profile.update` through a `create` and an `upsert` on `CompanyProfile`. No guarded field is involved in any of them.
