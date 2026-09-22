# ADR-024 — Shared Validation Schemas and Message Audience

## Status

Accepted

## Context

[ADR-005](005-shared-zod-schemas.md) decided that Zod schemas belong in `packages/core/src/schemas/`, so that one definition serves both the tRPC input and the React Hook Form resolver. That decision holds and is carried forward unchanged; the extraction it called for is still partly outstanding.

Two of its subsidiary rules no longer do. It instructs "Use error messages in Italian" — written before [ADR-015](015-documentation-architecture-and-canonical-language.md) and in conflict with the audience rule that record established. It also prescribes a single naming convention the corpus does not follow, and its examples are built on `adminOrEditorProcedure`, a symbol no longer present in the source.

This record supersedes ADR-005 and restates the decision with those corrections. ADR-005 remains as the historical record of the original decision.

## Decision

### Shared schemas, reaffirmed

A schema shared between the API and the web application lives in `packages/core/src/schemas/`, and both import the same object, so a constraint changed in one place reaches both sides at once. The shared catalogue is real and in use: 29 schema modules, 37 API routers importing from `@luke/core`, and 39 `zodResolver` call sites across 34 `apps/web` modules. It is deliberately not exhaustive — see Observed gaps. Most modules export the inferred type alongside the schema, though not all: `MandatoryReasonSchema` in `packages/core/src/schemas/reason.ts` exports none.

### Message language is decided by audience, not by a blanket rule

ADR-005's instruction to write error messages in Italian is replaced by the rule in ADR-015 and `CLAUDE.md`: English is canonical for technical prose, Italian is permitted only in genuine product UI and end-user interaction pending the i18n cycle, and **the audience decides — not the file the string sits in**.

For a validation message, the audience is where it surfaces. Two end-user paths were traced here:

- react-hook-form renders the message verbatim through `FormMessage` (`apps/web/src/components/ui/form.tsx`), fed by `zodResolver`;
- a tRPC input or registry validation failure becomes a `BAD_REQUEST`, and the web layer puts a `BAD_REQUEST` message in front of the user (`apps/web/src/lib/trpcErrorMessages.ts`).

Both are end-user surfaces. A message reaching either is product UI and stays as it is until i18n.

**No non-UI exception is currently established.** The two candidates examined both turned out to have an end-user consumer: the JSON-parse message in `packages/core/src/schemas/config.ts` reaches one through `saveConfig`, which raises a `BAD_REQUEST` carrying it, and the SMB and Drive messages in `packages/core/src/storage/config.ts` do so as a tRPC input union in `integrations.storage.router.ts`. Before any message's language is changed it must be traced to every consumer; one with a form path or a `BAD_REQUEST` path stays put.

This record changes no message. Translating them is i18n work, not documentation work.

### Naming follows the module, not one imposed convention

`*Schema` exports use both casings: PascalCase predominates (`BrandInputSchema`, `packages/core/src/schemas/brand.ts`) and a smaller set is camelCase (`mailSmtpConfigSchema`, `packages/core/src/schemas/mail.ts`). Neither is wrong, and this record imposes neither. A new schema follows the convention of the module it joins; that module's existing exports are the reference, not a list maintained elsewhere.

## Consequences

- A shared constraint has one definition, so the two sides cannot hold different ideas of what it says. That is narrower than "cannot drift apart": sharing a schema closes the distance between field and endpoint only while the submitted payload matches the field set the form validated. `docs/TASK_router_schemas_to_core.md` records two call sites where it does not — fields attached to the payload after `form.handleSubmit` has run, and a dialog collecting input with no schema at all — so constraints already present in `@luke/core` go unapplied on the client.
- The audience test asks where a message surfaces rather than who wrote it, because one object can feed both surfaces. It does not follow that every schema message reaches a user by both routes. In the calls examined for this record, the server's text is displayed when that web path uses `getTrpcErrorMessage` and no entity override replaces it for `BAD_REQUEST`; paths that were not examined are not covered by that statement.
- The existing Italian messages remain until the i18n cycle; that cycle, not this record, is what changes them.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- Centralization is partial. 104 inline `.input(z.object(…))` definitions remain across 22 routers, and that figure is the union of two different things: schemas intentionally local to one endpoint, which `docs/TASK_router_schemas_to_core.md` says should stay where they are — a filter used by a single endpoint gains nothing from extraction — and schemas still awaiting extraction into `@luke/core`. That document holds the criterion separating the two; this record does not restate it, and the 104 should not be read as a backlog count.
- The shared-schema catalogue in `CLAUDE.md` names ten identifiers that no module exports: seven are casing errors for exports that exist as `UserSchema`, `BrandSchema`, `SeasonSchema`, `VendorSchema`, `PricingParameterSetInputSchema`, `CollectionLayoutRowInputSchema` and `AppConfigSchema`, and `rbacSchema`, `authSchemas` and `mailSchema` exist in no casing. An author following that list would write the drift this record is meant to prevent. Correcting it is outside this record's scope.
- Nothing mechanically prevents a new schema message from being written in the wrong language for its audience. The canonical-language guard is recorded as pending in `.claude/skills/luke-shared/governance-map.md`, so enforcement here is review.
- `adminOrEditorProcedure`, which ADR-005's examples use, survives only in `apps/api/RBAC_COVERAGE.md`. That document is stale on this point and is not corrected by this record.
