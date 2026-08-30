---
name: luke-audit
description: >
  Compliance audit of the Luke codebase against architectural constraints in
  CLAUDE.md. Finds violations of stack rules, AppConfig misuse, auth/crypto
  issues, RBAC drift, pricing/collection errors, storage misuse, NAV patterns,
  frontend shadcn violations, and dev pattern failures.
  Use after vibe coding sessions or before releases.
  Scoping: default = diff vs merge-base. /luke-audit apps/web | --since <ref> | --full
context: fork
agent: Explore
background: false
disallowed-tools: Edit, Write, NotebookEdit
---

# Luke Architecture Audit

Read-only. Do NOT modify any file.
Find violations of the architectural constraints in CLAUDE.md.
Report findings with proposed fixes — never apply them.

**Read `.claude/skills/luke-shared/audit-protocol.md` first** and apply it in
full: diff scoping (§1), baseline suppression (§2), the mandatory "Promotion
to rule" section (§3), `lessons.md` as a check input (§4).

Then read these files:

- `CLAUDE.md` (project root)
- `lessons.md` (project root, if it exists)
- `packages/core/src/schemas/config.ts` (AppConfigRegistry)
- `packages/core/src/schemas/rbac.ts` (sectionEnum, SECTION_TO_PERMISSION, SECTION_ACCESS_DEFAULTS)
- `packages/core/src/auth/permissions.ts` (RESOURCES, ROLE_PERMISSIONS)
- `packages/core/src/storage/config.ts` (`isValidBucket()` — the authoritative bucket list)
- `packages/core/src/schemas/pricing.ts` (`PRICING_CURRENCIES` — the authoritative currency list)

These source files are the single source of truth for enum-like checks below —
never assume a hardcoded count or list from this skill file.

Scope: resolve it per §1 of the shared protocol — empty `$ARGUMENTS` means
**diff vs merge-base**, not the whole monorepo.

---

## Check Areas

Three areas, one single pass. See the fan-out note in `../luke-shared/audit-protocol.md` §6.

### 1 — Stack, Config & Env

**Stack constraints:**

- `npm install`, `npm run`, `yarn` anywhere in scripts/docs (must be pnpm)
- Raw SQL outside `packages/nav/src/`
- `$queryRaw` / `$executeRaw` outside nav package
- `any` type without explanatory comment on same line
- `// @ts-ignore` or `// @ts-expect-error` without explanation
- `console.log/warn/error/info` in `apps/api/src/` (must use Pino) or `apps/web/src/` (must use `lib/debug.ts`). Exception: `apps/api/prisma/` scripts.

**AppConfig system:**

- `process.env.*` in `apps/` or `packages/core/` outside these allowed files:
  `packages/core/src/runtime/env.ts`, `apps/*/next.config.*`, `apps/*/src/middleware.*`
- AppConfig keys used in `prisma.appConfig.findUnique/upsert` that are NOT in `AppConfigRegistry`
- Sensitive keys (`password`, `pass`, `secret`, `token`) read with `decrypt: false`

**Env policy:**

