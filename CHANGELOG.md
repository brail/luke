# Changelog

All notable changes to Luke are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [Unreleased]

### Added
- **calendar**: Add fullscreen expand mode

### Fixed
- Pass MinIO credentials to minio-init container

### Maintenance
- Bump version to 1.9.0-dev.0
- Bootstrap release tooling and conventions

---

## [1.9.0] — Collection Layout Versioning

### Added

- **feat(collection)**: Versioning ISO-compliant del Collection Layout — registro qualità formale conforme a PI 8.3-01 rev5 "Progettazione"
  - Revisioni immutabili etichettate (rev0, rev1…) con snapshot completo di righe, foto, quotazioni
  - Sei tipi di revisione preconfigurati con categorie ISO 9001:2015 (PIANIFICAZIONE, RIESAME, NORMALE, VERIFICA, VALIDAZIONE)
  - Storico revisioni con drill-down per revisione
  - Time-travel: query `getLayoutAsOfRevision` con backward lookup via `DISTINCT ON`

- **feat(core)**: Nuovi permessi `collection_layout:revise` e `collection_layout:view_revisions`; schemi `CreateRevisionInputSchema`, `GetRevisionsListInputSchema`, `GetRevisionDetailInputSchema`, `GetLayoutAsOfRevisionInputSchema`

- **feat(api)**: Quattro nuovi modelli Prisma (`CollectionLayoutRevision`, `CollectionGroupRevision`, `CollectionLayoutRowRevision`, `CollectionRowQuotationRevision`); service `collectionLayoutRevision.service.ts`; router tRPC `collectionLayoutRevision`

- **feat(core,api)**: Bucket immutabile `collection-row-pictures-revisions` per le foto delle revisioni con dedup CAS via sha256; `copyToImmutableBucket()` nel layer storage

- **feat(web)**: Drawer "Crea revisione" con selezione righe e warning ISO; pagine storico e drill-down revisioni; bottoni "Storico revisioni" e "Crea revisione" nel CL

- **refactor(collection)**: Progress catalog refactoring — i valori `progress` passano da stringhe leggibili (`01 - FASE DI DESIGN`) a chiavi semantiche (`DESIGN`) con `code` separato per la visualizzazione; aggiornati export PDF/XLSX e badge CL

- **feat(web)**: `PageHeader` ora accetta prop `actions` per bottoni nella testata della pagina

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
