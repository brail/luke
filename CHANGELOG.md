# Changelog

All notable changes to Luke are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [1.9.1] - 2026-07-13

### Fixed
- **api**: Register `navSyncTrigger` in rate-limit `DEFAULTS` map — fixed crash (`Cannot read properties of undefined (reading 'max')`) that blocked NAV vendor sync in production

## [1.9.0] - 2026-06-26

### Maintenance
- Merge develop-2.0 into main for v1.9.0 release

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
