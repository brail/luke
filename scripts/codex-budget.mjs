/**
 * Live Codex budget check, run before a Codex review round (CLAUDE.md "Collaboration with Codex").
 *
 *   node scripts/codex-budget.mjs              # one JSON line on stdout, exit code = verdict
 *   node scripts/codex-budget.mjs --self-test  # offline checks of the decision and the transport
 *
 * Asks the local `codex app-server` (JSON-RPC over stdio, one JSON object per line) for the
 * account's current rate limits: `initialize`, `initialized`, then `account/rateLimits/read`. It
 * never starts a thread or a turn, so it costs no model usage, and it sees usage made anywhere on
 * the account — unlike the `rate_limits` snapshot in `~/.codex/sessions`, which changes only when
 * Codex runs on this machine and so could never refresh itself (lessons.md, 2026-10-24). The
 * app-server is marked experimental: after a Codex CLI upgrade, check the fields read here against
 * `codex app-server generate-json-schema` (verified on codex-cli 0.165.0).
 *
 * Exit codes: 0 `go`, 1 `insufficient`, 2 `unknown` (no data, ambiguous data, auth or protocol
 * failure, timeout). `go` needs ordinary usage explicitly allowed, no limit or spend control
 * reached, and the `codex` bucket at most 50% of its 5-hour window and 80% of its week. Windows
 * are recognised by duration, not by their primary/secondary position, and a percentage is never
 * assumed to have dropped because its reset time has passed. `offerWait` marks an `insufficient`
 * verdict caused by the 5-hour window alone when that window resets within 60 minutes: offer the
 * owner a wait and a new check. The script itself never waits.
 *
 * Before the read, `checkInstall` looks for the two broken local installs that made rounds fail
 * after a Homebrew upgrade of the Codex cask (#288): a helper link left pointing at the removed
 * version, and a process of another version still running — one under another version's directory,
 * or a `codex` started before the installed version was. Either one answers `unknown` with a `fix`
 * naming the step; the repair itself is not the probe's job. A failure of the check itself only
 * skips it.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';

const BUCKET = 'codex';
const FIVE_HOUR_MINS = 300;
const WEEK_MINS = 10_080;
const MAX_FIVE_HOUR = 50;
const MAX_WEEK = 80;
const WAIT_OFFER_SECS = 3600;
const DEADLINE_MS = 30_000;
const MAX_BUFFER = 1_000_000;
const EXIT = { go: 0, insufficient: 1, unknown: 2 };

const HELPER = 'codex-code-mode-host';

const EMPTY = { bucket: null, ordinaryUsageAllowed: null, rateLimitReachedType: null, fiveHour: null, week: null };
const unknown = reason => ({ status: 'unknown', reason, ...EMPTY, offerWait: false });

function windowOf(snapshot, mins) {
  const found = [snapshot.primary, snapshot.secondary].filter(w => w?.windowDurationMins === mins);
  if (found.length !== 1) return null;
  const [w] = found;
  if (typeof w.usedPercent !== 'number' || !(w.usedPercent >= 0 && w.usedPercent <= 100)) return null;
  return { usedPercent: w.usedPercent, windowDurationMins: mins, resetsAt: Number.isInteger(w.resetsAt) ? w.resetsAt : null };
}

/** Turns an `account/rateLimits/read` result into a verdict. Pure: `nowSecs` is passed in. */
export function decide(result, nowSecs) {
  // Prefer the per-bucket map; without it, the single snapshot counts only when it names the bucket.
  const byId = result?.rateLimitsByLimitId;
  const snapshot = byId ? byId[BUCKET] : result?.rateLimits?.limitId === BUCKET ? result.rateLimits : null;
  if (!snapshot) return unknown('bucket_missing');
  const fiveHour = windowOf(snapshot, FIVE_HOUR_MINS);
  const week = windowOf(snapshot, WEEK_MINS);
  if (!fiveHour || !week) return unknown('window_missing');

  const allowed = result.ordinaryUsageAllowed;
  const reachedType = snapshot.rateLimitReachedType ?? null;
  const base = { bucket: BUCKET, ordinaryUsageAllowed: allowed ?? null, rateLimitReachedType: reachedType, fiveHour, week };
  const verdict = (status, reason, offerWait = false) => ({ status, reason, ...base, offerWait });

  if (allowed === false) return verdict('insufficient', 'usage_not_allowed');
  if (snapshot.spendControlReached === true) return verdict('insufficient', 'spend_control_reached');
  if (week.usedPercent > MAX_WEEK) return verdict('insufficient', 'week_over_threshold');
  if (reachedType !== null || fiveHour.usedPercent > MAX_FIVE_HOUR) {
    const secsToReset = fiveHour.resetsAt === null ? null : fiveHour.resetsAt - nowSecs;
    const soon = secsToReset !== null && secsToReset > 0 && secsToReset <= WAIT_OFFER_SECS;
    // With the week under its threshold, a plain `rate_limit_reached` is the 5-hour one; any other
    // reached type (credits, workspace limits) does not clear at the 5-hour reset.
    const fiveHourOnly = fiveHour.usedPercent > MAX_FIVE_HOUR && (reachedType === null || reachedType === 'rate_limit_reached');
    return verdict('insufficient', reachedType ? 'limit_reached' : 'five_hour_over_threshold', soon && fiveHourOnly);
  }
  // The schema: a null permission is unavailable, never inferred from percentages or reset times.
  if (allowed !== true) return verdict('unknown', 'permission_unavailable');
  return verdict('go', 'within_thresholds');
}

