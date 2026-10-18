/**
 * The release identity this build carries.
 *
 * `APP_VERSION` is injected as a Docker `ARG`/`ENV` from the release tag, already normalized by the
 * provenance gate (`tools/scripts/check-release-provenance.ts` emits `3.0.0-rc.1`, never
 * `v3.0.0-rc.1`). It is build-time metadata rather than configuration, so it is read from the
 * environment and never from AppConfig: a running image must not be able to disagree with itself
 * about which release it is.
 *
 * This module imports nothing, and that is load-bearing. `instrument.ts` is loaded through
 * `node --require ./dist/instrument.js` before the server and before the OpenTelemetry
 * instrumentations register (`apps/api/entrypoint.sh`), so anything imported here would be pulled
 * into the process earlier than it is today. Keep it a leaf.
 *
 * Both accessors read the environment on every call instead of snapshotting it into a module-level
 * constant, so a test can set `APP_VERSION` and observe the result.
 */

/**
 * The release identity, or `null` when this build carries none — a local build, a test run, an
 * image built without the build argument.
 *
 * For consumers that must record the *absence* of a release identity rather than invent one: the
 * backup pipeline persists this into `BackupRecord.appVersion` and into the `.lukebak` sidecar and
 * export header, where a stored `null` means "no release identity" and a stored `"dev"` would
 * quietly destroy that distinction.
 *
 * An empty or blank `APP_VERSION` is treated as absent rather than as a second spelling of the same
 * state, so no surface ever renders a bare `Luke - v`.
 */
export function releaseIdentity(): string | null {
  const raw = process.env.APP_VERSION;
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The release identity for the display and runtime surfaces that must always render something,
 * falling back to `dev` for a build that carries no release tag.
 */
export function appVersion(): string {
  return releaseIdentity() ?? 'dev';
}
