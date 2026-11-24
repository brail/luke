# ADR-050 — Outbound Boundary: Audit Addresses Only With users:read

## Status

Accepted

## Context

[ADR-034](034-outbound-boundary-for-sensitive-data-and-masked-configuration-reads.md) is the record of the
outbound boundary for sensitive data. One of its deliberate exceptions returns `AuditLog.metadata` verbatim from
`auditLog.list` under `audit:read_all`. The list also returned every actor's and subject's email, and the export
the actor's email. A person reference elsewhere shows another user by name and username, and their email requires
`users:read` (CLAUDE.md, RBAC). Only `admin` holds `audit:read_all` today, and it also holds `users:read`. A role
given `audit:read_all` alone would have read every address in the trail.

The owner decided (#286, 2026-11-21, option a) that the audit list and its export show another user's address only
to a caller who also holds `users:read`, and that an address recorded in a row's details is masked the same way. This
changes a condition of ADR-034's audit exception, so it supersedes ADR-034
([ADR-047](047-documentation-architecture-decisions-in-force-index-by-area-and-short-records.md)).

## Decision

This record supersedes ADR-034 as a whole. Its decisions remain unchanged except for the audit-read rule below.

- **Addresses wait for `users:read`.** `auditLog.list` returns `actorEmail`, `subjectEmail` and the addresses in
  `metadata` only to a caller who holds `users:read` as well as `audit:read_all`. For any other caller the two
  emails are `null`, and `maskAuditAddresses` (`apps/api/src/lib/auditLog.ts`) replaces every address-shaped
  substring of every metadata string, at any depth, with `[REDACTED: users:read]`. Masking goes by value, not by
  key name, so the dedicated keys (`email`, `userEmail`, `deletedEmail`), free text such as an SMTP error, and a
  username typed as an address are all covered. The request is not refused, and the caller's own address is masked
  too: one rule, no comparison of ids.
- **The export reads its requester again.** `auditLog.getExportLink` signs the requester's id and `tokenVersion`
  into the link. Before streaming, `/download/audit-log` reads that user again:
  - missing, inactive, with sessions revoked since (`tokenVersion` changed), or no longer holding
    `audit:read_all`: 403;
  - holding it without `users:read`: the `Email` column is left empty.

  A link without a requester is refused.
- **Read time only.** The filter changes what is returned, never what is stored. `sanitizeMetadata` still filters on
  write, as ADR-034 decides.

## Consequences

- What an administrator reads does not change. A role given `audit:read_all` without `users:read` reads names and
  usernames.
- An export link stops working within its five minutes if its requester loses `audit:read_all`, is deactivated or
  has their sessions revoked. The check runs once, before streaming: an export already running finishes with the
  permissions it started with.
- `actorName` and `subjectName` stay a person reference: a username that is itself an address (an LDAP UPN) is
  shown, as everywhere a username is.
