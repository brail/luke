# ADR-033 — Release Identity, Versioning Contract and Release Trains

## Status

Accepted

## Context

Between 2026-09-02 and 2026-10-02 Luke's release practice became a contract enforced by tools. Release tags, release notes, release-candidate trains and the checks `main` requires were each reworked after an observed failure or an identified failure mode. Most are recorded in Appendices K, T, V and X of the [monorepo audit ledger](../LUKE_MONOREPO_AUDIT_2026-08-30.md); the 2026-10-02 changes are recorded in their commit messages. The reasons were spread across those records, the release section of the repository instruction file, which is meant to state rules, and the headers of the checkers that enforce them. No decision record held them together.

What shaped the contract:

- **The channel was guessed from the tag name.** `release.yml` chose the registry channel with a substring test for `-rc`. That test cannot tell where the tagged commit lives, and it is not a version check: a stable tag cut from the train could publish `latest` from code that never reached `main`, and a malformed tag could push an image with no version tag while every step stayed green.
- **A second release identity.** Every package manifest carried a version that a script kept in step with the tag, so the tree had to be checked against the tag twice, and the two could drift.
- **An inferred version came back too small.** Preparation asked git-cliff for the next version with no range. Git-cliff walks history in date order and closes a release wherever that walk meets a tagged commit. Once a stable hotfix was merged into the train, the train's breaking commits fell on the published side of that line. A range that required a major version was answered with a patch. A routine synchronisation of `main` into the train caused it.
- **A train outlived its target.** A breaking change after a train's first candidate made its target unpublishable, yet the validator kept accepting candidates of that version and refused the next train; deleting published candidate tags was the only way out (`e4c7e803`).
- **A graduation could publish untested changes.** Stable images are rebuilt from the stable tag, so a change made after the last candidate could reach `latest` without having shipped in any candidate, and the rule was at first checked only at preparation (`1811a675`, `12b1984d`).
- **Breaking changes counted without a definition.** A `!` on a coordinated change inside the monorepo would spend a major version, although nobody outside the repository could observe it.
- **Required checks could drift.** `main` required individual job names, so a job added later would be required by nothing. Retargeting a pull request fires `edited`, which the default trigger set omits, so the required checks could sit Pending on a head nothing had judged.

## Decision

**The git tag is the only release identity.** No manifest declares a version. A tag has exactly one of two shapes:

- `vX.Y.Z`, a stable release, reachable from `main`;
- `vX.Y.Z-rc.N`, a release candidate, reachable from the active release train and not yet from `main`.

The shape and the line decide the registry tags the release may publish. A stable release publishes `X.Y.Z`, `X.Y` and `latest`, never `rc-latest`. A candidate publishes `X.Y.Z-rc.N` and `rc-latest`, never `latest` or `X.Y`. Anything else is refused before an image is built.

**Versioning contract.** A release follows Semantic Versioning: a patch fixes or refactors, a minor adds visible functionality, and a major breaks a supported compatibility contract. `!` and `BREAKING CHANGE` are reserved for a contract that Luke supports across an upgrade:

- the external API surface;
- persisted data and migration compatibility;
- supported configuration: AppConfig keys with the values they accept, and the `.env` bootstrap;
- the deployment and upgrade contract: image tags, volumes and entrypoint behaviour.

The test is whether somebody outside the repository has to act: an operator upgrading, a stored row, a supported client. A change whose callers all live in the monorepo and move in the same commit is a `feat` or a `fix`, whatever signature or procedure input it changes. `apps/web` is not an outside client.

**The operator names the version; the commits set its floor.** The base is the highest stable tag reachable from HEAD, and the minimum bump is computed over the commit-graph range from that base to HEAD. A target below the minimum that the Conventional Commits in that range require is refused, and there is no override. Release notes cover that range for a first candidate or a stable release, and the range since the previous candidate for a later one. One preparation entry point validates the target before it writes anything, and the only file it writes is `CHANGELOG.md`.

