# Decisions in force — Release and deployment

> Current guidance, kept up to date; not a decision record. The ADRs linked here decide: where this page and an Accepted ADR disagree, the ADR holds.

_Last reviewed: 2026-11-22_

## Rules in force

- The git tag is the only release identity, and no package manifest declares a version. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A tag is either `vX.Y.Z`, a stable release reachable from `main`, or `vX.Y.Z-rc.N`, a candidate reachable from the active release train and not yet from `main`. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A stable release publishes the registry tags `X.Y.Z`, `X.Y` and `latest`, never `rc-latest`; a candidate publishes `X.Y.Z-rc.N` and `rc-latest`, never `latest` or `X.Y`; anything else is refused before an image is built. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- Versions follow Semantic Versioning: a patch fixes or refactors, a minor adds visible functionality, a major breaks a supported compatibility contract. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- `!` and `BREAKING CHANGE` are reserved for a contract supported across an upgrade: the external API surface, persisted data and migration compatibility, AppConfig keys with the values they accept and the `.env` bootstrap, and the deployment contract of image tags, volumes and entrypoint behaviour. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A change whose callers all live in the monorepo and move in the same commit is a `feat` or a `fix`, whatever signature or procedure input it changes, and `apps/web` is not an outside client. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- The operator names the version, and preparation refuses, with no override, a target below the minimum bump the Conventional Commits require over the commit-graph range from the highest stable tag reachable from HEAD. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- One preparation entry point validates the target before writing anything and writes only `CHANGELOG.md`. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- Release notes cover the range from the base for a first candidate or a stable release and the range since the previous candidate for a later one, leave out commits whose subject begins with `Merge `, and a candidate whose range has nothing releasable is refused at preparation. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A release train has one target, frozen when its first candidate is cut, and each later candidate advances the counter by exactly one. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A breaking change that raises the minimum bump above the frozen target ends the train at once, with no further candidate and no graduation; its candidate tags stay, and the next train starts at the higher version. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A graduation publishes the last candidate's tree unchanged except `CHANGELOG.md`, so a later change ships first as another candidate, in a commit that produces release notes. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- The train merges into `main` with a merge commit, never a squash, the graduation follows the merge, and a change that reaches `main` in between returns through the train before the next candidate. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A `develop-X.Y` branch is retired when its stable tag is cut, is never reactivated or used for backports, and is removed from the remote right after, an owner operation because the train ruleset forbids deleting it; the next cycle is cut from `main`. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- The release workflow is authoritative: it proves the tag's line and then the tagged tree before any image is built, and the local pre-push hook runs the tagged-tree check only as early feedback. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- `main` requires exactly `CI gate` and `Security gate`, each accepting only success and neither required on a train or release branch, and each gate's dependency list is derived from its workflow's jobs and checked. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- The gated workflows forbid `continue-on-error`, pin the pull-request activity types including `edited`, and a gate change lands on `main` before `main`'s ruleset depends on it. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- A push confined to the documentation allowlist skips the full CI run and gets the documentation drift check instead, which is never required on `main`; pull-request triggers and security scans carry no path filter, and such a commit's runtime evidence is the CI run of the last push outside the allowlist. [ADR-033](../033-release-identity-versioning-contract-and-release-trains.md)
- The API image takes every `node_modules` from a `deps-prod` stage that reinstalls `@luke/api` and its workspace packages with production dependencies only, from the same lockfile, then runs `pnpm rebuild` for their build scripts. [ADR-028](../028-runtime-images-carry-runtime-dependencies-only.md)
- The web image runs Next's standalone output (`node apps/web/server.js`) with only `.next/standalone`, `.next/static` and `public`, and no workspace `node_modules`. [ADR-028](../028-runtime-images-carry-runtime-dependencies-only.md)
- `tools/scripts/check-image-runtime.ts` proves each image from inside it: for the API, a store equal to the production-dependency closure, every bare `require` resolving and the native and Prisma tools working; for the web, no entry outside the builder's `/runtime-files.txt` or outside `apps/web` and `node_modules`, and a server that boots and answers. [ADR-028](../028-runtime-images-carry-runtime-dependencies-only.md)
- The check runs in CI's `images` job, inside `CI gate`, building both images without pushing, and in `release.yml` on the exact image before its tags are pushed, the version tag first. [ADR-028](../028-runtime-images-carry-runtime-dependencies-only.md)
- The proof has limits: the API check audits store entries, not extra files inside a reachable package or outside the store, the web check proves no extra entry, not the integrity of listed ones, and migrations, LDAP and authenticated paths remain the rc deploy's to prove. [ADR-028](../028-runtime-images-carry-runtime-dependencies-only.md)
- Image pushes are not atomic and carry no published provenance attestation. [ADR-028](../028-runtime-images-carry-runtime-dependencies-only.md)
- The `apps/api` build excludes `src/**/__tests__` and `*.test.ts`, and `db:seed` does not run inside the API image. [ADR-028](../028-runtime-images-carry-runtime-dependencies-only.md)

## Records

| ADR | Role |
| --- | --- |
| [033](../033-release-identity-versioning-contract-and-release-trains.md) | in force |
| [028](../028-runtime-images-carry-runtime-dependencies-only.md) | in force |
