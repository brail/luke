# ADR-037 — Core Package Export Boundary: Two Subpaths

## Status

Accepted

## Context

[ADR-022](022-core-package-export-boundary.md) states the boundary of `@luke/core`: an ESM-only package that publishes exactly three subpaths, `.`, `./server` and `./utils/date`, whose resolution `packages/core/test/module-contract.cjs` pins.

The third subpath published `utils/date.ts`, the instant formatters that write an instant without a zone (`formatDate`) or fall back silently to the zone of the process when the one they are given is invalid (`formatDateWithTimezone`). [ADR-035](035-date-and-time-model-calendar-days-instants-and-two-zone-roles.md) replaced them, in the main entry, with a formatter that takes an explicit zone for instants (`formatInstant`) and one that takes none for calendar days (`formatCalendarDate`), and left the subpath to a later decision: once the formatters left `utils/date.ts`, it would be repointed or retired, and retiring it would supersede ADR-022 (ADR-035 §Not decided here). Since `1281a0ce` no file in the workspace calls them, and nothing imports the subpath.

Alternatives considered:

- **Repoint the subpath at `dateUtils.ts`.** Rejected: it would publish an entry no consumer uses. A narrow subpath exists to spare a consumer the main barrel, and the zone-explicit helpers are already in the main entry.
- **Keep the subpath and its module.** Rejected: it would keep publishing the formatters ADR-035 rules out.

## Decision

This record supersedes ADR-022 as a whole. Its decisions stand unchanged except where this section says otherwise.

- `@luke/core` publishes exactly two subpaths: `.` and `./server`. `./utils/date` is retired with the module it published, `utils/date.ts`. Its formatters are not carried forward under another name; the date helpers are reached through the main entry.

## Consequences

- An import of `@luke/core/utils/date` fails to resolve (`ERR_PACKAGE_PATH_NOT_EXPORTED`). `module-contract.cjs` pins the two remaining subpaths, and that the retired one no longer resolves.
- Core publishes no formatter that writes an instant without a zone. Code that formats instants directly with `Intl` or the local `Date` methods remains a gap of [ADR-036](036-date-and-time-model-moving-both-ends-of-a-timed-event.md), not of this record.
- References to ADR-022 for its unchanged decisions remain valid; ADR-022 stays as the historical record.

### Observed gaps

ADR-022's observed gaps are this record's; a later closure is recorded in this record's errata, citing the passage of ADR-022 and the change. Open at acceptance:

- No test asserts the runtime throw of `secrets.server.ts`.
- Nothing asserts that a built client bundle excludes server code.
