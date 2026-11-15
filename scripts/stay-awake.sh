#!/bin/sh
# Runs a long local suite so macOS sleep cannot stall it halfway, and says so
# when it did anyway.
#
# A Mac that sleeps stops Node mid-suite, and the hooks then report timeouts
# that read like failing tests (lessons.md, "A long local suite runs under
# `caffeinate -i -s`"). The long entry points — `test:integration`,
# `test:browser` and `test:e2e` — run through this instead of relying on memory
# (the pre-push hook holds sleep off with `caffeinate -w`).
#
# On a Mac with `caffeinate`, outside CI, the command runs under
# `caffeinate -i -s`: idle sleep and, on AC power, system sleep are held off
# until it exits. Neither holds on battery, with the lid closed, or once the Mac
# is already in a maintenance wake (DarkWake), so the run is checked instead:
# any sleep that `pmset -g log` records between start and end is reported on
# stderr. The exit code is the command's own. Anywhere else the command runs as
# it is.
[ "$#" -gt 0 ] || { echo "usage: stay-awake.sh <command> [args...]" >&2; exit 2; }
if [ -z "${CI:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  start=$(date '+%Y-%m-%d %H:%M:%S')
  if pmset -g batt 2>/dev/null | grep -q "'Battery Power'"; then
    echo "stay-awake: on battery power, macOS can still sleep: plug in and keep the lid open" >&2
  fi
  # Not `exec`: the sleep check runs after the command. A runner that signals
  # this shell alone (turbo, pnpm) must still stop the command, so the shell
  # waits on it in the background and passes the signal on. `<&0` keeps stdin,
  # which a background command would otherwise get from /dev/null.
  caffeinate -i -s "$@" <&0 &
  pid=$!
  trap 'kill -INT "$pid" 2>/dev/null' INT
  trap 'kill -TERM "$pid" 2>/dev/null' TERM HUP
  wait "$pid"
  status=$?
  # A trapped signal interrupts `wait`; wait again for the command's own exit.
  while kill -0 "$pid" 2>/dev/null; do
    wait "$pid"
    status=$?
  done
  slept=$(pmset -g log 2>/dev/null | awk -v since="$start" '$4 == "Sleep" && $1 " " $2 >= since { print $1 " " $2; exit }')
  if [ -n "$slept" ]; then
    echo "stay-awake: macOS slept at $slept during this run; timeouts are not test results, run again with the Mac awake" >&2
  fi
  exit "$status"
fi
exec "$@"