/**
 * Finds a broken local install, or returns `null`. Pure: the filesystem, the install time and the
 * current user's processes are passed in. A missing helper link is not a finding (an install that
 * does not link one), nor a link the installed version could not replace.
 */
export function checkInstall({ codexOnPath, realpath, lexists, installedAt, processes }) {
  if (!codexOnPath) return null; // the app-server spawn reports it with its own reason
  const binDir = dirname(realpath(codexOnPath));
  const helperLink = join(dirname(codexOnPath), HELPER);
  const installedHelper = join(binDir, HELPER);
  if (lexists(helperLink) && lexists(installedHelper)) {
    let target = null;
    try {
      target = realpath(helperLink);
    } catch {
      // a dangling link: its version directory was removed
    }
    if (target !== installedHelper) {
      return { reason: 'helper_link_broken', fix: `ln -sf ${installedHelper} ${helperLink}` };
    }
  }
  // ponytail: Homebrew Caskroom layout only (<root>/codex/<version>/bin); other installs skip this check.
  const versionDir = dirname(binDir);
  const root = dirname(versionDir);
  if (basename(root) !== 'codex') return null;
  // `ps` shows argv[0]: a `codex` run through PATH carries no version, only its start time does.
  const viaPath = command => command === 'codex' || command.startsWith('codex ') || command.startsWith(`${codexOnPath} `);
  const stale = processes.filter(
    p =>
      (p.command.startsWith(`${root}/`) && !p.command.startsWith(`${versionDir}/`)) ||
      (viaPath(p.command) && p.startedAt < installedAt)
  );
  if (stale.length === 0) return null;
  return { reason: 'stale_codex_process', fix: `stop the processes of another Codex version: kill ${stale.map(p => p.pid).join(' ')}` };
}

/** The real filesystem, `PATH` and the current user's processes for `checkInstall`. */
function localInstall() {
  const isExecutable = path => {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  const codexOnPath =
    (process.env.PATH ?? '')
      .split(delimiter)
      .filter(dir => dir.startsWith('/'))
      .map(dir => join(dir, 'codex'))
      .find(isExecutable) ?? null;
  const lexists = path => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  let installedAt = Infinity;
  if (codexOnPath) {
    const versionDir = dirname(dirname(realpathSync(codexOnPath)));
    const { birthtimeMs, mtimeMs } = statSync(versionDir);
    installedAt = birthtimeMs > 0 ? birthtimeMs : mtimeMs;
  }
  // `-x`: this user's processes only, with or without a terminal. `lstart` is a fixed-format date.
  const ps = execFileSync('ps', ['-xo', 'pid=,lstart=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const processes = ps
    .split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(\w{3} \w{3} +\d+ [\d:]{8} \d{4})\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, started, command]) => ({ pid: Number(pid), startedAt: Date.parse(started), command }));
  return { codexOnPath, realpath: realpathSync, lexists, installedAt, processes };
}

/** Runs the request sequence against `command args`; resolves to the read's result or rejects. */
export function readLimits(command = 'codex', args = ['app-server'], deadlineMs = DEADLINE_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 1000).unref();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), deadlineMs);
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);

    child.on('error', error => finish(new Error(`spawn failed: ${error.code ?? error.message}`)));
    // `close`, not `exit`: it comes after stdout has delivered everything the process wrote.
    child.on('close', () => finish(new Error('app-server exited before answering')));
    // A broken pipe always comes with `error` or `close`, which settle with the real cause.
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > MAX_BUFFER) return finish(new Error('output too large'));
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return finish(new Error('malformed JSON from app-server'));
        }
        if (message.id === 1) {
          if (message.error) return finish(new Error(`initialize failed: ${message.error.message ?? 'error'}`));
          send({ method: 'initialized' });
          send({ method: 'account/rateLimits/read', id: 2 });
        } else if (message.id === 2) {
          if (message.error) return finish(new Error(`rate-limit read failed: ${message.error.message ?? 'error'}`));
          return finish(null, message.result);
        }
        // Any other message is a notification: ignored.
      }
    });
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'luke-codex-budget', title: null, version: '1' } } });
  });
}

