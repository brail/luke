#!/usr/bin/env bash
#
# Prepare a release: CHANGELOG + versions in every package.json.
#
# Does not commit and does not tag — those stay explicit decisions. It does the
# mechanical part, which is where mistakes happen: `sync-version` with no
# arguments reads the **existing** tag, so at bump time it would move the
# package.json files to the previous version instead of the new one. The guard
# in `.husky/pre-push` would catch that when the tag is pushed, but only after
# costing a round trip.
#
# The version number has one source: `git-cliff --bumped-version`, computed
# from the conventional commits. The same value lands in the CHANGELOG and in
# the package.json files, so they cannot diverge.
#
# ── Modes ───────────────────────────────────────────────────────────────────
#
#   release:prepare            whatever git-cliff computes next (default)
#   release:prepare rc         the next release candidate of the current train
#   release:prepare stable     graduate the current rc train to its stable tag
#
# The modes exist because a release train produces several candidates for **one**
# stable target — v3.0.0-rc.1, rc.2, … then v3.0.0 — and git-cliff only knows
# how to answer that question from one side at a time:
#
# - before any rc tag exists it returns the next *stable* version, so `rc` mode
#   is what turns v3.0.0 into v3.0.0-rc.1. Without it there was no way to
#   prepare a candidate at all: `.husky/pre-push` refuses a tag with no matching
#   CHANGELOG block, and nothing wrote one for an rc.
# - once an rc tag is reachable it increments the *prerelease counter only*
#   (rc.1 → rc.2), and keeps doing so no matter what lands afterwards. That is
#   exactly the invariant we want mid-train — candidates never consume new
#   stable versions — but it also means it will never return v3.0.0 again on
#   its own, on this branch or on main after the merge. `stable` mode strips
#   the `-rc.N` off the current train and releases the target it was aimed at
#   from the start.
#
# Both derived tags are checked against `check-release-provenance.ts`, the same
# shape rule `release.yml` enforces after the push.

set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-auto}"
case "$MODE" in
  auto | rc | stable) ;;
  *)
    echo "❌ Unknown mode \"$MODE\". Use: (nothing) | rc | stable" >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree not clean. Commit or stash before preparing a release." >&2
  git status --short >&2
  exit 1
fi

BUMPED=$(pnpm exec git-cliff --bumped-version 2>/dev/null | tail -1)

if [ -z "$BUMPED" ]; then
  echo "❌ git-cliff computed no version. Are there conventional commits since the last tag?" >&2
  exit 1
fi

case "$MODE" in
  auto)
    TAG="$BUMPED"
    ;;
  rc)
    # Already inside a train: git-cliff has advanced the counter for us and the
    # stable target is fixed. Otherwise this is rc.1 of the target it just named.
    case "$BUMPED" in
      *-rc.*) TAG="$BUMPED" ;;
      *) TAG="${BUMPED}-rc.1" ;;
    esac
    ;;
  stable)
    # The train's target is written on its own tags, not derivable from the
    # commits: once an rc exists, `--bumped-version` only ever answers with
    # another rc.
    LAST=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)
    case "$LAST" in
      *-rc.*) TAG="${LAST%-rc.*}" ;;
      *)
        echo "❌ stable mode: the latest reachable tag is \"${LAST:-none}\", not a" >&2
        echo "   release candidate. There is no train to graduate — use the default mode." >&2
        exit 1
        ;;
    esac
    ;;
esac

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "❌ Tag $TAG already exists. Nothing new to release on this line." >&2
  exit 1
fi

# One definition of what a release tag looks like, shared with the workflow gate.
CHANNEL=$(pnpm exec tsx tools/scripts/check-release-provenance.ts --shape-only --tag "$TAG")

VERSION="${TAG#v}"

echo "📦 Next version: $TAG ($CHANNEL)"
echo

pnpm exec git-cliff --unreleased --tag "$TAG" --prepend CHANGELOG.md
echo "✅ CHANGELOG.md updated"
echo

node scripts/sync-version.js --set "$VERSION"
echo

# The pre-push guard compares the package.json files against the tag. The tag
# does not exist yet here, so it is verified against the value just written: if
# something did not take, it surfaces now rather than at push time.
if ! grep -q "^## \[$VERSION\]" CHANGELOG.md; then
  echo "❌ CHANGELOG.md has no [$VERSION] block: pushing the tag would be blocked." >&2
  exit 1
fi

if [ "$CHANNEL" = "rc" ]; then
  ORIGIN_HINT="the active release train — release.yml refuses an rc tag on a commit already on main"
else
  ORIGIN_HINT="main — release.yml refuses a stable tag on a commit that is not on main"
fi

cat <<EOF
──────────────────────────────────────────────────────────
  Ready. Three steps remain, deliberately manual:

    git diff                       # review CHANGELOG and versions
    git commit -am "chore: bump version to $VERSION"
    git tag $TAG && git push origin $TAG

  Tag from: $ORIGIN_HINT.
  The pre-push hook checks the CHANGELOG block and version alignment.
──────────────────────────────────────────────────────────
EOF
