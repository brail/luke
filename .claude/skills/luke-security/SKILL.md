---
name: luke-security
description: >
  Security-focused audit for the Luke codebase. Covers IDOR, auth bypass,
  session security, input validation, rate limiting gaps, sensitive data
  exposure, LDAP injection, JWT/token issues, and invokes Trail of Bits
  sharp-edges and insecure-defaults plugins.
  Use when asked to audit security or find vulnerabilities.
  Scoping: default = diff vs merge-base. /luke-security apps/api | --since <ref> | --full
context: fork
agent: Explore
---

# Luke Security Audit

Read-only. Do NOT modify any file.
Every finding needs a concrete attack scenario — no theoretical issues.

**Leggi per primo `.claude/skills/luke-shared/audit-protocol.md`** e applicalo
integralmente: scoping sul diff (§1), soppressione via baseline (§2), sezione
obbligatoria "Promozione a regola" (§3), `lessons.md` come input di check (§4).

Scope: risolvilo secondo §1 del protocollo condiviso — `$ARGUMENTS` vuoto significa
**diff vs merge-base**, non intero monorepo.

Eccezione allo scoping: i controlli su autenticazione, sessione e gestione dei
token vanno valutati **sempre a livello di sistema**, anche quando il diff non li
tocca. Un bypass nasce spesso dall'interazione fra codice nuovo e un controllo
esistente altrove: qui limitare la lettura al diff nasconde proprio la classe di
problemi che questa skill cerca.

---

## Phase 1 — Trail of Bits Static Analysis

Invoke these plugins if installed, passing the scoped path:

1. `Skill(sharp-edges)` — error-prone APIs, dangerous default configurations
2. `Skill(insecure-defaults)` — fail-open patterns when config is missing

If either plugin is not installed, note it in the report and continue.

---

## Phase 2 — Aree di controllo

Tre aree, un passaggio solo. Vedi la nota sul fan-out in `../luke-shared/audit-protocol.md` §6.

### 1 — Authentication, Session & Token Security

1. **LDAP injection**: `searchFilter` or `groupSearchFilter` built from user input without sanitization — `(&(uid=${username}))` allows filter injection
2. **Session fixation**: after successful login (especially LDAP), verify new session token is generated and pre-auth session is invalidated
3. **JWT secret exposure**: `getApiJwtSecret()` or `getNextAuthSecret()` in client-side code or in any logger call
4. **Token validation gaps**: JWT verification that checks signature but not expiry, issuer, or audience
5. **Password reset token entropy**: token generation using `Math.random()` or tokens shorter than 32 bytes (64 hex chars) — CRITICAL
6. **Missing auth on tRPC procedures**: public procedures (no `requirePermission`) returning or modifying non-public data. Check especially: `getById` procedures, anything under `product.*` or `admin.*` routers
7. **Privilege escalation via role assignment**: user update procedures — can non-admin change their own role or another user's role?
8. **Admin-only endpoints reachable by editor**: `pricing:update`, `users:delete`, `maintenance:update`, `settings:update` — verify not reachable by editor through any code path

---

### 2 — Authorization (IDOR) & Input Validation

**IDOR:**

1. tRPC procedures accepting an ID and returning the resource without verifying the requesting user has access to THAT SPECIFIC record — check: collection layout rows, pricing parameter sets, vendor/brand/season operations
2. Horizontal privilege escalation: procedures scoped to `brandId`/`seasonId` from user input — verify brand/season belongs to current context, not just that it exists
3. Permission check bypass via HTTP: any routes outside tRPC (REST endpoints, Next.js API routes) without equivalent permission checks

**Input validation:** 4. **Zod schema bypass**: procedures where `.parse()` result is ignored and original input is used in subsequent operations 5. **AppConfig key injection**: endpoint accepting config key as user input and writing to AppConfig without validating against `AppConfigRegistry` — attacker could overwrite `auth.strategy` 6. **Path traversal in storage**: storage operations where `key` or `bucket` comes from user input without sanitization 7. **SQL injection via sanitizeCompany**: any direct string interpolation of `config.company` into SQL without `sanitizeCompany()` — CRITICAL 8. **JSON.parse on user input**: user-supplied strings parsed as JSON without try/catch AND without schema validation on parsed result

---

### 3 — Sensitive Data & Rate Limiting

**Sensitive data exposure:**

1. tRPC responses including encrypted config values or password fields:
   - `getNavConfig` must return `hasPassword: boolean`, not the password
   - `getLdapConfig` must return `hasBindPassword: boolean`, not the credential
   - User queries must not return password hash
2. TRPCError messages including SQL error details, file paths, stack traces, or internal IDs sent to frontend
3. `logAudit()` storing sensitive field values (password fields, encrypted config) in plaintext
4. `appConfig.upsert` for keys matching `*password*`, `*secret*`, `*token*`, `*key*` where `isEncrypted: false`
5. `logger.info/debug` or `debugLog` logging request bodies, config objects, or user data containing sensitive fields

**Rate limiting & DoS:** 6. Missing rate limiting on: `/trpc/auth.login`, password reset, email verification, LDAP test connection — brute force / enumeration attack vector 7. Storage `put` operation: verify `maxFileSizeMB` limit is enforced BEFORE reading stream into memory — check after buffering = DoS via large upload 8. `findMany` without `take` limit on user-controlled filters — attacker can request all records 9. Manual sync trigger endpoint not rate-limited — each call opens mssql connection pool 10. Complex regex patterns applied to user input without length limits (LDAP searchFilter, AppConfig key validation) — ReDoS risk

---

## Report Format

```
## Luke Security Audit Report
Scanned: <path or 'full monorepo'>
Date: <today>
Trail of Bits: sharp-edges ✅/❌  |  insecure-defaults ✅/❌

### Trail of Bits Findings
[Output from sharp-edges and insecure-defaults if installed]

### Summary
| Area                          | CRITICAL | HIGH | MEDIUM |
|-------------------------------|----------|------|--------|
| Auth & Session & Tokens       |    N     |  N   |   N    |
| IDOR & Input Validation       |    N     |  N   |   N    |
| Sensitive Data & Rate Limiting|    N     |  N   |   N    |

### Findings

**[CRITICAL/HIGH/MEDIUM]** — <title>
File: `path/to/file.ts:line`
Attack scenario: <exact how an attacker exploits this>
Impact: <what they can do>
Fix:
\`\`\`typescript
// proposed fix
\`\`\`
Test di regressione: <file di destinazione + asserzione chiave>

### Promozione a regola
<sezione obbligatoria — vedi §3 del protocollo condiviso>
```

### Rules

- CRITICAL: auth bypass, data exfiltration, privilege escalation, injection
- HIGH: information disclosure, missing rate limit, weak tokens
- MEDIUM: defense-in-depth gap with moderate exploitability
- No LOW — security either matters or it doesn't
- Every finding needs a concrete attack scenario
- If area is clean: `✅ No findings`
