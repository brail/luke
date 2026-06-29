# Documentazione Luke

<!-- luke-docs:start:index -->
## Architettura & Design

| File | Descrizione |
|------|-------------|
| [architecture-brand-flows.md](architecture-brand-flows.md) | Mappa architetturale dei flussi Brand — relazioni tra entità, lifecycle e transizioni di stato |
| [collection-layout-versioning.md](collection-layout-versioning.md) | Sistema di revisioni del piano di collezione — registro qualità ISO 9001:2015, snapshot immutabili |
| [storage-immutable-bucket.md](storage-immutable-bucket.md) | Bucket immutabile per foto revisioni — content-addressed storage, SHA-256 key, policy di retention |
| [nav-integration.md](nav-integration.md) | Architettura integrazione Microsoft Dynamics NAV — pattern entità duale, sync differenziale, tabelle replica |
| [google-calendar-setup.md](google-calendar-setup.md) | Setup integrazione Google Calendar — configurazione OAuth, provisioning calendario stagione, sync milestone |

## Decisioni Architetturali (ADR)

Le decisioni architetturali rilevanti sono documentate in [`decisions/`](decisions/):

| # | Titolo |
|---|--------|
| [001](decisions/001-jwt-hs256-hkdf.md) | JWT HS256 con derivazione HKDF-SHA256 per i segreti |
| [002](decisions/002-rbac-policy.md) | RBAC Policy e Enforcement (Resource:Action) |
| [003](decisions/003-core-server-only.md) | Core Package — export server-only isolati |
| [004](decisions/004-prisma-select-only.md) | Prisma Select-Only Pattern (prevenzione data leakage) |
| [005](decisions/005-shared-zod-schemas.md) | Schemi Zod centralizzati in `@luke/core` |
| [006](decisions/006-resource-action-permissions.md) | Sistema permessi Resource:Action unificato |
| [007](decisions/007-storage-layer-refactor.md) | Refactor storage layer — interfaccia `IStorageProvider` |
| [008](decisions/008-appconfig-env-policy.md) | AppConfig KV System e Env Policy |
| [009](decisions/009-tokenversion-session-invalidation.md) | TokenVersion Multi-Layer Session Invalidation |
| [010](decisions/010-section-access-precedence.md) | Section Access a 4 Layer di Precedenza |

## Analisi & Report

| File | Descrizione |
|------|-------------|
| [audit-report-brand-management.md](audit-report-brand-management.md) | Report audit architetturale — gestione Brand |
| [luke-taric-classifier.md](luke-taric-classifier.md) | Integrazione classificatore TARIC — categorizzazione doganale articoli |

## Directory operative

| Directory | Descrizione |
|-----------|-------------|
| [merchandising-reference/](merchandising-reference/) | Materiali di riferimento per il dominio merchandising |
| [access-porting/](access-porting/) | Documentazione porting da Microsoft Access — reverse engineering e analisi query |

*Ultimo aggiornamento: 2026-06-30*
<!-- luke-docs:end:index -->
