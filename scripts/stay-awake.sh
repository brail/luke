#!/bin/sh
# Runs a long local suite so macOS idle sleep cannot stall it halfway.
#
# A Mac that idles into sleep stops Node mid-suite, and the hooks then report
# timeouts that read like failing tests (lessons.md, "A long local suite runs
# under `caffeinate -i`"). The rule was prose and got forgotten, so the long
# entry points — `test:integration`, `test:browser` and `test:e2e` — run through
# this instead of relying on memory (the pre-push hook uses `caffeinate -w`).
#
# On a Mac with `caffeinate`, outside CI, the command runs under
# `caffeinate -i`, which holds idle sleep off until it exits. Anywhere else it
# runs as it is. `exec` keeps the exit code, the signals and stdin.
[ "$#" -gt 0 ] || { echo "usage: stay-awake.sh <command> [args...]" >&2; exit 2; }
if [ -z "${CI:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -i "$@"
fi
exec "$@"
