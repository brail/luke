# Changelog

All notable changes to Luke are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [1.10.0-rc.6] - 2026-07-22

### Fixed
- **scripts**: Drop+recreate schema instead of pg_restore --clean
- **api**: Require pdfmake's compiled js/Printer, not raw ESM src/Printer

### Maintenance
- Bump version to 1.10.0-rc.6

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
