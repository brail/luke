# ADR-018 — Database-Backed Runtime Configuration and Bootstrap-Only Environment

## Status

Accepted

## Context

[ADR-008](008-appconfig-env-policy.md) separated infrastructure bootstrap, kept in the environment, from application configuration, kept in the `AppConfig` table. That separation still governs how Luke is configured, and `CLAUDE.md` has since become the maintained statement of both rules. Much of what ADR-008 says around it no longer matches the code: its variable lists lack `LUKE_TRUSTED_PROXY_CIDR`, `APP_VERSION` and `NEXT_PUBLIC_APP_VERSION`; the registry has no `sensitive` flag; no application code calls the `getConfigValue` reader it names, which returns the stored string without decrypting it; `NEXTAUTH_SECRET` is read at runtime, not at compile time; and not every configuration write is audited.

This record supersedes ADR-008 and states what is decided today about the environment, the configuration store, encryption at rest and the auditing of configuration writes. ADR-008 remains, translated, as the historical record of the original decision.

## Decision

Application configuration lives in the database. The environment carries only what a process needs before it can reach the database, or what a framework or the build reads.

### The environment holds bootstrap values only

- A variable belongs in the environment only when it is needed before a database connection exists, or when a framework or the build reads it. Credentials, tokens, application passwords and every other application setting belong in AppConfig.
- The "Env Policy" section of `CLAUDE.md` is the only maintained list of permitted variables, for the API and for the web application. This record states the rule behind that list and keeps no copy of it.
- `assertEnvPolicy` in `apps/api/src/server.ts` is the first step of `start()`, before the API connects to the database. It checks every variable name against `FORBIDDEN_ENV_PATTERNS`, exits the process in production, and warns elsewhere. It is a denylist: a variable that matches no pattern passes, whether or not `CLAUDE.md` permits it. The web application runs no equivalent check.
- `.semgrep/rules/no-direct-env.yml` rejects direct `process.env.NAME` reads in application code, except for `NEXT_PUBLIC_*`, `NODE_ENV` and `APP_VERSION`. It excludes whole files and directories rather than individual reads: the test and script trees, and modules that read a permitted variable, such as `apps/api/src/server.ts`, `apps/api/src/lib/cors.ts` and `apps/api/src/lib/storageUrl.ts`. Any other read in those files goes unchecked.
- `apps/web/src/auth.ts` throws when `NEXTAUTH_SECRET` is absent in production. Outside production, it derives the secret from the master key instead.

### AppConfig is the configuration store

- Every key is declared in `AppConfigRegistry` (`packages/core/src/schemas/config.ts`) with a Zod schema, and every value is stored as a string.
- `saveConfig` in `apps/api/src/lib/configManager.ts` accepts only a registered key and validates the plaintext against that key's schema before writing.
- A setting that is not configured is absent: the write path removes it with `deleteConfig` instead of storing an empty value.
- Defaults are declared once, in `APP_CONFIG_DEFAULTS`, and read through `getConfigOrDefault`. Numeric bounds are part of the registry schema. `packages/core/src/schemas/__tests__/config.test.ts` checks the whole registry, including that every entry composes safely under `safeParse`.
- `configManager.ts` provides the readers `getConfig`, `getTypedConfig`, `getConfigOrDefault` and `getSecret`. Application code does not read configuration from `process.env`.
- `CRITICAL_CONFIG_KEYS` names the keys the API cannot start without. The API exits when it cannot connect to the database. In production it also exits when a critical key is missing or invalid; elsewhere it only warns.

### Encryption at rest

- An encrypted value is encrypted with AES-256-GCM under the 32-byte master key in `~/.luke/secret.key`, by `encryptValue` in `configManager.ts`, and stored as `iv:authTag:ciphertext`.
- Each row records in `AppConfig.isEncrypted` whether its value is encrypted. The `configManager.ts` readers decrypt only rows that carry the flag, and `getSecret` rejects a row that does not.

### Auditing of configuration writes

`CLAUDE.md` rule 4 requires an audit record for every mutation, so every AppConfig mutation must write one. These write paths record one when the write succeeds:

- `config.set`, `config.update`, `config.setMultiple` and `config.importJson`, through `upsertConfig`, and `config.delete`;
- `integrations.auth.saveLdapConfig`, `integrations.google.saveConfig`, `integrations.google.exchangeOAuthCode`, `integrations.google.disconnectOAuth`, `integrations.mail.saveConfig` and `integrations.nav.saveConfig`;
- `maintenance.backup.updateScheduleConfig`, `maintenance.backup.restore`, `maintenance.mode.schedule`, `maintenance.mode.activateNow`, `maintenance.mode.cancelScheduled` and `maintenance.mode.end`;
- `phaseAlert.updateThresholds` and `sectionAccess.setRoleDefaults`.

These write paths do not:

