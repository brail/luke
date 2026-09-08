#!/usr/bin/env bash
#
# Prepare the release you name: the CHANGELOG section for it.
#
# The git tag is the release identity. No manifest carries a version, so this
# writes exactly one file.
#
# Does not commit and does not tag — those stay explicit decisions. It does the
# mechanical part, which is where mistakes happen, and it is the only supported
# entry point: `changelog:bump` writes notes with no version and no check.
#
#   pnpm release:prepare v3.0.0-rc.1     the next candidate of a release train
#   pnpm release:prepare v3.0.0          graduate that train to its stable tag
#   pnpm release:prepare v3.0.1          a hotfix on the stable line
#
# ── Why the version is named rather than computed ───────────────────────────
#
# It used to be `git-cliff --bumped-version`. With no range git-cliff walks the
# whole history in date order and closes a release wherever that walk meets a
# tagged commit — which is not a boundary in the commit graph. Once a stable
# hotfix is merged into the train, every train commit dated before it lands on
# the published side of that line, breaking changes included, and the computed
# bump comes back too small. An explicit `base..HEAD` is a set difference on the
# graph, which is the question that was meant all along.
#
# So the operator names the release and `check-release-train.ts --validate`
# proves it: the tag is free, the base is the highest stable reachable from
# HEAD, an open train owns its own target, and the version is **not below** the
# minimum bump the conventional commits since that base require — git-cliff's
# own verdict on the range, with no override. It also returns the range and the
# `--ignore-tags` value the notes must be rendered with, so the number and the
# section cannot come from two different questions.
#
# Nothing is written until every one of those checks has passed.

set -euo pipefail

cd "$(dirname "$0")/.."

# The stable line. Its name is also what `release.yml` calls STABLE_BRANCH.
STABLE_BRANCH="main"
STABLE_REF="origin/${STABLE_BRANCH}"

usage() {
  cat >&2 <<'EOF'
Usage: pnpm release:prepare <tag>

  <tag>   vX.Y.Z            a stable release, cut from the stable line
          vX.Y.Z-rc.N       a release candidate, cut from the release train

Examples:
  pnpm release:prepare v3.0.0-rc.1
  pnpm release:prepare v3.0.0
EOF
}

TAG="${1:-}"

if [ "$#" -gt 1 ]; then
  echo "❌ One argument: the tag to prepare. Got $#." >&2
  usage
  exit 1
fi

case "$TAG" in
  '')
    echo "❌ Name the release you are preparing." >&2
    usage
    exit 1
    ;;
  auto | rc | stable)
    echo "❌ \"$TAG\" was a mode, and the modes are gone: the version is now" >&2
    echo "   named, not inferred. Say which release you are preparing." >&2
    usage
    exit 1
    ;;
esac

# Is HEAD on the stable line? Echoes why when it is, nothing when it is not.
#
# Both paths need this and need it in opposite directions — a candidate must
# not be cut here, a stable release must not be cut anywhere else — so it is
# one predicate rather than two half-answers free to disagree.
#
# Two accepting states, and the second one needs both of its halves:
#
# 1. HEAD is reachable from the stable ref. The commit is already published on
#    the stable line, so there is nothing left to prove. Covers a detached HEAD
#    on an already-pushed main commit.
#
# 2. HEAD is not there yet, but the checked-out branch *is* the stable branch
#    **and** the stable ref is an ancestor of HEAD — a local merge or fast
#    forward that has not been pushed. The second half is what makes this
#    evidence rather than a label: a local branch called `main` can be reset
#    onto the train or otherwise diverge, and then it is not a continuation of
#    the stable line at all. It could only reach the remote by force, which the
#    `main integrity` ruleset forbids, so a tag cut on it would be refused by
#    release.yml after the push with nothing able to fix it. The branch name
#    alone is never sufficient.
#
# Anything else — a detached unpushed merge, a divergent local `main`, the
# release train — is rejected. Nothing has recorded that the commit belongs to
# the stable line, and guessing is what puts an invalid tag on the remote.
stable_line_reason() {
  stable_branch="${STABLE_REF#origin/}"
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  if git merge-base --is-ancestor HEAD "$STABLE_REF" 2>/dev/null; then
    printf 'HEAD is already reachable from %s' "$STABLE_REF"
  elif [ "$current_branch" = "$stable_branch" ] &&
    git merge-base --is-ancestor "$STABLE_REF" HEAD 2>/dev/null; then
    printf 'the checked-out branch is %s and continues %s' "$stable_branch" "$STABLE_REF"
  fi
}

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree not clean. Commit or stash before preparing a release." >&2
  git status --short >&2
  exit 1
fi

# Refreshed here, not left to whoever remembers. Every question below is asked
# of local refs: whether the tag is already taken, whether a hotfix outranks
# this line, where the stable line is. Stale local knowledge cannot answer any
# of them, and the failure is silent — a tag that looks free, a base that looks
# newest. Ordinary fetch, no prune: nothing local is discarded, and a ref that
# only exists here can make the gate stricter, never laxer.
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "❌ No \`origin\` remote, so the tags and the stable line cannot be" >&2
  echo "   refreshed — and neither collisions nor an unmerged hotfix could be" >&2
  echo "   ruled out. Add the remote before preparing a release." >&2
  exit 1
fi

