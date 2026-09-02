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
#   its own, on this branch or on main after the merge.
#
# `stable` mode therefore does not ask git-cliff at all. It asks
# `check-release-train.ts` which train is reachable and ungraduated, and derives
# both the tag and the changelog range from that — see that file for why
# proximity (`git describe`) was the wrong question and reachability is the
# right one.
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

# The stable line. Name only; the questions below are what matter.
resolve_stable_ref() {
  for candidate in origin/main main; do
    if git rev-parse -q --verify "${candidate}^{commit}" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

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

# Entries under a `## [version]` section, so "the heading exists" cannot pass
# for "the release has notes". `index()` and not a regex: the version string
# contains dots, and a version is data here, not a pattern.
section_entry_count() {
  awk -v heading="## [$2]" '
    index($0, heading) == 1 { inside = 1; next }
    inside && /^## \[/     { exit }
    inside && /^- /         { n++ }
    END                     { print n + 0 }
  ' "$1"
}

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree not clean. Commit or stash before preparing a release." >&2
  git status --short >&2
  exit 1
fi

# Range the changelog section must cover. Only `stable` sets it: the other
# modes are correctly served by `--unreleased`, whose boundary is the previous
# tag.
BASE=""

if [ "$MODE" = "stable" ]; then
  # Before anything else, and before `check-release-train.ts` is even consulted.
  # That selector is deliberately branch-agnostic — it reasons about tag
  # topology and nothing else — so on the release train it happily finds the
  # ungraduated train and answers v3.0.0. Preparing there rewrote CHANGELOG.md
  # and all seven package.json files, after which the pre-push hook accepted the
  # tag (CHANGELOG and versions did match) and only release.yml refused it — by
  # which point an invalid stable tag already existed on the remote. A
  # publication gate that fails closed is not enough when it fails last.
  if ! STABLE_REF=$(resolve_stable_ref); then
    echo "❌ Cannot resolve the stable line (tried origin/main, main), so it is" >&2
    echo "   unprovable that this commit belongs to it. Fetch main first." >&2
    exit 1
  fi

  ON_STABLE=$(stable_line_reason)
  if [ -z "$ON_STABLE" ]; then
    echo "❌ HEAD is not on the stable line, so a stable tag cut here would be" >&2
    echo "   refused by release.yml — after the push, with the tag already on the" >&2
    echo "   remote. Merge the release train into ${STABLE_REF#origin/} first, then" >&2
    echo "   graduate from there." >&2
    echo "   Still on the train? The next candidate is: pnpm release:prepare rc" >&2
    exit 1
  fi
  echo "🔒 Stable line confirmed: $ON_STABLE"

  # Fails closed on its own for missing, unreachable, ambiguous and
  # already-graduated states; nothing here needs to second-guess it.
  TRAIN=$(pnpm exec tsx tools/scripts/check-release-train.ts --graduate)
  TAG=$(printf '%s\n' "$TRAIN" | sed -n 's/^tag=//p' | tail -1)
  BASE=$(printf '%s\n' "$TRAIN" | sed -n 's/^base=//p' | tail -1)
  RCS=$(printf '%s\n' "$TRAIN" | sed -n 's/^candidates=//p' | tail -1)

  if [ -z "$TAG" ]; then
    echo "❌ check-release-train returned no tag. Refusing to guess." >&2
    exit 1
  fi
  echo "🚂 Graduating the train: ${RCS:-(no candidates listed)}"
else
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
  esac

  # Once the train is merged, git-cliff still answers with the next rc — and an
  # rc tag on the stable line is exactly what release.yml rejects. Refuse here,
  # where the fix is one word, rather than after the tag is pushed.
  case "$TAG" in
    *-rc.*)
      if ! STABLE_REF=$(resolve_stable_ref); then
        echo "❌ Cannot resolve the stable line (tried origin/main, main), so it is" >&2
        echo "   unprovable that this candidate does not sit on it. Fetch main first." >&2
        exit 1
      fi
      ON_STABLE=$(stable_line_reason)
      if [ -n "$ON_STABLE" ]; then
        echo "❌ $ON_STABLE, so $TAG would be refused by release.yml:" >&2
        echo "   code on the stable line is released as a stable tag, not as" >&2
        echo "   another candidate." >&2
        echo "   Use: pnpm release:prepare stable" >&2
        exit 1
      fi
      ;;
  esac
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "❌ Tag $TAG already exists. Nothing new to release on this line." >&2
  exit 1
fi

# One definition of what a release tag looks like, shared with the workflow gate.
CHANNEL=$(pnpm exec tsx tools/scripts/check-release-provenance.ts --shape-only --tag "$TAG" | tail -1)

VERSION="${TAG#v}"

echo "📦 Next version: $TAG ($CHANNEL)"
echo

if [ "$MODE" = "stable" ]; then
  # The whole train, in one section. `--unreleased` would start at the final rc
  # and normally find nothing after it; an explicit range reaches back to the
  # previous stable release, and `--ignore-tags` erases the rc boundaries inside
  # it so git-cliff emits one heading instead of one per candidate.
  if [ -n "$BASE" ]; then
    pnpm exec git-cliff "$BASE..HEAD" --ignore-tags '.*-rc\..*' --tag "$TAG" --prepend CHANGELOG.md
  else
    pnpm exec git-cliff --ignore-tags '.*-rc\..*' --tag "$TAG" --prepend CHANGELOG.md
  fi
else
  pnpm exec git-cliff --unreleased --tag "$TAG" --prepend CHANGELOG.md
fi
echo "✅ CHANGELOG.md updated"
echo

node scripts/sync-version.js --set "$VERSION"
echo

# The pre-push guard compares the package.json files against the tag. The tag
# does not exist yet here, so it is verified against the value just written: if
# something did not take, it surfaces now rather than at push time.
ENTRIES=$(section_entry_count CHANGELOG.md "$VERSION")
if [ "$ENTRIES" -eq 0 ]; then
  echo "❌ CHANGELOG.md has no [$VERSION] block, or the block is empty." >&2
  echo "   A heading with nothing under it is what a graduation used to produce:" >&2
  echo "   the release notes consumers read would be blank." >&2
  exit 1
fi
echo "📝 [$VERSION] carries $ENTRIES entries"
echo

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