- `storage.saveConfig` and `integrations.storage.saveConfig`, recorded under Observed gaps;
- the maintenance scheduler's state changes through `markActivated` and `recordWarningsSent`, when a scheduled countdown ends or a warning is sent, recorded under Observed gaps;
- the seed and one-off scripts under `apps/api/prisma` and `apps/api/scripts`, which run outside the API.

## Consequences

- Application settings are changed through the configuration routers, not through the deployment's environment.
- An encrypted row can be read only with the master key that encrypted it. Replacing or losing `~/.luke/secret.key` makes every encrypted row unreadable. When the file is missing, `getMasterKey` creates a new key and `validateMasterKey` accepts it, so a lost key surfaces as decryption failures rather than as a refusal to start. The master-key rotation described in [ADR-001](001-jwt-hs256-hkdf.md) has the same effect on encrypted configuration, which that record does not mention.
- Because the startup guard is a denylist, a new variable that matches no forbidden pattern is not rejected at boot. Keeping the environment within the `CLAUDE.md` list depends on review and on `luke-no-direct-env`.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- Encryption is chosen by the caller, not by the registry. `saveConfig` takes an `encrypt` argument that defaults to `false`, each router passes its own choice for each key, and `config.set`, `config.update`, `config.setMultiple` and `config.importJson` take `encrypt` from the client. The registry carries no sensitivity attribute, so nothing prevents a secret from being stored in plaintext.
- Two write paths are not audited, contrary to `CLAUDE.md` rule 4: `storage.saveConfig`, which writes the local and S3 storage settings including the S3 access and secret keys, and `integrations.storage.saveConfig`, which writes the SMB and Drive settings.
- The maintenance scheduler writes the `maintenance.mode.state` row in AppConfig without an audit record, contrary to `CLAUDE.md` rule 4: `apps/api/src/lib/maintenanceModeScheduler.ts` calls `markActivated` when a scheduled countdown ends and `recordWarningsSent` when a warning is sent, and both write through `writeMaintenanceState` in `apps/api/src/lib/maintenanceMode.ts`.
- Two write paths bypass registry validation. `integrations.auth.saveLdapConfig` encrypts and upserts its keys with `tx.appConfig.upsert`, and `setRbacSectionDefaultsTx` in `packages/core/src/server/rbacConfig.ts` upserts `rbac.sectionAccessDefaults` directly. Both procedures validate their own input, but neither write applies the registry schema that `saveConfig` applies.
- `integrations.auth.saveLdapConfig` stores every mapped value its input defines, including an empty string, instead of removing a setting that is not configured; only a blank `bindPassword` is skipped, which keeps the stored password. The LDAP settings page submits `bindDN` as an empty string unless the administrator types it again, although the field says a blank value keeps the stored one, so saving the page replaces a stored Bind DN with an encrypted empty value.
- Some code reads AppConfig rows with Prisma instead of through `configManager.ts`, and parses the stored value itself: `apps/api/src/services/context.service.ts` for `app.context.defaults`, and `getRbacConfig` in `packages/core/src/server/rbacConfig.ts` for `rbac.sectionAccessDefaults` and `app.sections.disabled`.
- `apps/api/src/lib/storageUrl.ts` reads `storage.local.publicBaseUrl` and `app.baseUrl` with `getConfig` and applies its own fallback, not the defaults `APP_CONFIG_DEFAULTS` declares for both keys.
- `CLAUDE.md` and the message of `luke-no-direct-env` direct code to `getConfigValue` from `@luke/core`. That reader returns the stored string without decrypting it or applying the registry schema, and it swallows read errors; nothing outside its own module calls it.
- Two environment reads fall outside the `CLAUDE.md` list. `apps/web/src/lib/debug.ts` reads `NEXT_PUBLIC_LUKE_DEBUG_UI`. `apps/api/src/lib/rateLimitPolicy.ts` falls back to `LUKE_RATE_LIMIT_<ROUTE>_MAX`, `_WINDOW` and `_KEY_BY` when AppConfig supplies no valid policy, as `OPERATIONS.md` documents; it reads them by computed name, which `luke-no-direct-env` does not detect.
- The hand-written descriptions of the startup guard have drifted from it: the comment above `FORBIDDEN_ENV_PATTERNS` lists the permitted API variables without `LUKE_TRUSTED_PROXY_CIDR`, and `CLAUDE.md` lists the forbidden patterns without `NEXTAUTH_*`.
- The root `README.md` keeps its own copy of the permitted variables in its "Policy env var" section, and it has drifted: the API table lacks `LUKE_TRUSTED_PROXY_CIDR` and `APP_VERSION`, and the web table lacks `NEXT_PUBLIC_FRONTEND_URL` and `NEXT_PUBLIC_APP_VERSION`.
- `auth.nextAuthSecret` is registered, seeded and protected from deletion, but nothing reads it.
- No test covers `assertEnvPolicy`.

### Scope

Variables read only by test runners, CI and one-off scripts, such as `CI`, `PLAYWRIGHT_BASE_URL`, `E2E_*` and `SHADOW_DATABASE_URL`, are outside this record; `luke-no-direct-env` excludes the files that read them.
