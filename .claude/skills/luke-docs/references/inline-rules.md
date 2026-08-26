# luke-docs — Inline comment rules (`inline` mode)

Language: **English** for all inline comments (JSDoc, tRPC, Prisma `///`).
No exception for Italian domain terms (e.g. "stagione"→season,
"campionario"→collection/catalog, "reso"→return): always translate. See
CLAUDE.md, Development Patterns section, rule 14.

## Merge logic (applies to every phase)

**Before writing any comment, read the existing one (if present):**

| Situation                              | Behavior                                                       |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Comment accurate and complete            | Leave unchanged — don't touch it                                   |
| Comment accurate but incomplete          | Add the missing content, preserve the existing text                |
| Comment drifted from the real signature  | Rewrite it, flag it in the report as "updated"                     |
| Comment absent                           | Create from scratch                                                 |

---

## JSDoc on TypeScript exports (`packages/**/src`, `apps/web/src/lib`, `apps/web/src/hooks`)

Same template for all three targets. `apps/web/src/lib` and
`apps/web/src/hooks` were added on 2026-08-08 — before that, `inline` mode
only covered `packages/`. Don't extend to `apps/web/src/components` or
`apps/web/src/app` (too much volume, JSX doesn't map well to signature
JSDoc) without a separate, explicit decision.

Template for an **exported function**:

```typescript
/**
 * {One-sentence description of what it does. Active verb: "Calculates", "Returns", "Validates".}
 *
 * @param paramName - {Description only if not self-explanatory}
 * @returns {Description of the returned value}
 * @throws {ErrorType} {Condition}
 *
 * @example
 * const result = myFunction({ id: 'abc' });
 */
export function myFunction(...) { ... }
```

Template for an **exported type / interface**:

```typescript
/**
 * {Description of the domain concept it represents, not its shape.}
 * Example: "Immutable snapshot of a CollectionLayout at revision time."
 */
export type MyType = { ... }
```

Template for an **exported constant / enum**:

```typescript
/**
 * {Allowed values for {field}. Used in {context}.}
 */
export const MY_ENUM = ['A', 'B', 'C'] as const;
```

**JSDoc rules:**

- Don't add JSDoc to internal, non-exported functions (unless they're
  complex and have no comment at all)
- Don't add `@param` for self-explanatory parameters (`id: string`, `enabled: boolean`)
- Don't describe the implementation — describe the observable behavior
- Don't repeat the function name in the description ("MyFunction does X" → write "Does X")

---

## tRPC procedure comments (`apps/api/src/routers/`)

```typescript
/**
 * {What this procedure does, in one sentence.}
 *
 * @auth {Required RBAC action, e.g.: "collection:read" | "admin" | "public"}
 * @input {Brief input description. Reference the Zod schema if it has a name.}
 * @output {Description of the returned payload.}
 */
```

The `@auth` value must be verified against the real middleware
(`requirePermission(...)`), never inferred from the procedure name.

---

## Prisma field docs (`///`)

Prisma uses **triple slash** `///` for comments that become part of the
generated types. Never `//` (double slash) — it's ignored by the tooling.

```prisma
/// Layout of a collection: groups + rows with independent ordering.
model CollectionLayout {
  /// Unique identifier (UUID v4).
  id        String   @id @default(uuid())

  /// FK to Brand. Determines the owning brand of the layout.
  brandId   String

  /// Current FSM state (draft → published → archived).
  status    LayoutStatus @default(DRAFT)
}
```

**Prisma rules:**

- Skip `id`, `createdAt`, `updatedAt` unless the semantics are non-standard
- **Always** comment: FKs (explain what they reference), enum fields
  (explain the states), fields with a non-obvious `@default`, `@relation`
  relationships
- Also add `///` above the `model ModelName {` line with one description
  line for the model

---

## What NOT to touch in `inline` mode

- `// TODO:`, `// FIXME:`, `// HACK:` — preserve as-is
- Blocks of commented-out code — do NOT remove; add
  `// luke-docs:flag stale-commented-code` above for manual review
- Any comment in `.planning/`, `CLAUDE.md`, `lessons.md`
- Comments explaining the **why** of a decision (architectural rationale) —
  these are worth more than comments explaining the _what_
- Commented-out imports used as a quick reference during development (but flag them)

---

## Inline quality checklist (verify before closing)

- [ ] No JSDoc describes the implementation instead of the behavior
- [ ] Every tRPC procedure with `@auth` has the correct value (verified against the middleware)
- [ ] Prisma `///` comments are on the field, not on the inline type
- [ ] No comment was removed (only added or modified)
- [ ] `luke-docs:flag` markers were added where expected
