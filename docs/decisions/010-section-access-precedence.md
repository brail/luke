# ADR-010 — Section Access with Four Precedence Layers

## Status

Accepted

## Context

The visibility of UI sections (e.g. `product.pricing`, `settings.ldap`, `admin.vendors`) cannot be governed by the RBAC role alone. There are orthogonal requirements:

- **Operational kill switch**: disable a section globally for everyone (maintenance, feature flag)
- **Per-user override**: grant or deny access to a section for a single user regardless of their role (e.g. a `viewer` with temporary access to pricing)
- **Per-role defaults configurable at runtime**: change the visibility defaults for a role without a deploy (e.g. hiding `sales.statistics` from the `viewer` for a specific season)
- **Deterministic fallback**: in the absence of an override, the system must converge on a value based on what the role can do (`RBAC Resource:Action`)

A single layer does not cover all four requirements at once.

## Decision

`effectiveSectionAccess()` in `packages/core/src/rbac/effectiveAccess.ts` resolves the visibility of a section by applying 4 layers in decreasing order of precedence:

```
0. Global kill switch     — disabledSections[] from AppConfig
1. User override          — UserSectionAccess.enabled (bool | null)
2. Runtime role default   — AppConfig rbac.sectionAccessDefaults (JSON)
3. RBAC fallback          — SECTION_TO_PERMISSION → hasPermission()
```

The first layer that produces a non-`auto` / non-`null` result wins. Layer 3 is always defined (it cannot return `null`).

### Section configuration

Every section is defined in **three places in sync** in `packages/core/src/schemas/rbac.ts`:

1. `sectionEnum` — the section key
2. `SECTION_TO_PERMISSION` — maps a section → `Resource:Action`
3. `SECTION_ACCESS_DEFAULTS` — default visibility per role (version-controlled)

The runtime per-role defaults live in AppConfig (`rbac.sectionAccessDefaults`). After every write to RBAC keys in AppConfig, `invalidateRbacCache()` must be called.

### User override

`UserSectionAccess` has three states: `enabled=true`, `enabled=false`, `absent` (no override). Absence delegates to the next layer — it is not equivalent to `false`.

## Consequences

- Adding a new section requires updating three places in sync: `sectionEnum`, `SECTION_TO_PERMISSION`, `SECTION_ACCESS_DEFAULTS`. Forgetting one causes non-deterministic behaviour (layer 3 does not find the permission and denies by default)
- `invalidateRbacCache()` must be called after every write to `rbac.*` in AppConfig — if forgotten, role default changes do not propagate until the next restart
- Layer 0 (kill switch) is intended for operational emergencies and maintenance — not for security access control (use `requirePermission` for that)
- Layer 1 (user override) allows controlled escalation of visibility privileges without touching the user's role — useful for demos or temporary onboarding
