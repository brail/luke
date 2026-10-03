# ADR-028 — Runtime Images Carry Runtime Dependencies Only, and Prove It

## Status

Accepted

## Context

Both runtime images copied the builder's full `node_modules`. The builder installs the whole workspace — TypeScript, vitest, ESLint, Playwright, commitlint and everything they pull in — so all of it shipped to production: 1143 store entries in the API image, 559 of them reached by no production dependency. Nothing in the API or the web server loads them, but a dev-only advisory then exists "in the production image" for every container scanner, the images are larger than they need to be, and anyone inside a container has the toolchain at hand. GHSA-vfj7-8cjw-p6xm (`braces`, no fixed version) is how this surfaced: its `osv-scanner.toml` entry had to say that the package, unreachable at runtime, was still on disk in both images.

Nothing could have told. CI built no image — the first build of a Dockerfile change was a release tag — and `release.yml` built and pushed in a single step, with no look inside in between. The only structural guard was `checkWebRuntimeHasNoApiSource`, written after the same class of mistake: `@luke/api` source, a build-time need, copied into the web runtime.

## Decision

### API — a production-dependency stage

`apps/api/Dockerfile` gains a `deps-prod` stage built from the builder: it deletes every `node_modules`, runs `pnpm install --frozen-lockfile --prod --prefer-offline --ignore-scripts --filter '@luke/api...'` — `@luke/api` and the workspace packages it depends on, production dependencies only, from the same lockfile and the store the builder filled — then `pnpm rebuild --filter '@luke/api...'`. Two steps because pnpm runs the workspace root's own `prepare` (husky) and `postinstall` (`prisma generate`) even under `--filter`, and their tools are devDependencies; `rebuild` runs the dependencies' build scripts alone (argon2, Prisma's engines, protobufjs). The first CI build, with the one-step install, failed on exactly that. The runner takes every `node_modules` from that stage and everything else (`dist`, Prisma schema and config, `dist-scripts`, templates) from the builder. The layout is unchanged, so `entrypoint.sh` and the compose files are too.

`typescript` and `react` remain in the API image on purpose: they are peers of the `prisma` CLI, which `@luke/db` declares as a production dependency because `entrypoint.sh` runs `prisma migrate deploy` at boot.

### Web — Next standalone output

`apps/web/next.config.js` sets `output: 'standalone'`, with `outputFileTracingRoot` on the same repository-root constant as `turbopack.root`. The runner copies `.next/standalone` (the server and only the files Next's traces name), `.next/static` and `public`, sets `HOSTNAME=0.0.0.0`, and runs `node apps/web/server.js`. No workspace `node_modules`, no `next` binary. `@luke/core` and NextAuth are compiled into the server bundles.

### Proof — from inside each image, before anything is published

`tools/scripts/check-image-runtime.ts` runs under the image's own Node with the script mounted read-only. One contract per layout:

- **API**: the store under `node_modules/.pnpm` must equal the closure of the workspace manifests' `dependencies` (optional, platform-absent and peer edges handled as Node resolves them); an entry nothing reaches, or a dependency that does not resolve, fails. Every bare `require` in the workspace packages' compiled output must resolve from its file — the import a manifest forgot, which the full tree used to supply by accident. Then `argon2` hashes and verifies, `sharp` resizes, the four workspace packages load, `prisma validate` loads the config and schema, and `prisma version` runs the native schema engine `migrate deploy` needs.
- **Web**: the builder writes the list of entries the runtime stage may contain — Next's standalone tree, static assets and `public`, at their final paths — to `/runtime-files.txt`, outside the tree it describes. Any other entry under `/app` fails, and so does anything outside `apps/web` and `node_modules` even when the list names it — API code Next traced after a value import. Then the server boots and answers on loopback: `/login`, `/api/auth/csrf`, a protected page, and `/_next/image` resizing the widest PNG in `public` to an exact width (without `sharp` the optimizer answers 200 with the original).

It runs in two places. CI's `images` job (a matrix over both images, inside `CI gate`) builds each Dockerfile without pushing, on every push and pull request CI runs on. `release.yml` builds each image once, runs the same check on that exact image, and only then pushes its tags — the version tag first.

### Rejected

- **`pnpm deploy --prod`** for the API. Experimental in pnpm 11; its non-legacy mode requires `inject-workspace-packages`, which changes how every workspace package links in local development; and it copies by each manifest's `files`, which would have needed four manifest changes and a new layout for the same dependency closure.
- **Bundling the API.** OpenTelemetry patches real modules at `require` time, `argon2` and `sharp` are native, and the Prisma CLI must exist as a package.
- **The API's approach for web.** A production install of `next` still brings its build-only compiler binaries and every client library in full, although their code is already in `.next`.
- **A structural Dockerfile rule in `check-platform-integrity.ts`.** A static reading cannot see what `.next/standalone` contains nor follow a stage's ancestry; the artifact check covers both on every push.
- **Pushing by digest and promoting tags**, which would keep the default provenance attestation that `build-push-action` adds on push. Nothing reads it, and `load` → check → `docker push` is one build. If attestations are wanted, `actions/attest-build-provenance` on the pushed digest is the stronger tool.

## Consequences

- **Size**, as built by the `images` job: API 1.48 GB → 912 MB (1143 → 584 store entries, all reachable), web 1.65 GB → 220 MB.
- **Release time.** `verify` runs `ci.yml`, so a release builds each image twice — once in the `images` job, once in its build job. GitHub scopes the Actions cache by ref, so a tag does not reuse the train's cache; within the release run the second build reuses the first's install and package layers, which is why the web image's per-channel build arguments are declared just before `next build`. Pull requests read the cache and never write it.
- **No published provenance attestation.** `load: true` drops the minimal attestation `build-push-action` used to attach on push.
- **Pushes are not atomic.** A failure part-way through leaves the tags already pushed — the version tag first, so a moving alias never points at an image whose own version is missing — and can leave the API published without the web image.
- **Where the proof is weaker.** The API check audits store entries, not extra files inside a reachable package or outside the store; the web check proves no extra entry, not the integrity of the listed ones. Real migrations, LDAP, the API behind the web image and every authenticated path remain the rc deploy's to prove.
- **`main` until the train graduates.** `main`'s `ci.yml` has no `images` job and its `release.yml` no check, so a hotfix cut from `main` before v3.0.0 still ships the full tree.
- **Compiled unit tests no longer ship.** `apps/api`'s build now excludes `src/**/__tests__` and `*.test.ts`, as `packages/core` and `packages/calendar` already did: the require scan found ten compiled tests in `dist` requiring vitest. `tsconfig.test.json` still typechecks them.
- **The seed.** `db:seed` (`tsx prisma/seed.ts`) could already not run inside the API image — it imports `apps/api/src`, which is not shipped. It still cannot, and `tsx` is gone too.
- **`next start`** stays as `apps/web`'s local `start` script; with standalone output it prints a warning. No image, CI job or compose file uses it.
