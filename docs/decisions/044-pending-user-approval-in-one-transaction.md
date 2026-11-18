# ADR-044 — Pending-User Approval in One Transaction

## Status

Accepted

## Context

[ADR-027](027-section-access-leaf-overrides-and-validated-defaults.md) made the approval of a pending
user an attempt of three steps sent by the dialog: the role, through `users.update`; then the section
overrides, one `sectionAccess.set` per leaf; then `users.approvePending`, which assigns the team. Each
step committed on its own. When the approval was refused — an inactive team, a concurrent approval,
an address still synthetic — the role and overrides already written stayed on an account that was
still pending (CLAUDE.md, Development Patterns rule 1).

An LDAP user whose directory has no mail is refused approval until they give an address on the
pending screen (#266). An administrator had nowhere to enter one: pending users are not in the users
list, and the approval dialog had no address field (#272).

This record replaces ADR-027's approval rule only. The rest of ADR-027 — leaf overrides, validated
role defaults, the editor's fresh read, reconciliation and `stale` state, the migration — stands.

## Decision

- **One call, one transaction.** `users.approvePending` takes the team and, from an administrator
  (`*:*`), the address, the role and the section overrides. It applies them in one `$transaction`,
  in this order: address, role, overrides, team and approval. A refusal anywhere leaves the account
  as it was. The dialog makes one call per attempt.
- **The same writers and rules.** The address goes through `moveUserEmail`: the stored form, the
  unique constraint, unverified, its links revoked, an `EMAIL_CHANGED` row. A new address or role ends
  the account's sessions, as in `users.update`. Each override goes through `applySectionOverride`, the
  path `sectionAccess.set` also takes: no override on a parent, the recovery guard, and
  [ADR-043](043-section-access-a-leaf-turns-on-only-with-its-permission.md)'s check against the role
  the approval has just written. The lock order is `users.update`'s: the last-admin lock, then the
  user row.
- **The address in the approval.** For an account on a synthetic address, the dialog asks an
  administrator for a real one; whoever else may approve sees why they cannot. The approval replaces
  only a synthetic address: one the user gave on the pending screen meanwhile is refused as a
  replacement, and the dialog, re-reading the account, stops asking. The server still refuses an
  approval that would leave the address synthetic. After the commit the new address gets its
  verification link, as on the pending screen's own path.
- **After a failure.** Nothing of the attempt is stored. The dialog re-reads the stored role, the
  pending status and the overrides, as ADR-027 describes, and keeps the administrator's choices for
  another attempt.

## Consequences

- A pending account is never left half-configured by a refused approval.
- An administrator can approve a directory user without mail in one step, with an address that
  survives later sign-ins: the directory realigns the address only when it has one.
- `sectionAccess.set` and the approval share one implementation of the override rules, so neither
  can drift from the other.
- The approval mail goes to the address the approval leaves. The integration tests cannot observe
  it: the test stack has no mail server.