- `.env` or `.env.*` files containing forbidden patterns: `SMTP_*`, `LDAP_*`, `JWT_*`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`
  Allowed exceptions: `NEXTAUTH_SECRET`, `COOKIE_SECURE`

**Dev patterns:**

- `user.role === 'admin'` or `user.role === 'editor'` inline instead of `hasPermission()`
- `console.*` leaking through (covered above)
- Missing `onDelete:` on any `@relation` in `schema.prisma`
- Missing `@@index` on FK fields or commonly filtered columns (`isActive`, `navVendorId`, `brandId`, `seasonId`, `vendorId`) in `schema.prisma`
- Dependency version mismatch: same package at different versions across `package.json` files in the monorepo

---

### 2 — Auth, Crypto, RBAC & Sections

**Auth & crypto:**

- Import of `secrets.server`, `getMasterKey`, `deriveSecret`, `getApiJwtSecret` from `@luke/core` directly (must be `@luke/core/server`)
- Crypto utilities imported in client-side files (no `typeof window` guard)

**RBAC:**

- Any AppConfig write to RBAC keys NOT followed by `invalidateRbacCache()`
- tRPC mutations without `requirePermission()` call
- tRPC read-only procedures using `requirePermission('entity:update')` instead of `entity:read`
- Missing `withAuditLog` or `logAudit()` on procedures named `create`, `update`, `delete`, `remove`, `restore`, `unlink`

**Section system — cross-reference these three sources:**

- `sectionEnum` in `packages/core/src/schemas/rbac.ts`
- `SECTION_TO_PERMISSION` in same file
- `SECTION_ACCESS_DEFAULTS` in same file

Check:

1. Every `sectionEnum` value has an entry in `SECTION_TO_PERMISSION`
2. Every `sectionEnum` value has an entry in `SECTION_ACCESS_DEFAULTS` for all 3 roles
3. Every `SECTION_TO_PERMISSION` value maps to a valid `resource:action` in `VALID_RESOURCE_ACTIONS`
4. Any frontend route/nav item referencing a section string not in `sectionEnum`

**LDAP:**

- Auth strategy hardcoded instead of reading `auth.strategy` from AppConfig
- LDAP config written to AppConfig without `ldapConfigSchema` validation

**Multi-table writes:**

- Prisma write operations on 2+ related tables NOT wrapped in `prisma.$transaction()`
- `prisma.$transaction([...])` array syntax where operations depend on each other's results (should use callback syntax)

---

### 3 — Domain Logic, Storage & Frontend

**Pricing:**

- tRPC mutations for pricing parameter sets accessible to `editor` role (admin-only)
- Currency values not in `PRICING_CURRENCIES` (see `packages/core/src/schemas/pricing.ts`)
- Pricing calculations not scoped to both `brandId` and `seasonId`

**Collection Layout:**

- `COLLECTION_PROGRESS` values as free strings instead of imported constant
- `COLLECTION_STRATEGY`, `COLLECTION_STATUS`, `COLLECTION_GENDER` as free strings
- Column visibility allowing more than 7 visible columns
- `skuBudget` on a Row or `skuForecast` on a Group (inverted)
- Collection row picture URLs constructed manually instead of `buildCollectionRowPictureUploadUrl()`

**Storage:**

- File handling outside an `IStorageProvider` implementation
- Bucket names not accepted by `isValidBucket()` in `packages/core/src/storage/config.ts`
- `/upload/` or `/api/uploads/` paths constructed manually
- `enableProxy` hardcoded instead of reading from config

**NAV sync:**

- NAV table names built without `sanitizeCompany()`
- Any import from `apps/api` inside `packages/nav`
- mssql requests missing `request.timeout = 60_000`
- NAV + local upsert NOT in `prisma.$transaction()`
- Sync touching `isActive` or enriched fields on local entities

**Frontend (apps/web/src only):**

- Direct `@radix-ui/` imports bypassing shadcn
- `style={{` for visual styling
- className via string concatenation instead of `cn()`
- Hex/rgb/hsl colors hardcoded instead of CSS variables
- Tailwind arbitrary values without justifying comment
- Hardcoded `localhost:3001` or absolute API URLs
- `globalThis.confirm(` or `window.confirm(` instead of `<ConfirmDialog>`
- `canCreate()`, `canUpdate()`, `canDelete()` called with parentheses (booleans, not functions)

---

## Report Format

```
## Luke Audit Report
Scanned: <path or 'full monorepo'>
Date: <today>

### Summary
| Area                    | HIGH | MEDIUM | LOW | Status   |
|-------------------------|------|--------|-----|----------|
| Stack & Config & Env    |  N   |   N    |  N  | ✅/⚠️/🔴 |
| Auth & RBAC & Sections  |  N   |   N    |  N  | ✅/⚠️/🔴 |
| Domain & Storage & UI   |  N   |   N    |  N  | ✅/⚠️/🔴 |

✅ clean  ⚠️ LOW only  🔴 HIGH or MEDIUM present

Suppressed by baseline: N

### Findings

#### [AREA]

**[HIGH/MEDIUM]** — <title>
File: `path/to/file.ts:line`
Problem: <why this violates the constraint and what risk it creates>
Fix:
\`\`\`ts
// proposed fix
\`\`\`

**[LOW]** — <title> — `file.ts:line`
Fix: <one-line fix>

### Promotion to rule
<mandatory section — see §3 of the shared protocol>
```

### Rules

- HIGH: security, data corruption, broken auth/access control
- MEDIUM: architectural drift that compounds over time
- LOW: style inconsistency, minor deviation
- Max 25 findings — prioritize HIGH and MEDIUM
- If area is clean: `✅ No findings`
- Do NOT suggest refactors outside CLAUDE.md constraints