**A release train has one target.** Its target is frozen when the first candidate is cut, and each later candidate advances the counter by one. The train is live while its target is above the base and not below the minimum bump. A breaking change that raises the minimum above the frozen target ends the train at once: no further candidate and no graduation. Its candidate tags stay as history, and the next train starts at the higher version.

**A graduation publishes the last candidate unchanged.** The stable tag's tree is the latest candidate's tree, except for `CHANGELOG.md`. A change made after the last candidate ships by cutting another candidate first, in a commit that produces release notes. The train merges into `main` with a merge commit, and the graduation follows the merge. A change that reaches `main` in between returns through the train before the next candidate.

**A development branch dies with its stable tag.** A `develop-X.Y` branch is retired when its stable tag is cut, not when it is merged. It is never reactivated or used for backports; the next cycle is cut from `main`. It is removed from the remote right after its stable tag is cut: from then on the release workflow can no longer prove a candidate from it, and the weekly scan of the train fails, which is the reminder to switch to the next cycle's branch. The ruleset that protects train branches forbids deleting them, so the removal is an owner operation that lifts that restriction for the purpose.

**The release workflow is authoritative.** It proves the tag's line and then the tagged tree before any image is built. The local pre-push hook runs the tagged-tree check as early feedback only.

### Rejected alternatives

- **Manifest versions as a second identity.** A second identity adds a writer, a comparison and a way to drift, and nothing outside the repository reads it.
- **Inferring the version.** No configuration of a range-less, date-ordered call expresses a boundary in the commit graph. Its base was also the newest-dated tag in the repository, reachable or not.
- **An override for the minimum bump.** A gate that can be waived on the day it is inconvenient is not a gate.
- **Moving a live train to a new target.** A train with two targets has two meanings for its candidates. Ending the train and starting a new one keeps each candidate attached to one version.
- **Graduating from a changed tree.** Stable images are rebuilt from the stable tag, so a change made after the last candidate would reach `latest` without ever shipping in a candidate.
- **A squash merge of the train.** It leaves the candidates unreachable from `main`.
- **Requiring individual job names, or any required check on a train branch.** A job added later is silently ungated, and a context required on a branch that dies at the end of its cycle outlives the branch.

## Consequences

- The repository instruction file states the release rules and points here for their reasons. The root README's release section and the tooling README describe the procedure, and the checker headers describe the mechanics.
- A train overtaken by a breaking change cannot be rescued, only replaced.
- Commits whose subject begins with `Merge `, which is how git names a merge by default, are left out of release notes; a merge given any other subject is rendered. A candidate is refused at preparation when its range contains nothing releasable, which is the case when its only new commits are such merges.
- The tagged-tree check proves that the tree ships notes for its own tag and, for a graduation, that it is the last candidate unchanged. It does not prove that the release was prepared: preparation proves the number, and the provenance check proves the line.
- **Aggregate gates.** `main` requires exactly two contexts, `CI gate` and `Security gate`. Each stands for the jobs or scans that judge a pull request, and each accepts only success. Neither is required on a train or release branch. Each gate's dependency list is derived from its workflow's own jobs and checked, so a job added later fails that check instead of going ungated. A tolerated failure (`continue-on-error`) is forbidden in the gated workflows, because it reports as success. Both gated workflows pin the pull-request activity types, including `edited`. A pull request is judged by the workflows on its own branch, so a change to a gate lands on `main` before `main`'s ruleset depends on it.
- **Documentation routing on the train.** A push confined to an explicit documentation allowlist skips the full CI run, and a separate workflow runs the documentation drift check instead. Pull-request triggers and the security scans carry no path filter. The path-filtered documentation drift job is never required on `main`, because a workflow its path filter skips cannot satisfy a required context. The runtime evidence for a documentation-only commit is the CI run of the last push outside the documentation allowlist, whose runtime tree it carries unchanged.
- These gates protect against accidental regressions and ordinary vulnerable changes. They are not tamper-resistant: a pull request that edits a workflow, its checker and the gate together is judged by the version it proposes. Review and branch protection are the control there.
- Where a branch does not yet carry these checks, the gap is tracked in the monorepo audit ledger, not here.
