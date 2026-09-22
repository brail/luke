# ADR-023 — Outbound Boundary for Sensitive Data

## Status

Accepted

## Context

[ADR-004](004-prisma-select-only.md) required an explicit `select` on every `findMany`, `findUnique` and `findFirst`, on the premise that a query without one "returns every field" and would expose `passwordHash`, `localCredential` and `metadata` from a bare `User` query.

That premise is wrong. A Prisma query without `select` or `include` returns the model's scalar fields and no relations, and none of those three is a `User` scalar: `passwordHash` belongs to `LocalCredential`, `metadata` to `Identity`, and `localCredential` is a relation two hops away. A bare `findUnique` on `User` cannot return any of them.

The rule built on that premise is also not met. Counting read queries — `findMany`, `findUnique`, `findFirst` — on the models that carry secrets or hashes, outside tests and generated code, the paths that matter most carry no explicit `select`: `AppConfig` 3 of 19, `UserToken` 0 of 2, `Identity` 0 of 1, and `LocalCredential` is never read directly at all. Restating an unconditional rule the code does not follow would reproduce ADR-004's defect under a new number.

This record supersedes ADR-004 and states the boundary that is actually enforced. ADR-004 remains as the historical record of the original decision.

## Decision

### The guarded set and the outbound rule

The **guarded set** is `LocalCredential.passwordHash`, `UserToken.tokenHash`, and the backup key material `BackupRecord.wrappedDekHex` with its `ivHex` and `authTagHex`.

**A value from the guarded set must not cross the outbound trust boundary: a tRPC result, an HTTP response body, a log line, or an `AuditLog.metadata` record.** Reading one is confined to the code that consumes it for verification, for a crypto operation, or for a write.

This is a rule about what leaves the process, and deliberately nothing more. It makes no claim about in-process values or about storage; see Limits below.

Personal data is outside the guarded set. ADR-004 also named `Identity.metadata`, which holds LDAP attributes; this record governs secret and key material only and takes no position on PII handling. Nothing reads `Identity.metadata` into a response today — the unprojected `Identity` reads are consumed in process — but that is an observation, not a rule stated here.

### Explicit `select` is recommended practice, not a requirement

An explicit `select` narrows a query to what the caller needs and makes review cheaper, and it remains the preferred form — particularly where a nested `include` would otherwise pull a guarded field into memory, as `include: { localCredential: true }` does. It is not an unconditional requirement: `count`, `aggregate` and the `*Many` writes accept no projection, and an existence check gains nothing from one. A missing `select` is not by itself a defect; a guarded value crossing the boundary is.

### Governed exceptions

Two fields are returned deliberately, each behind a stated gate:

- **`AuditLog.metadata`** is returned verbatim by `auditLog.list`, which carries `requirePermission('audit:read_all')`. It is filtered on write rather than on read, and the filter is **allowlist-first**: `sanitizeMetadata` consults `FREE_TEXT_KEYS`, `MAP_VALUED_KEYS` and then `SAFE_KEY_LIST` before it reaches the `/password|token|secret|key|auth|credential|bind/i` pattern, so a key the allowlist vouches for is stored even when it matches that pattern — nine currently do, among them `key`, `configKey`, `hasBindPassword` and `passwordUpdated`. Between them the pattern and the default branch redact every unlisted key holding a scalar; an unlisted key holding an object or an array is walked instead, and its children are filtered by their own names. What the allowlist admits is a deliberate decision recorded there.
- **`AppConfig.value`** is returned by five procedures of the config router, which differ in both gate and masking. They are not the only paths that return a stored configuration value — other routers do too, and one of them is recorded under Observed gaps.
  - `config.get` and `config.viewValue` carry `requirePermission('config:read')` and mask an encrypted value to `[ENCRYPTED]`. Returning the decrypted form — `decrypt` on the first, `mode: 'raw'` on the second — is additionally gated by an inline `role !== 'admin'` check.
  - `config.getMultiple` carries the same permission and the same inline check, but does **not** mask: without `decrypt` it returns the stored string as it stands, which for an encrypted key is the raw `iv:authTag:ciphertext` blob rather than a placeholder.
  - `config.list` carries `config:read` and returns `valuePreview` — `null` for an encrypted key, the stored value in full for every other, despite a name that implies a truncation which does not happen.
  - `config.exportJson` carries `requirePermission('config:update')` rather than `config:read`, and never decrypts: an encrypted key exports as `[ENCRYPTED]`, the rest export in full when `includeValues` is set and as `null` otherwise.

  Only `admin` holds either permission today, so every gate above currently resolves to the same set of callers.

`User.tokenVersion` is returned by `auth.login` and `auth.refreshToken` **by design**: the session layer compares it to revoke sessions ([ADR-019](019-tokenversion-session-revocation.md)). It is not in the guarded set.

### Limits of this record

- **In-process values may carry guarded fields.** `createResetToken` returns the whole `UserToken` row, `tokenHash` included, although its declared type promises `{ id, expiresAt }`; its callers read only those two. The rule governs the boundary, not the shape of objects behind it.
- **Protected storage may hold guarded fields by design.** The `<backupId>.meta.json` sidecar stores `wrappedDekHex`, and `auditLogArchive` serializes whole audit rows into the private `backups` bucket. Both are intended.
- **The audit behind this record traced the paths it examined.** It covered `apps/` and `packages/` by static reading, tests excluded, and found no guarded value reaching a client on those paths. That is an observation about what was examined, not proof that no secret can escape by a path that was not.

## Consequences

- Enforcement is human review. There is no tRPC `.output()` validation anywhere in the repository, neither ESLint rule ADR-004 proposed exists, and the `packages/core/src/prisma/selects.ts` helper it sketched was never written. Hand-written projections are what stand between a query and the wire.
- Because the rule is about the boundary rather than about query shape, a reviewer's question changes: not "does this query have a `select`" but "can a guarded value reach a response, a log, or an audit record from here".

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- **A secret stored with `isEncrypted: false` is read back in plaintext** by any holder of `config:read`, because the masking is driven by that flag and encryption is chosen by the caller rather than declared by the registry ([ADR-018](018-runtime-configuration-and-bootstrap-environment.md)). This record does not address it; it is a property of how values are written, not of the outbound boundary.
- The decrypt and raw sub-gates on `config.get`, `config.viewValue` and `config.getMultiple` are inline `role !== 'admin'` comparisons rather than `hasPermission`, contrary to the RBAC rule in `CLAUDE.md`. They are redundant while only `admin` holds `config:read`, and would become the sole distinction if that permission were ever granted to another role.
- `storage.getConfig` returns **decrypted** `storage.s3.accessKey` and `storage.s3.secretKey` behind `requirePermission('config:read')` and `withSectionAccess('settings')`, with no inline admin sub-gate at all. Its caller set is identical to the config procedures' today, because only `admin` holds `config:read`; the difference is that nothing there distinguishes reading a masked value from reading a decrypted credential. Whether that is an intended exception or a gap is not settled by this record.
- Several write paths return an unprojected row: `sectionAccess.set` through an `upsert`, and `company.get` and `company.update` through a `create` and an `upsert` on `CompanyProfile`. No guarded field is involved in any of them.
