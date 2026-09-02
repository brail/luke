# Changelog

All notable changes to Luke are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [2.1.4] - 2026-09-02

### CI
- **security**: Scan active release train weekly
- **security**: Match release trains by pattern instead of by name

### Dependencies
- **deps**: Bump google/osv-scanner-action in the actions-updates group (#26)

### Fixed
- **deps**: Patch mysql2 on stable line
- **deps**: Patch browserslist on stable line
- **deps**: Patch qs and fast-uri, move fastify to the 5.12.1 line
- **api**: Validate the proxy address instead of trusting a hop count

### Other
- Merge pull request #28 from brail/hotfix/mysql2-main

fix(deps): patch mysql2 and browserslist on the stable line

## [2.1.3] - 2026-08-25

### Fixed
- **api**: Await fire-and-forget logo cleanup in integration test

## [2.1.2] - 2026-08-25

### Fixed
- **api**: Preserve real Content-Type when migrating storage to MinIO

## [2.1.1] - 2026-08-25

### Documentation
- Add develop-2.1 staleness lesson to lessons.md

### Fixed
- **release**: Stop full-overwrite CHANGELOG regen, use prepend-only
- **api**: Compile db:* scripts for production instead of running raw TS


## [2.1.0] - 2026-08-25

### Added
- **api**: Add local→MinIO storage migration script

### Fixed
- **storage**: Validate all buckets, batch AppConfig reads, drop dead bucket form field
- **deps**: Bump deepmerge-ts to 8.0.2 via pnpm override — patches GHSA-ggr8-5vv4-36mx (CVE-2026-40345, CVSS 8.2 High) DoS vulnerability

### CI
- **security**: Notify on security.yml failure (#25)

## [2.0.0] - 2026-08-09

### Added
- **calendar**: Add SSE real-time calendar updates with ticket auth
- **calendar**: Custom date-range digest with net-change diff summary
- **web**: Add about page with stack and version info
- **collection**: Unify progress/eventType catalogs into Phase model
- **calendar**: Freeze/baseline snapshot for season calendars
- **calendar**: Row-scoped event anchoring for phase resolution
- **collection**: Full phase transition history for KPI tracking
- **auth**: Send verification email for LDAP users with a real address
- **collection**: On-demand alert engine for phase deadlines
- **collection**: Monitoring dashboards for saturation, bottleneck, stagnation
- **dashboard**: Daily greeting modal
- **product**: Merge saturazione/strozzatura/stagnazione into Controllo page with tabs
- **db**: Add EditLock session-lock table and MilestoneTemplateItem.allDay
- **calendar**: Multi-step planning wizard with row-fork, session lock, admin unfreeze
- **calendar**: Expose phase field on calendar events and milestone templates
- **collection-layout**: Show criticality badge in table view, not just row detail
- **calendar**: Replace CalendarEventAnchor with first-class PlanningGroup model
- **collection-layout**: Surface criticality detail, scheduling variance, and aggregate summary
- **calendar**: Batch vendor closures, richer tooltips, deep-linked notifications
- **calendar**: Working-days deadline countdown, planning/maintenance status badge
- **calendar**: Refresh alert-engine badges live, no reload needed
- **web**: Add compact size variants to Button, Select, Input
- **collection-layout,controllo**: Add pivot statistics dashboard, qtyForecast nullable
- **calendar**: Cancel/restore workflow, post-freeze lock, drop event type/owner
- **calendar**: Scope Google sync ACL to team membership, fix all-day dates, distinguish planning groups
- **calendar**: Add amend-freeze action for planning groups
- **calendar**: Add admin settings page for alert threshold config
- **maintenance**: Add backup/restore disaster-recovery + maintenance mode
- Add RC database refresh script
- **backup**: Add creation recap, cross-instance export/import, and schema migration bridge
- **audit**: Add audit log viewer and last-modified-by widget
- **calendar**: Block freeze on uncovered phases, warn on vendor-holiday overlaps
- **notifications**: Add notification center, soft-archive and per-event calendar overrides
- **web**: Support pasting images from clipboard in FileDropZone
- **api**: Add retention sweep for audit log and notifications
- **api**: Seed retention sweep AppConfig keys with their default values
- **core**: Add quotations/phaseChangeNote draft fields to collection layout row schema
- **api**: Buffer row-drawer phase/planning-group/quotation edits into one Save transaction ⚠️ **BREAKING**
- **web**: Buffer row-drawer edits until Save and redesign the phase/situazione header
- **merch**: Revisioni automatiche su milestone, non forgiabili a mano ⚠️ **BREAKING**
- **merch**: Intensità delle bande alert e conclusione esplicita delle righe
- **nav**: Persist the outcome of each scheduled sync
- **rbac**: Guard against locking everyone out of the admin functions

### CI
- **security**: Add semgrep, gitleaks and osv-scanner workflow
- Fix lint/typecheck workflow targeting stale develop branch
- Bump actions to node24 runtime, silence Node 20 deprecation warning
- Gate on tests and migrations, escalate findings to semgrep rules
- Make skill and docs drift blocking
- Derive the version list from the workspace and guard it before tagging
- **semgrep**: Catch brand scope on resource-id inputs

### Changed
- **core,api,web**: Cleanup upgrade compromises
- **core,api,web**: Simplification pass on upgrade diff
- **web,api**: Move section access evaluation server-side
- **core**: Extract calcBackoffDelay utility to @luke/core
- **calendar**: Remove what-if solver and simplify event fields
- **nav**: Move kimo/portafoglio replica sync and PG queries into @luke/nav
- **api**: Dedupe getMasterKey into core/server and tighten config surface
- **collection**: Planning band + CatalogSelectField in row modal
- **web**: Adopt compact size variants across call sites
- **web**: Simplify residue from compact-size sweep
- **web**: Dedupe copy-to-clipboard boilerplate into useCopyToClipboard hook
- **collectionLayout**: Simplify revision creation, drop row eligibility gate
- **api**: Extract streamRawResponse helper
- **core**: Remove hasPermissionWithGrants dead code
- **api**: Rename the async test context and close the helper barrel
- **api**: Drop four copies of createContext in favour of the barrel
- **api**: Cut 1740 lines of duplicated test scaffolding and dead tooling
- **api**: Extract confirmPendingFile
- Eliminate `any` across the codebase and make it enforceable
- **rbac**: Rename product.controllo section key to product.control

### Dependencies
- **deps**: Phase 1 — safe bumps and config fixes
- **deps**: Phase 2 — fastify plugins, otel, lucide-react v1, vitest v4
- **deps**: Phase 3a — typescript 6
- **deps**: Phase 3b — zod 4
- **deps**: Phase 3c — prisma 7
- **deps**: Phase 3d-g — nodemailer 9, ldapts 8, mssql 12, pino 10
- **deps**: Phase 4a — tailwind css v4 + tailwind-merge v3
- **deps**: Phase 4b — next.js 16
- **deps**: Phase 4c — eslint 10 + flat config migration
- **deps**: Phase 4d+e — pnpm 11, sonner 2, workspace config

### Documentation
- Add readme to all workspaces and docs index [luke-docs]
- Add luke-docs markers to root and api README
- Update readme tree [luke-docs]
- Add inline JSDoc comments across packages and tRPC routers [luke-docs]
- **api**: Add inline JSDoc to lib/ services/ routes/ storage/ [luke-docs]
- **web**: Add inline JSDoc to hooks/ lib/ components/ app/ [luke-docs]
- Update readme tree, inline comments and adr validation [luke-docs]
- Add ADR-008/009/010 and update adr validation [luke-docs]
- **claude**: Add dependabot target-branch reminder on develop branch change
- Add genoma collezione pianificazione notes
- Findings skippati dai simplify per genoma collezione
- Refresh README/ADR index and mark storage refactor ADR stale
- **lessons**: Document prisma migrate deploy drift with db push workflow
- **calendar**: Add JSDoc to Google Calendar client accessors
- **calendar**: Record UX deferred-items backlog and working-days design doc
- Restructure CLAUDE.md, categorize lessons.md, extract prisma workflow
- **lessons**: Add rate-limit two-map drift lesson
- Add quality hardening plan and flag the NODE_ENV dev trap
- Record the integration test ordering lesson
- Record the second hardening round and the local integration setup
- Correct the stale LDAP entry in the hardening plan
- Record the semgrep probing and module-mock lessons
- Record single-instance scaling constraint (ADR-011)
- Update readme tree and adr validation [luke-docs]
- **api**: Normalize tRPC procedure and Prisma schema doc comments [luke-docs]
- Require English-only code comments (rule 14)
- **skills**: Align luke-docs language policy with CLAUDE.md rule 14
- Fix APP_VERSION env var drift in README and ADR-008
- **skills**: Extend luke-docs inline JSDoc target to web lib/hooks
- **api**: Translate all Italian code comments to English
- Log cd-cwd-leak lesson from this session verification bug
- Translate Italian comments to English across apps/web, packages/core, packages/nav

### Fixed
- **web**: Edge runtime compat for middleware auth + jwt cache
- **api,web,core**: Security hardening, bug fixes, and code cleanup
- **docs**: Correct JWT clock tolerance from ±30s to ±5s
- **web**: Resolve turbopack workspace root and middleware deprecation warnings
- **web**: Suppress hydration warning on login inputs
- **collection-alert**: Compare phase order with >= so the current phase deadline still counts
- **calendar**: Heartbeat planning wizard session lock instead of fixed TTL
- **collection-alert**: Count deadline against live event date, not frozen baseline
- **web**: Prevent Dialog/Sheet closing when nested Select dropdown closes
- **web**: Prevent Dialog/Sheet closing when a nested Dialog/Sheet/AlertDialog closes
- **calendar**: Invalidate planningGroup.list after freeze/unfreeze
- **web**: Route error logging through debugError and clean import order
- **auth**: Refresh API access token in NextAuth jwt callback
- **api**: Register navSyncTrigger in rate-limit DEFAULTS
- **web**: Unify scrollable modals to sticky header/footer layout
- **web**: Stop forced daily logout that survives re-login
- **security**: Remediate static analysis findings
- **security**: Pin osv-scanner-action to exact version, v2 tag does not exist
- **core**: Partial() re-injects default() values on omitted fields
- **calendar,api**: Reduce in-app notification noise, add read/unread counts
- **product**: Load pricePositioning value when editing collection row
- **collection-layout**: Restore revision UI wiring, redesign as centered dialog
- **deps**: Bump vulnerable transitive deps flagged by osv-scanner
- **web**: Add build-time placeholder for NEXTAUTH_SECRET
- **api**: Use pg adapter for zero-arg PrismaClient instances
- **api**: Copy prisma.config.ts into runner stage
- **api**: Correct pdfmake deep-import casing (macOS vs Linux)
- **scripts**: Drop+recreate schema instead of pg_restore --clean
- **api**: Require pdfmake's compiled js/Printer, not raw ESM src/Printer
- **web**: Fall back to non-crypto trace-id over plain HTTP
- **backup**: Loosen runCommand env type to allow partial overrides
- **api**: Bypass Fastify reply.send() for large streamed downloads
- **calendar**: Fix template duration semantics, visibility validation, freeze naming, linked date editing
- **api**: Default daily greeting to disabled for users
- **api**: Correct middleware ordering, idempotency hashing and error mapping
- **api**: Repair CLI scripts broken by Prisma 7
- **api**: Make test isolation an invariant, not a per-file convention
- **api**: Guarantee schema before every test fixture
- **deps**: Resolve 24 known vulnerabilities, 3 critical on the auth layer
- **ci**: Skip gitignored paths in the skill integrity check
- **ci**: Apply the gitignore rule to link targets too, and honour directory patterns
- **release**: Make the version bump a command, not a manual edit
- **api**: Migrate createPdfBuffer to pdfmake 0.3, repairing every PDF export
- **calendar**: Repair the PDF export, which killed the API process
- **api**: Enforce brand scope on 17 procedures that only checked the role ⚠️ **BREAKING**
- **auth**: Make session revocation and role demotion actually take effect
- **api**: Rate-limit export generation and constrain the company logo key
- **api**: Unify assertBrandAccess and unblock admins with no team
- **api**: Enforce brand scope on 23 procedures addressed by resource id ⚠️ **BREAKING**
- **api**: Scope reorder writes to their parent
- **api**: Scope revision exports to their own layout ⚠️ **BREAKING**
- **api**: Key the upload rate limit by user, not by IP
- **api**: Bind a confirmed upload to the slot the server allocated ⚠️ **BREAKING**
- **api**: Derive the company logo key from a verified FileObject ⚠️ **BREAKING**
- **api**: Bring brand logo handling up to the company profile's guarantees ⚠️ **BREAKING**
- **api**: Prevent concurrent scheduler execution across API instances
- **web**: Persist quotation edits when Enter closes the row drawer
- **api**: Persist notification dedup state to survive process restarts
- **web**: Correct post-deny redirect path in section access guard
- **pricing**: Persist countryCode on parameter set update
- **web**: Stop season selector value from truncating
- **api**: Derive phase catalog code from order instead of independent input
- **api**: Satisfy tsconfig.test.json in retention sweep specs
- **api**: Skip deactivated phases when resolving next phase
- **web**: Aggiorna il semaforo backend della login con un poll
- **web**: Il tooltip dei bottoni senza permesso non compariva mai
- **api**: Rilascia il lock dello scheduler cancellando la riga
- **auth**: Risolvi bypass rate-limit su login (pentest Strix RC)
- **test**: Narrow the specs left behind by the `any` sweep
- **deps**: Unpin fast-uri and js-yaml, resolve 4 known vulnerabilities
- **rbac**: Close the lockout path through settings.users
- **web**: Move trailing JSX comment out of ConfigTable header row
- **rbac**: Make SECTION_ACCESS_DEFAULTS the base, not dead code
- **api**: Unbreak nav CI build and pin vulnerable nanoid
- **api**: Import @fastify/cookie for reply.clearCookie type augmentation
- **web**: Guard crypto.randomUUID() in collection-control against non-secure contexts
- **web**: Restore XLSX/PDF export wiring in collection layout page

### Maintenance
- **husky**: Remove deprecated husky.sh source from post-checkout
- **core**: Remove stale compiled artifacts from src/schemas/
- **docs**: Remove access-porting from tracking
- **ci**: Set dependabot target-branch to develop-2.1
- Rename eslint.config.js to .mjs to silence module-type warning
- **web**: Update next-env type reference path
- **api**: Enable tsx watch for the dev script
- **security**: Add semgrep and gitleaks base configuration
- **security**: Add Luke custom semgrep rules
- **security**: Add pre-commit security gates to husky hook
- **security**: Simplify security-tooling diff (4-agent /simplify pass)
- **lint**: Add eslint-plugin-luke with no-bare-zod-partial gate
- Wire lint script into every package, clear accumulated lint debt
- **web**: Add unconditional console.error in session verification
- **web**: Log error.message/data instead of JSON.stringify(result)
- Track .claude/ skills, hooks and shared settings
- Sync eslint-plugin-luke to the monorepo version
- Add prod to RC clone script via backup/export/import pipeline
- **skills**: Scope luke-* skills to their own session
- Ignore luke-docs templates in prettier
- **skills**: Drop 91 ignore markers from the ADR template
- **web,api,nav**: Normalize filenames to camelCase, translate Italian names to English

### Other
- Script per le migration Prisma 7 e tier unit per apps/web

### Tests
- **api**: Revive the test tier and split unit from integration
- **calendar**: Cover sync engine, content hash, ACL, events and iCal
- **web**: Add Playwright smoke suite, drop the never-passing legacy one
- **api**: Exercise brand through appRouter, not the sub-router
- **api**: Gate tRPC procedure coverage on measured invocations
- **api**: Cover the pricing router and the price calculation engine
- **api**: Exhaust the brand-logo rate limit without touching the database
- **api**: Cover buffered row save, quotation sync, and phase alert changes
- **web**: Update quotation smoke test for buffered save flow
- **api**: Cover sectionAccess, including the procedure no UI can reach

## [1.10.0-rc.15] - 2026-08-09

### Fixed
- **web**: Restore XLSX/PDF export wiring in collection layout page

## [1.10.0-rc.14] - 2026-08-09

### Fixed
- **web**: Guard crypto.randomUUID() in collection-control against non-secure contexts

### Maintenance
- Bump version to 1.10.0-rc.14

## [1.10.0-rc.13] - 2026-08-09

### Fixed
- **api**: Import @fastify/cookie for reply.clearCookie type augmentation

### Maintenance
- Bump version to 1.10.0-rc.13

## [1.10.0-rc.12] - 2026-08-09

### Added
- **audit**: Add audit log viewer and last-modified-by widget
- **calendar**: Block freeze on uncovered phases, warn on vendor-holiday overlaps
- **notifications**: Add notification center, soft-archive and per-event calendar overrides
- **web**: Support pasting images from clipboard in FileDropZone
- **api**: Add retention sweep for audit log and notifications
- **api**: Seed retention sweep AppConfig keys with their default values
- **core**: Add quotations/phaseChangeNote draft fields to collection layout row schema
- **api**: Buffer row-drawer phase/planning-group/quotation edits into one Save transaction ⚠️ **BREAKING**
- **web**: Buffer row-drawer edits until Save and redesign the phase/situazione header
- **merch**: Revisioni automatiche su milestone, non forgiabili a mano ⚠️ **BREAKING**
- **merch**: Intensità delle bande alert e conclusione esplicita delle righe
- **nav**: Persist the outcome of each scheduled sync
- **rbac**: Guard against locking everyone out of the admin functions

### CI
- Gate on tests and migrations, escalate findings to semgrep rules
- Make skill and docs drift blocking
- Derive the version list from the workspace and guard it before tagging
- **semgrep**: Catch brand scope on resource-id inputs

### Changed
- **api**: Extract streamRawResponse helper
- **core**: Remove hasPermissionWithGrants dead code
- **api**: Rename the async test context and close the helper barrel
- **api**: Drop four copies of createContext in favour of the barrel
- **api**: Cut 1740 lines of duplicated test scaffolding and dead tooling
- **api**: Extract confirmPendingFile
- Eliminate `any` across the codebase and make it enforceable
- **rbac**: Rename product.controllo section key to product.control

### Documentation
- Add quality hardening plan and flag the NODE_ENV dev trap
- Record the integration test ordering lesson
- Record the second hardening round and the local integration setup
- Correct the stale LDAP entry in the hardening plan
- Record the semgrep probing and module-mock lessons
- Record single-instance scaling constraint (ADR-011)
- Update readme tree and adr validation [luke-docs]
- **api**: Normalize tRPC procedure and Prisma schema doc comments [luke-docs]
- Require English-only code comments (rule 14)
- **skills**: Align luke-docs language policy with CLAUDE.md rule 14
- Fix APP_VERSION env var drift in README and ADR-008
- **skills**: Extend luke-docs inline JSDoc target to web lib/hooks
- **api**: Translate all Italian code comments to English
- Log cd-cwd-leak lesson from this session verification bug
- Translate Italian comments to English across apps/web, packages/core, packages/nav

### Fixed
- **api**: Bypass Fastify reply.send() for large streamed downloads
- **calendar**: Fix template duration semantics, visibility validation, freeze naming, linked date editing
- **api**: Default daily greeting to disabled for users
- **api**: Correct middleware ordering, idempotency hashing and error mapping
- **api**: Repair CLI scripts broken by Prisma 7
- **api**: Make test isolation an invariant, not a per-file convention
- **api**: Guarantee schema before every test fixture
- **deps**: Resolve 24 known vulnerabilities, 3 critical on the auth layer
- **ci**: Skip gitignored paths in the skill integrity check
- **ci**: Apply the gitignore rule to link targets too, and honour directory patterns
- **release**: Make the version bump a command, not a manual edit
- **api**: Migrate createPdfBuffer to pdfmake 0.3, repairing every PDF export
- **calendar**: Repair the PDF export, which killed the API process
- **api**: Enforce brand scope on 17 procedures that only checked the role ⚠️ **BREAKING**
- **auth**: Make session revocation and role demotion actually take effect
- **api**: Rate-limit export generation and constrain the company logo key
- **api**: Unify assertBrandAccess and unblock admins with no team
- **api**: Enforce brand scope on 23 procedures addressed by resource id ⚠️ **BREAKING**
- **api**: Scope reorder writes to their parent
- **api**: Scope revision exports to their own layout ⚠️ **BREAKING**
- **api**: Key the upload rate limit by user, not by IP
- **api**: Bind a confirmed upload to the slot the server allocated ⚠️ **BREAKING**
- **api**: Derive the company logo key from a verified FileObject ⚠️ **BREAKING**
- **api**: Bring brand logo handling up to the company profile's guarantees ⚠️ **BREAKING**
- **api**: Prevent concurrent scheduler execution across API instances
- **web**: Persist quotation edits when Enter closes the row drawer
- **api**: Persist notification dedup state to survive process restarts
- **web**: Correct post-deny redirect path in section access guard
- **pricing**: Persist countryCode on parameter set update
- **web**: Stop season selector value from truncating
- **api**: Derive phase catalog code from order instead of independent input
- **api**: Satisfy tsconfig.test.json in retention sweep specs
- **api**: Skip deactivated phases when resolving next phase
- **web**: Aggiorna il semaforo backend della login con un poll
- **web**: Il tooltip dei bottoni senza permesso non compariva mai
- **api**: Rilascia il lock dello scheduler cancellando la riga
- **auth**: Risolvi bypass rate-limit su login (pentest Strix RC)
- **test**: Narrow the specs left behind by the `any` sweep
- **deps**: Unpin fast-uri and js-yaml, resolve 4 known vulnerabilities
- **rbac**: Close the lockout path through settings.users
- **web**: Move trailing JSX comment out of ConfigTable header row
- **rbac**: Make SECTION_ACCESS_DEFAULTS the base, not dead code
- **api**: Unbreak nav CI build and pin vulnerable nanoid

### Maintenance
- Track .claude/ skills, hooks and shared settings
- Sync eslint-plugin-luke to the monorepo version
- Add prod to RC clone script via backup/export/import pipeline
- **skills**: Scope luke-* skills to their own session
- Ignore luke-docs templates in prettier
- **skills**: Drop 91 ignore markers from the ADR template
- **web,api,nav**: Normalize filenames to camelCase, translate Italian names to English
- Bump version to 1.10.0-rc.12

### Other
- Script per le migration Prisma 7 e tier unit per apps/web

### Tests
- **api**: Revive the test tier and split unit from integration
- **calendar**: Cover sync engine, content hash, ACL, events and iCal
- **web**: Add Playwright smoke suite, drop the never-passing legacy one
- **api**: Exercise brand through appRouter, not the sub-router
- **api**: Gate tRPC procedure coverage on measured invocations
- **api**: Cover the pricing router and the price calculation engine
- **api**: Exhaust the brand-logo rate limit without touching the database
- **api**: Cover buffered row save, quotation sync, and phase alert changes
- **web**: Update quotation smoke test for buffered save flow
- **api**: Cover sectionAccess, including the procedure no UI can reach

## [1.10.0-rc.11] - 2026-07-27

### Fixed
- **backup**: Loosen runCommand env type to allow partial overrides

### Maintenance
- Bump version to 1.10.0-rc.11
- Update CHANGELOG for v1.10.0-rc.11

## [1.10.0-rc.10] - 2026-07-27

### Added
- **backup**: Add creation recap, cross-instance export/import, and schema migration bridge

### Maintenance
- Bump version to 1.10.0-rc.10
- Update CHANGELOG for v1.10.0-rc.10

## [1.10.0-rc.9] - 2026-07-26

### Fixed
- **web**: Fall back to non-crypto trace-id over plain HTTP

### Maintenance
- Bump version to 1.10.0-rc.9
- Update CHANGELOG for v1.10.0-rc.9

## [1.10.0-rc.8] - 2026-07-26

### Maintenance
- **web**: Log error.message/data instead of JSON.stringify(result)
- Bump version to 1.10.0-rc.8
- Update CHANGELOG for v1.10.0-rc.8

## [1.10.0-rc.7] - 2026-07-26

### Maintenance
- **web**: Add unconditional console.error in session verification
- Bump version to 1.10.0-rc.7
- Update CHANGELOG for v1.10.0-rc.7

## [1.10.0-rc.6] - 2026-07-22

### Fixed
- **scripts**: Drop+recreate schema instead of pg_restore --clean
- **api**: Require pdfmake's compiled js/Printer, not raw ESM src/Printer

### Maintenance
- Bump version to 1.10.0-rc.6
- Update CHANGELOG for v1.10.0-rc.6

## [1.10.0-rc.5] - 2026-07-22

### Fixed
- **api**: Correct pdfmake deep-import casing (macOS vs Linux)

### Maintenance
- Bump version to 1.10.0-rc.5
- Update CHANGELOG for v1.10.0-rc.5

## [1.10.0-rc.4] - 2026-07-22

### Fixed
- **api**: Copy prisma.config.ts into runner stage

### Maintenance
- Bump version to 1.10.0-rc.4
- Update CHANGELOG for v1.10.0-rc.4

## [1.10.0-rc.3] - 2026-07-22

### Fixed
- **api**: Use pg adapter for zero-arg PrismaClient instances

### Maintenance
- Bump version to 1.10.0-rc.3
- Update CHANGELOG for v1.10.0-rc.3

## [1.10.0-rc.2] - 2026-07-22

### Fixed
- **web**: Add build-time placeholder for NEXTAUTH_SECRET

### Maintenance
- Bump version to 1.10.0-rc.2
- Update CHANGELOG for v1.10.0-rc.2

## [1.10.0-rc.1] - 2026-07-22

### Added
- **calendar**: Add SSE real-time calendar updates with ticket auth
- **calendar**: Custom date-range digest with net-change diff summary
- **web**: Add about page with stack and version info
- **collection**: Unify progress/eventType catalogs into Phase model
- **calendar**: Freeze/baseline snapshot for season calendars
- **calendar**: Row-scoped event anchoring for phase resolution
- **collection**: Full phase transition history for KPI tracking
- **auth**: Send verification email for LDAP users with a real address
- **collection**: On-demand alert engine for phase deadlines
- **collection**: Monitoring dashboards for saturation, bottleneck, stagnation
- **dashboard**: Daily greeting modal
- **product**: Merge saturazione/strozzatura/stagnazione into Controllo page with tabs
- **db**: Add EditLock session-lock table and MilestoneTemplateItem.allDay
- **calendar**: Multi-step planning wizard with row-fork, session lock, admin unfreeze
- **calendar**: Expose phase field on calendar events and milestone templates
- **collection-layout**: Show criticality badge in table view, not just row detail
- **calendar**: Replace CalendarEventAnchor with first-class PlanningGroup model
- **collection-layout**: Surface criticality detail, scheduling variance, and aggregate summary
- **calendar**: Batch vendor closures, richer tooltips, deep-linked notifications
- **calendar**: Working-days deadline countdown, planning/maintenance status badge
- **calendar**: Refresh alert-engine badges live, no reload needed
- **web**: Add compact size variants to Button, Select, Input
- **collection-layout,controllo**: Add pivot statistics dashboard, qtyForecast nullable
- **calendar**: Cancel/restore workflow, post-freeze lock, drop event type/owner
- **calendar**: Scope Google sync ACL to team membership, fix all-day dates, distinguish planning groups
- **calendar**: Add amend-freeze action for planning groups
- **calendar**: Add admin settings page for alert threshold config
- **maintenance**: Add backup/restore disaster-recovery + maintenance mode
- Add RC database refresh script

### CI
- **security**: Add semgrep, gitleaks and osv-scanner workflow
- Fix lint/typecheck workflow targeting stale develop branch
- Bump actions to node24 runtime, silence Node 20 deprecation warning

### Changed
- **core,api,web**: Cleanup upgrade compromises
- **core,api,web**: Simplification pass on upgrade diff
- **web,api**: Move section access evaluation server-side
- **core**: Extract calcBackoffDelay utility to @luke/core
- **calendar**: Remove what-if solver and simplify event fields
- **nav**: Move kimo/portafoglio replica sync and PG queries into @luke/nav
- **api**: Dedupe getMasterKey into core/server and tighten config surface
- **collection**: Planning band + CatalogSelectField in row modal
- **web**: Adopt compact size variants across call sites
- **web**: Simplify residue from compact-size sweep
- **web**: Dedupe copy-to-clipboard boilerplate into useCopyToClipboard hook
- **collectionLayout**: Simplify revision creation, drop row eligibility gate

### Dependencies
- **deps**: Phase 1 — safe bumps and config fixes
- **deps**: Phase 2 — fastify plugins, otel, lucide-react v1, vitest v4
- **deps**: Phase 3a — typescript 6
- **deps**: Phase 3b — zod 4
- **deps**: Phase 3c — prisma 7
- **deps**: Phase 3d-g — nodemailer 9, ldapts 8, mssql 12, pino 10
- **deps**: Phase 4a — tailwind css v4 + tailwind-merge v3
- **deps**: Phase 4b — next.js 16
- **deps**: Phase 4c — eslint 10 + flat config migration
- **deps**: Phase 4d+e — pnpm 11, sonner 2, workspace config

### Documentation
- Add readme to all workspaces and docs index [luke-docs]
- Add luke-docs markers to root and api README
- Update readme tree [luke-docs]
- Add inline JSDoc comments across packages and tRPC routers [luke-docs]
- **api**: Add inline JSDoc to lib/ services/ routes/ storage/ [luke-docs]
- **web**: Add inline JSDoc to hooks/ lib/ components/ app/ [luke-docs]
- Update readme tree, inline comments and adr validation [luke-docs]
- Add ADR-008/009/010 and update adr validation [luke-docs]
- **claude**: Add dependabot target-branch reminder on develop branch change
- Add genoma collezione pianificazione notes
- Findings skippati dai simplify per genoma collezione
- Refresh README/ADR index and mark storage refactor ADR stale
- **lessons**: Document prisma migrate deploy drift with db push workflow
- **calendar**: Add JSDoc to Google Calendar client accessors
- **calendar**: Record UX deferred-items backlog and working-days design doc
- Restructure CLAUDE.md, categorize lessons.md, extract prisma workflow
- **lessons**: Add rate-limit two-map drift lesson

### Fixed
- **web**: Edge runtime compat for middleware auth + jwt cache
- **api,web,core**: Security hardening, bug fixes, and code cleanup
- **docs**: Correct JWT clock tolerance from ±30s to ±5s
- **web**: Resolve turbopack workspace root and middleware deprecation warnings
- **web**: Suppress hydration warning on login inputs
- **collection-alert**: Compare phase order with >= so the current phase deadline still counts
- **calendar**: Heartbeat planning wizard session lock instead of fixed TTL
- **collection-alert**: Count deadline against live event date, not frozen baseline
- **web**: Prevent Dialog/Sheet closing when nested Select dropdown closes
- **web**: Prevent Dialog/Sheet closing when a nested Dialog/Sheet/AlertDialog closes
- **calendar**: Invalidate planningGroup.list after freeze/unfreeze
- **web**: Route error logging through debugError and clean import order
- **auth**: Refresh API access token in NextAuth jwt callback
- **api**: Register navSyncTrigger in rate-limit DEFAULTS
- **web**: Unify scrollable modals to sticky header/footer layout
- **web**: Stop forced daily logout that survives re-login
- **security**: Remediate static analysis findings
- **security**: Pin osv-scanner-action to exact version, v2 tag does not exist
- **core**: Partial() re-injects default() values on omitted fields
- **calendar,api**: Reduce in-app notification noise, add read/unread counts
- **product**: Load pricePositioning value when editing collection row
- **collection-layout**: Restore revision UI wiring, redesign as centered dialog
- **deps**: Bump vulnerable transitive deps flagged by osv-scanner

### Maintenance
- **husky**: Remove deprecated husky.sh source from post-checkout
- Bump version to 1.10.0-dev.0
- **calendar**: Align version to 1.10.0-dev.0
- **core**: Remove stale compiled artifacts from src/schemas/
- **docs**: Remove access-porting from tracking
- **ci**: Set dependabot target-branch to develop-2.1
- Rename eslint.config.js to .mjs to silence module-type warning
- **web**: Update next-env type reference path
- **api**: Enable tsx watch for the dev script
- **security**: Add semgrep and gitleaks base configuration
- **security**: Add Luke custom semgrep rules
- **security**: Add pre-commit security gates to husky hook
- **security**: Simplify security-tooling diff (4-agent /simplify pass)
- **lint**: Add eslint-plugin-luke with no-bare-zod-partial gate
- Wire lint script into every package, clear accumulated lint debt
- Bump version to 1.10.0-rc.1
- Update CHANGELOG for v1.10.0-rc.1

## [1.9.1] - 2026-07-13

### Fixed
- **api**: Register `navSyncTrigger` in rate-limit `DEFAULTS` map — fixed crash (`Cannot read properties of undefined (reading 'max')`) that blocked NAV vendor sync in production

## [1.9.0] - 2026-06-26

### Maintenance
- Merge develop-2.0 into main for v1.9.0 release
- Bump version to 1.9.0

## [1.9.0-rc.1] - 2026-06-26

### Added
- **calendar**: Add fullscreen expand mode
- **core**: Add company structure schemas and permissions
- **api**: Migrate to company structure model
- **api**: Add company.* router and team provisioning
- **web**: Add company settings page and migrate calendar to function model
- **api**: Assign real users to company teams in seed
- **company**: Add logo upload and export settings
- **company**: Ux overhaul profile/structure tabs and pdf company branding in footer
- **rbac**: Opt-in brand access via team scopes, drop UserSeasonAccess
- **notifications**: In-app notification system with SSE real-time delivery
- **collection**: Collection layout versioning + progress catalog refactor
- **calendar**: Vista mese default, numerazione settimane, gantt avanzato, drag-and-drop milestones
- **calendar**: Day-click to create milestone, bulk delete, per-brand edit guard
- **calendar**: Rename CalendarMilestone→CalendarEvent + configurable event types catalog
- **calendar**: Day view, brand colors, filter strip, UX overhaul
- **company**: Notify user of calendar access on team membership add
- **calendar**: What-if engine v2 — UI, holiday visualization, dependencies, simulate
- **collection**: Add collection progress + price positioning
- **api**: Collection layout revision export + season calendar updates
- **web**: Collection layout revision UI + calendar updates
- **collection**: Allow null skuForecast with double-confirm on save

### Changed
- **company**: Use useStorageUpload hook and fix logo removal bug
- **company**: Ux overhaul settings/company page
- **rbac**: Rename admin sections calendar and collection-catalog

### Fixed
- Pass MinIO credentials to minio-init container
- **api**: Refactor company router and improve team provisioning
- **web**: Fix lint errors in company settings page and sidebar
- **infra**: Provision company-assets MinIO bucket in all environments
- **company**: Close spec gaps in company structure implementation
- **company**: Soft-delete slug uniqueness + restore procedure
- Audit findings — security, bugs, and compliance fixes
- **web**: Fix ESLint import/order violations blocking CI build

### Maintenance
- Bump version to 1.9.0-dev.0
- Bootstrap release tooling and conventions
- Finalize changelog config and pre-1.9 history
- Bump version to 1.9.0-rc.1
- Update CHANGELOG for v1.9.0-rc.1

### Tests
- **api**: Company structure access and visibility tests
- **api**: Point tests to luke_test database

---

## Pre-1.9.0 history

Versions prior to 1.9.0 are not tracked commit-by-commit. The cycle delivered:

- **Season Calendar** (`@luke/calendar`): SeasonCalendar per brand+season, milestones with type/status/owner/visibility, multi-section visibility, personal notes, templates with offsetDays, calendar cloning with dateShift, Google Calendar 2-way sync with idempotent content hash, iCal export with signed token, PDF and XLSX export
- **Merchandising Plan**: SKU-level rows (color granularity), SpecsheetModal with BOM editing and image gallery, contextualized for brand+season, dedicated RBAC and storage bucket
- **Collection Catalog** (`admin.collection_catalog`): configurable items replacing hardcoded enums for Strategy, LineStatus, StyleStatus, Progress
- **CollectionRowQuotation**: pricing extracted from row, 1:N instead of 1:1
- **Dashboard widgets**: kpi-stats, season-progress, weekly-sales, tasks, forex, clocks — user-configurable
- **Sales section** (`sales.statistics`): NAV order portfolio via `NavKimoSalesLine`, XLSX export
- **Planning sections** (`planning.{sales,product,sourcing,merchandising}`): per-section calendar views
- **Settings: Google OAuth** (`settings.google`): authentication for Google Calendar sync
- **Pricing utility** extracted to `@luke/core/utils/pricing`

For commit-level detail through 1.6.3: `git log v1.0.0..v1.6.3`. From 1.7.0 to 1.8.2 commits weren't tagged; see develop-2.0 branch history.
