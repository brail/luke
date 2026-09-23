# Luke Documentation

<!-- luke-docs:start:index -->
## Getting started

Start with the [repository overview](../README.md) for the monorepo map and
[`CLAUDE.md`](../CLAUDE.md) for the engineering rules that govern changes. Use
the sections below to find architecture, procedures, reference material, and
preserved evidence.

## Architecture and decisions

| Resource | Purpose |
|----------|---------|
| [Architectural decisions](decisions/README.md) | Canonical index of Architecture Decision Records, including status and supersession links. |
| [Collection Layout versioning](collection-layout-versioning.md) | Revision model for Collection Layout snapshots, history, immutable storage, and access control. |
| [Immutable revision storage](storage-immutable-bucket.md) | Content-addressed storage and retention contract for Collection Layout revision images. |
| [Microsoft Dynamics NAV integration](nav-integration.md) | One-way NAV-to-Luke synchronization architecture, data ownership, and operational boundaries. |
| [Collection Genome planning](genoma-collezione-pianificazione.md) | Feasibility analysis mapping the Collection Genome model onto Luke's existing calendar and collection domains. |
| [Country-aware working days](country-aware-working-days.md) | Design and resolution rules for counting working days by vendor or company country in milestone deadlines and criticality. |

## How-to and runbooks

| Resource | Purpose |
|----------|---------|
| [Google Calendar setup](google-calendar-setup.md) | Provision and configure the Google Calendar integration. |
| [Prisma migration workflow](prisma-migration-workflow.md) | Generate, review, and apply versioned migrations for the multi-file Prisma schema. |
| [Production-to-RC data clone](rc-prod-clone.md) | Clone production data into RC without exposing the production master key. |

## Reference

| Resource | Purpose |
|----------|---------|
| [Merchandising reference](merchandising-reference/) | Local, git-ignored reference material for the merchandising domain. |
| [Microsoft Access porting](access-porting/) | Local, git-ignored reverse-engineering notes and query analysis for Access migrations. |

## Historical evidence

| Resource | Purpose |
|----------|---------|
| [Brand management architecture audit](audit-report-brand-management.md) | Historical audit and remediation record for Brand management. |
| [Agent engineering and platform governance audit](LUKE_AGENT_PLATFORM_GOVERNANCE_AUDIT_2026-08-30_v3.md) | Frozen assessment of agent, platform, skill, and control-plane governance. |
| [Monorepo audit and closure appendices](LUKE_MONOREPO_AUDIT_2026-08-30.md) | Append-only evidence ledger for the monorepo remediation program. |
| [Documentation archive](archive/README.md) | Index of retired designs and other frozen historical documents. |
<!-- luke-docs:end:index -->
