#!/bin/sh
# Refuses to go on while `pnpm dev` runs in this worktree.
#
# Every emitting command starts each dependency build with `rm -rf dist`:
# `build` directly, `typecheck` and `test` through turbo's `^build`. The dev
# watchers write into the same `dist`, and a build interrupted between clean
# and emit leaves a partial tree they never restore (CLAUDE.md, "Monorepo").
# The rule was prose and got broken, so the root scripts and the pre-push hook
# run this first.
#
# Only a watcher in this worktree counts: the comparison is on the git
# toplevel, not a path prefix, so another worktree — nested ones included —
# does not. Without pgrep or git (a container), or when a cwd cannot be read,
# the check passes.
command -v pgrep >/dev/null 2>&1 || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
for pid in $(pgrep -f 'turbo run dev|tsc --watch'); do
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  # `-n`: `git -C ''` would run in the current directory and match every time.
  if [ -n "$cwd" ] && [ "$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" = "$root" ]; then
    echo "" >&2
    echo "❌ pnpm dev is running in this worktree (pid $pid)." >&2
    echo "   Stop it, or run this from a second worktree (git worktree add)." >&2
    echo "" >&2
    exit 1
  fi
done
