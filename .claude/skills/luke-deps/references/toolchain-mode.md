# Toolchain mode — Node, pnpm, base images, Actions

Companion to `.claude/skills/luke-deps/SKILL.md`, read in full by `toolchain` mode
before it acts. Moved out of the skill to keep it under the 500-line budget.

`/luke-deps toolchain`. Node, pnpm, base images, GitHub Actions. These are
pinned in more places than a dependency is, and a missed pin does not fail — it
silently runs a different version somewhere.

**Node pin sites — all of them, every time:**

- `.nvmrc`
- `engines.node` in the root `package.json`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `.github/actions/setup-workspace/action.yml` — the composite action exists
  precisely so a Node bump is one edit instead of four; its header says so

**pnpm**: `corepack use pnpm@<version>` rewrites `packageManager` with the right
integrity hash. Do not hand-edit that string. Keep `engines.pnpm` consistent
with what the Dockerfiles and CI actually run.

Target the LTS lifecycle, not the newest number: Node 22 → 24 in `c9a816e`
happened because 22 moved to Maintenance and 24 became Active LTS.

**Do not run `docker build` locally as a validation step** — `lessons.md`
"Never build the Docker image locally", and the OOM noise it produced is the
reason. Verify base-image changes statically (image tag, `allowBuilds` and
`overrides` in `pnpm-workspace.yaml`, target arch in the release workflow),
then push the change on a branch with a draft pull request and read CI's
`images` job: it builds both images and checks them from inside
(`tools/scripts/check-image-runtime.ts`). `.github/workflows/release.yml` runs
the same check before it pushes. If the user asks for a local
build anyway on a base-image major, that is their call — say what it can and
cannot prove.

**GitHub Actions** are already automated: `.github/dependabot.yml` groups them
monthly. Do not bump them by hand here unless a PR is stuck.