echo "🌐 Refreshing tags and ${STABLE_REF}..."
if ! git fetch --tags --quiet origin \
  "+refs/heads/${STABLE_BRANCH}:refs/remotes/${STABLE_REF}"; then
  echo "" >&2
  echo "❌ Could not fetch from origin. A release prepared against stale refs" >&2
  echo "   can collide with a tag that already exists or skip a hotfix that is" >&2
  echo "   already published. Fix the connection and try again." >&2
  exit 1
fi

if ! git rev-parse -q --verify "${STABLE_REF}^{commit}" >/dev/null; then
  echo "❌ ${STABLE_REF} does not exist even after fetching, so it is unprovable" >&2
  echo "   which side of the stable line this commit is on." >&2
  exit 1
fi

# One question, asked once; the glob below only decides which answer is the
# acceptable one. It decides nothing about whether the tag is valid:
# `parseReleaseTag`, through `--validate`, is the only grammar, and it rejects
# anything malformed before a byte is written. A malformed tag therefore reaches
# the stable arm first and is refused for the wrong reason before the right one
# — pinned by `check-release-stable-line.test.ts` so it stays a known cost
# rather than a surprise.
ON_STABLE=$(stable_line_reason)

case "$TAG" in
  *-rc.*)
    if [ -n "$ON_STABLE" ]; then
      echo "❌ $ON_STABLE, so $TAG would be refused by release.yml:" >&2
      echo "   code on the stable line is released as a stable tag, not as" >&2
      echo "   another candidate." >&2
      echo "   Releasing it? Name the stable version instead." >&2
      exit 1
    fi
    ;;
  *)
    if [ -z "$ON_STABLE" ]; then
      echo "❌ HEAD is not on the stable line, so a stable tag cut here would be" >&2
      echo "   refused by release.yml — after the push, with the tag already on the" >&2
      echo "   remote. Merge the release train into ${STABLE_BRANCH} first, then" >&2
      echo "   graduate from there." >&2
      echo "   Still on the train? Name the next candidate: <version>-rc.N" >&2
      exit 1
    fi
    echo "🔒 Stable line confirmed: $ON_STABLE"
    ;;
esac

# Fails closed on its own for a taken tag, a missing or unreachable base, an
# unmerged hotfix, the wrong train, a counter that skips, a range with nothing
# releasable in it, and any target below the minimum bump. Nothing here
# second-guesses it; nothing has been written yet either.
if ! VALIDATION=$(pnpm exec tsx tools/scripts/check-release-train.ts --validate "$TAG"); then
  echo "" >&2
  echo "   Nothing was written." >&2
  exit 1
fi

# One field of the validator's answer. `tail -1` is not defence against a
# duplicate key — the producer cannot emit one — but against a future line that
# happens to start the same way.
field() {
  printf '%s\n' "$VALIDATION" | sed -n "s/^$1=//p" | tail -1
}

KIND=$(field kind)
VERSION=$(field version)
RANGE=$(field range)
IGNORE=$(field ignore)
CONFIG=$(field config)
# `min` is deliberately outside the completeness check below: a candidate after
# the first has a frozen target and no minimum, so an empty value is its correct
# answer rather than a missing one.
MIN=$(field min)

if [ -z "$KIND" ] || [ -z "$VERSION" ] || [ -z "$RANGE" ] ||
  [ -z "$IGNORE" ] || [ -z "$CONFIG" ]; then
  echo "❌ check-release-train returned an incomplete answer. Refusing to guess." >&2
  exit 1
fi

echo "📦 Preparing $TAG ($KIND) — notes from $RANGE${MIN:+, minimum $MIN}"
echo

# One section for the whole range. `--ignore-tags` comes from the validator
# because it is part of the same decision: a candidate ignores every tag, so a
# stable hotfix merged into the train does not split its section in two, while a
# graduation ignores the rc tags only, so the whole train lands under one
# heading instead of one per candidate.
#
# `--config` comes from the validator rather than being spelled again here:
# git-cliff's default path is `cliff.toml`, so a stray file by that name would
# silently replace this repository's configuration — and the notes must be
# rendered under the very configuration the range and the minimum were computed
# under.
pnpm exec git-cliff "$RANGE" \
  --config "$CONFIG" \
  --ignore-tags "$IGNORE" \
  --tag "$TAG" \
  --prepend CHANGELOG.md
echo "✅ CHANGELOG.md updated"
echo

# Self-check of what the writer above just produced, through the very checker
# `release.yml` runs after the push and `.husky/pre-push` runs before it. The tag
# does not exist yet, so the worktree is the only tree that carries this version:
# a heading git-cliff emitted empty surfaces here rather than at push time or in CI.
pnpm exec tsx tools/scripts/check-release-tree.ts --tag "$TAG" --worktree
echo

if [ "$KIND" = "stable" ]; then
  ORIGIN_HINT="${STABLE_BRANCH} — release.yml refuses a stable tag on a commit that is not on ${STABLE_BRANCH}"
else
  ORIGIN_HINT="the active release train — release.yml refuses an rc tag on a commit already on ${STABLE_BRANCH}"
fi

cat <<EOF
──────────────────────────────────────────────────────────
  Ready. Three steps remain, deliberately manual:

    git diff                       # review the CHANGELOG section
    git commit -am "chore(release): notes for $VERSION"
    git tag $TAG && git push origin $TAG

  Tag from: $ORIGIN_HINT.
  The tree above already claims $VERSION. \`.husky/pre-push\` re-checks the
  pushed object with the same checker, and release.yml checks the tagged tree
  again before any image is built — that run is the authoritative one.
──────────────────────────────────────────────────────────
EOF
