/**
 * The release identity to display, formatted once, in one place.
 *
 * `NEXT_PUBLIC_APP_VERSION` is inlined into the client bundle at build time from the Docker
 * `ARG APP_VERSION` (`apps/web/Dockerfile`). Two different builds feed it, and they feed it
 * different things on purpose:
 *
 * - `.github/workflows/release.yml`, building the release images, passes the provenance gate's
 *   normalized output — `3.0.0-rc.1`, never `v3.0.0-rc.1`;
 * - `.github/workflows/ci.yml`'s `Build (web)` step passes the `dev` sentinel, which is also the
 *   `ARG` default, so an ordinary CI build and a local one look alike and neither claims a release.
 *
 * The variable is read as a literal here, and nowhere
 * else, because that literal form is what Next replaces at build time; a dynamic lookup would not
 * be inlined and would read as absent in the browser.
 *
 * The display `v` is applied here and only here. It used to be prepended at each call site, and
 * the API side of that same habit is what shipped `Luke - vv2.1.4` in every exported xlsx once the
 * build argument itself carried a `v`.
 *
 * The rule: prefix `v` only when the value starts with a digit. That covers every value this
 * repository can produce, and it is what keeps the `dev` sentinel — the `ARG APP_VERSION=dev`
 * default of both Dockerfiles, and the CI web build — from rendering as `vdev`.
 *
 * | NEXT_PUBLIC_APP_VERSION | returns        |
 * | ----------------------- | -------------- |
 * | absent or blank         | `null`         |
 * | `dev`                   | `dev`          |
 * | `3.0.0-rc.1`            | `v3.0.0-rc.1`  |
 */
export function appVersionLabel(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_VERSION;
  if (raw === undefined) return null;
  const version = raw.trim();
  if (version === '') return null;
  return /^\d/.test(version) ? `v${version}` : version;
}

/**
 * The full text of the sidebar/login version line: the release identity and the development marker,
 * composed here rather than in the component.
 *
 * The composition is the part that is easy to get wrong. `pnpm dev` sets no
 * `NEXT_PUBLIC_APP_VERSION`, so a component that nested the marker inside a version guard would drop
 * the marker in exactly the environment it exists for. Keeping it in a pure function means that
 * mistake is a failing test rather than something only a human clicking around would notice.
 *
 * Returns `null` when there is nothing to say at all.
 */
export function appVersionText(): string | null {
  const version = appVersionLabel();
  const development = process.env.NODE_ENV === 'development';

  if (version && development) return `${version} · development`;
  if (version) return version;
  return development ? 'development' : null;
}
