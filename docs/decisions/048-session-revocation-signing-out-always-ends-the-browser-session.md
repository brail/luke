# ADR-048 — Session Revocation: Signing Out Always Ends the Browser Session

## Status

Superseded by [052 — Session Revocation: Pushed at Once, with One Sign-Out Signal](052-session-revocation-pushed-and-one-sign-out-signal.md)

## Context

[ADR-039](039-session-revocation-tokenversion-and-absolute-lifetime.md) made signing out end every
session of the user through `auth.logout`, a `selfProcedure` that maintenance mode refuses to whoever
cannot bypass it. The web's button called it first and stayed signed in on any answer but success or
`UNAUTHORIZED`. The button lived only in the sidebar and the context gate. A failed `(app)` layout,
the global error page, the 404 page and the maintenance lock screen gave a signed-in user no way
out, and maintenance, a request limit or an error kept the user signed in.

The owner decided (#238, 2026-11-10) that signing out is always possible, from every page and in
every state, with the browser session cleared even when the server-side end fails. This changes what ADR-039 decides about signing out, so it supersedes ADR-039 ([ADR-047](047-documentation-architecture-decisions-in-force-index-by-area-and-short-records.md)).

## Decision

This record supersedes ADR-039 as a whole. Its decisions stand unchanged except for two parts of its
"Signing out" section, which this section replaces: the web's sign-out button, and the clause that a
user refused by maintenance stays signed in. `auth.logout` itself, and its maintenance guard, are
unchanged. The automatic sign-outs still do not call it.

- **One sign-out path.** `POST /api/auth/logout` (`apps/web/src/app/api/auth/logout/route.ts`, running
  `serverLogout` in `apps/web/src/lib/serverLogout.ts`) is reached by a native form post
  (`LogoutForm`, no JavaScript needed). Every sign-out control posts it: the sidebar, the context
  gate, `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, the maintenance lock screen and
  the confirmation page `/logout`, which the maintenance lock never covers. A GET to
  `/api/auth/logout` answers 405.
- **Provenance first.** Before reading anything, the request must carry `Sec-Fetch-Site:
  same-origin`. Without it, its `Origin`, or failing that its `Referer`, must be the public origin:
  `NEXTAUTH_URL`'s, or the request's own when that is unset. `Origin: null` is refused and does not
  fall back. A refused request changes nothing and is redirected to `/logout`.
- **A bounded revocation.** The session cookie is read under the app's cookie name, salt and secret,
  never through `auth()`, whose `jwt` callback can refresh the token with
  no deadline. `auth.logout` is called with the bearer the cookie holds, through
  `createAuthedTrpcClient` (client IP forwarded), with a 5-second timeout. It counts as done when the
  call succeeds or answers `UNAUTHORIZED`, and when the request carries no session cookie at all:
  nothing is left to end from this browser. Any other answer, a timeout, or a session cookie that
  cannot be read leaves it incomplete.
- **The browser session is always cleared.** Auth.js `signOut({ redirect: false })` deletes every
  session cookie chunk. The answer is a 303 to `/login`, or to `/login?signout=incomplete`, where the
  login page says this browser is signed out but the sessions on other devices stay open until they
  expire. The web writes no audit row; `AUTH_LOGOUT` stays the API's.

Rejected alternatives:

- **Keep the client-side button and add a form only on the error pages.** Two paths, and the sidebar
  would still keep a user signed in on a 429.
- **Auth.js's built-in sign-out endpoint.** Its CSRF token needs JavaScript, and its events cannot
  tell the user that the server-side end failed.
- **A server action.** It needs the router runtime, which the global error page may have lost.
- **Exempting `auth.logout` from maintenance.** That would add a writing builder outside the maintenance
  guard ([ADR-042](042-resource-action-permissions-session-only-builder-for-maintenance-reads.md)).

## Consequences

- A failed sign-out never leaves the user signed in in this browser. When the server-side end fails,
  the browser's bearer stays valid until it expires (at most 8 hours), but nothing in the browser
  holds it any more. Other devices keep their sessions until they expire, at most 12 hours after
  login. A maintenance window set to `forceLogout` revokes non-admin sessions anyway. The owner
  accepted this residual risk (2026-11-22).
- A sign-out posted from another site, or with no verifiable origin, needs one more click on
  `/logout`.
- A repeated post has the same outcome. Concurrent posts are not promised one revocation each.
- The smoke test (`apps/web/tests/smoke/logout.smoke.spec.ts`) proves the path over HTTP without
  JavaScript; it runs outside CI until #207, and only the unit test proves the 5-second timeout.
