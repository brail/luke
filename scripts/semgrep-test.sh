#!/bin/sh
# Runs every custom semgrep rule against its fixtures in .semgrep/tests/.
#
# `semgrep --test` fails on a broken rule file and on a fixture annotation the
# rule does not honour, but it silently skips a rule that has no fixture: with
# fixtures for 5 of 13 rule ids it reported "5/5 passed". A rule that never
# fires looks exactly like a clean tree (lessons.md, "A new lint rule must be
# probed on a bait file"), so every rule id must also carry both a
# `ruleid:` case (it fires) and an `ok:` case (it does not fire on fixed code).
set -eu
cd "$(dirname "$0")/.."

semgrep --test --metrics=off --config .semgrep/rules .semgrep/tests

missing=0
for id in $(sed -n 's/^ *- id: *//p' .semgrep/rules/*.yml); do
  for kind in ruleid ok; do
    if ! grep -rqE "$kind: ([a-z-]+, )*$id(,|\$| )" .semgrep/tests; then
      echo "semgrep-test: no '$kind: $id' case in .semgrep/tests/" >&2
      missing=1
    fi
  done
done
exit "$missing"