async function selfTest() {
  const now = 1_800_000_000;
  const win = (mins, used, resetIn = 600) => ({ windowDurationMins: mins, usedPercent: used, resetsAt: now + resetIn });
  const read = ({ allowed = true, five = 0, week = 0, fiveReset, reached = null, spend = false, swap = false, map = true } = {}) => {
    const windows = [win(FIVE_HOUR_MINS, five, fiveReset), win(WEEK_MINS, week)];
    const [primary, secondary] = swap ? windows.reverse() : windows;
    const snapshot = { limitId: BUCKET, primary, secondary, rateLimitReachedType: reached, spendControlReached: spend };
    return { ordinaryUsageAllowed: allowed, rateLimits: snapshot, ...(map ? { rateLimitsByLimitId: { [BUCKET]: snapshot } } : {}) };
  };
  const withSnapshot = patch => ({ ...read(), rateLimitsByLimitId: { [BUCKET]: { ...read().rateLimits, ...patch } } });
  const is = (result, status, reason) => {
    const v = decide(result, now);
    assert.deepEqual([v.status, v.reason], [status, reason]);
  };

  is(read(), 'go', 'within_thresholds');
  is(read({ five: 50, week: 80 }), 'go', 'within_thresholds');
  is(read({ five: 51 }), 'insufficient', 'five_hour_over_threshold');
  is(read({ week: 81 }), 'insufficient', 'week_over_threshold');
  is(read({ allowed: false }), 'insufficient', 'usage_not_allowed');
  is(read({ allowed: null }), 'unknown', 'permission_unavailable');
  is({ ...read(), ordinaryUsageAllowed: undefined }, 'unknown', 'permission_unavailable');
  is(read({ spend: true }), 'insufficient', 'spend_control_reached');
  is(read({ reached: 'rate_limit_reached' }), 'insufficient', 'limit_reached');
  is(read({ swap: true }), 'go', 'within_thresholds');
  is(read({ map: false }), 'go', 'within_thresholds');
  is({ ...read(), rateLimitsByLimitId: { other: read().rateLimits } }, 'unknown', 'bucket_missing');
  is({ ...read({ map: false }), rateLimits: { ...read().rateLimits, limitId: 'other' } }, 'unknown', 'bucket_missing');
  is(withSnapshot({ secondary: null }), 'unknown', 'window_missing');
  is(withSnapshot({ secondary: win(FIVE_HOUR_MINS, 0) }), 'unknown', 'window_missing');
  is(withSnapshot({ primary: win(FIVE_HOUR_MINS, '10') }), 'unknown', 'window_missing');
  is(withSnapshot({ primary: win(FIVE_HOUR_MINS, -5) }), 'unknown', 'window_missing');
  is(withSnapshot({ secondary: win(WEEK_MINS, 101) }), 'unknown', 'window_missing');
  assert.equal(decide(read({ five: 60, fiveReset: 1800 }), now).offerWait, true);
  assert.equal(decide(read({ five: 60, fiveReset: 7200 }), now).offerWait, false);
  assert.equal(decide(read({ five: 60, fiveReset: -10 }), now).offerWait, false);
  assert.equal(decide(read({ five: 60, week: 90, fiveReset: 1800 }), now).offerWait, false);
  assert.equal(decide(read({ five: 60, reached: 'workspace_owner_credits_depleted', fiveReset: 1800 }), now).offerWait, false);
  assert.equal(decide(read({ five: 10, reached: 'rate_limit_reached', fiveReset: 1800 }), now).offerWait, false);

  // Transport against stand-in processes: each ends in an answer or a rejection, never a hang.
  const fake = body => ['-e', `process.stdin.resume();${body}`];
  // Answers with a notification first and the read's line split across two writes.
  const answers =
    'process.stdin.on("data",d=>{for(const l of String(d).split("\\n").filter(Boolean)){const m=JSON.parse(l);' +
    'if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));' +
    'if(m.id===2){const s=JSON.stringify({method:"note"})+"\\n"+JSON.stringify({id:2,result:{ok:true}});' +
    'process.stdout.write(s.slice(0,30));setTimeout(()=>console.log(s.slice(30)),50)}}})';
  assert.deepEqual(await readLimits(process.execPath, fake(answers), 5000), { ok: true });
  for (const [name, body, message] of [
    ['silent', '', /timeout/],
    ['exits', 'process.exit(0)', /exited before answering/],
    ['malformed', 'console.log("{not json")', /malformed/],
    ['rpc error', 'console.log(JSON.stringify({id:1,error:{message:"not logged in"}}))', /initialize failed/],
    [
      'read error',
      'process.stdin.on("data",d=>{if(String(d).includes("\\"id\\":1"))console.log(JSON.stringify({id:1,result:{}})+' +
        '"\\n"+JSON.stringify({id:2,error:{message:"unavailable"}}))})',
      /rate-limit read failed/,
    ],
    ['oversized', 'process.stdout.write("x".repeat(1_100_000))', /output too large/],
  ]) {
    await assert.rejects(readLimits(process.execPath, fake(body), 1000), message, name);
  }
  await assert.rejects(readLimits('codex-budget-no-such-binary', [], 1000), /spawn failed/);

  // Install check (#288) against a fake Homebrew layout: 0.171.0 installed, 0.170.0 removed.
  const cask = '/opt/homebrew/Caskroom/codex';
  const installedAt = Date.parse('Sat Nov 21 15:20:54 2026');
  const before = installedAt - 3 * 86_400_000;
  const after = installedAt + 3_600_000;
  // `helper: null` leaves the helper unlinked.
  const install = ({ helper = `${cask}/0.171.0/bin/codex-code-mode-host`, processes = [], bin = `${cask}/0.171.0/bin` } = {}) => {
    const links = { '/opt/homebrew/bin/codex': `${bin}/codex` };
    if (helper !== null) links['/opt/homebrew/bin/codex-code-mode-host'] = helper;
    const files = new Set([`${bin}/codex`, `${bin}/codex-code-mode-host`]);
    return {
      installedAt,
      codexOnPath: '/opt/homebrew/bin/codex',
      realpath: path => {
        const target = links[path] ?? path;
        if (!files.has(target)) throw new Error(`ENOENT ${target}`);
        return target;
      },
      lexists: path => path in links || files.has(path),
      processes,
    };
  };
  assert.equal(checkInstall(install()), null);
  assert.equal(checkInstall(install({ helper: null })), null, 'no helper link: not a Homebrew-linked helper');
  const proc = (pid, command, startedAt = after) => ({ pid, command, startedAt });
  assert.equal(checkInstall(install({ processes: [proc(7, `${cask}/0.171.0/bin/codex-code-mode-host --listen`, before)] })), null);
  assert.equal(checkInstall(install({ processes: [proc(8, 'codex app-server')] })), null, 'started after the install');
  assert.equal(checkInstall(install({ processes: [proc(9, '/Users/x/.vscode/extensions/openai/bin/codex app-server', before)] })), null);
  const dangling = checkInstall(install({ helper: `${cask}/0.170.0/bin/codex-code-mode-host` }));
  assert.equal(dangling?.reason, 'helper_link_broken');
  assert.match(dangling.fix, /ln -sf \/opt\/homebrew\/Caskroom\/codex\/0\.171\.0\/bin\/codex-code-mode-host/);
  const stale = checkInstall(install({ processes: [proc(12996, `${cask}/0.170.0/bin/codex-code-mode-host --listen`)] }));
  assert.equal(stale?.reason, 'stale_codex_process');
  assert.match(stale.fix, /12996/);
  const oldServer = checkInstall(install({ processes: [proc(12398, 'codex app-server', before)] }));
  assert.equal(oldServer?.reason, 'stale_codex_process', 'a codex run through PATH before the upgrade');
  assert.match(oldServer.fix, /12398/);
  const npm = '/usr/local/lib/node_modules/@openai/codex/bin';
  assert.equal(
    checkInstall(install({ bin: npm, helper: null, processes: [proc(5, '/usr/local/lib/node_modules/@openai/other/x', before)] })),
    null,
    'a non-Caskroom layout skips the process check'
  );
  assert.equal(checkInstall({ ...install(), codexOnPath: null }), null, 'codex not on PATH: the spawn reports it');

  process.stdout.write('self-test passed\n');
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  let verdict;
  try {
    let broken = null;
    try {
      broken = checkInstall(localInstall());
    } catch (error) {
      process.stderr.write(`codex-budget: install check skipped (${error.message})\n`);
    }
    if (broken) {
      process.stderr.write(`codex-budget: the local Codex install is broken; fix: ${broken.fix}\n`);
      verdict = { ...unknown(broken.reason), fix: broken.fix };
    } else {
      verdict = decide(await readLimits(), Math.floor(Date.now() / 1000));
    }
  } catch (error) {
    process.stderr.write(`codex-budget: ${error.message}\n`);
    verdict = unknown('probe_failed');
  }
  if (verdict.status === 'unknown') {
    process.stderr.write(`codex-budget: budget unknown (${verdict.reason}); the probe needs attention\n`);
  }
  process.stdout.write(`${JSON.stringify({ ...verdict, checkedAt: new Date().toISOString() })}\n`);
  process.exitCode = EXIT[verdict.status];
}
