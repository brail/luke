// ruleid: luke-no-direct-env
import { env } from 'node:process';

declare function read(source: unknown): void;
declare const key: string;

function bad() {
  // ruleid: luke-no-direct-env
  const dbUrl = process.env.SOME_APP_SECRET;
  return dbUrl;
}

function goodNextPublic() {
  // ok: luke-no-direct-env
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return version;
}

function goodNodeEnv() {
  // ok: luke-no-direct-env
  const isDev = process.env.NODE_ENV === 'development';
  return isDev;
}

// Optional chaining is not the dot form, so it is refused like the others;
// `process.env` always exists in Node anyway.
function badOptionalChain() {
  // ruleid: luke-no-direct-env
  return process.env?.APP_VERSION;
}

function goodAppVersion() {
  // ok: luke-no-direct-env
  return process.env.APP_VERSION;
}

// Bracket access is refused even for an exempt key: the exemptions are
// readable only in the dot form.
function badBracketExemptKey() {
  // ruleid: luke-no-direct-env
  return process.env['NODE_ENV'];
}

function badBracketSecret() {
  // ruleid: luke-no-direct-env
  return process.env['SOME_APP_SECRET'];
}

function badDynamicKey() {
  // ruleid: luke-no-direct-env
  return process.env[key];
}

function badDestructureExemptKey() {
  // ruleid: luke-no-direct-env
  const { NODE_ENV } = process.env;
  return NODE_ENV;
}

function badDestructureMixed() {
  // ruleid: luke-no-direct-env
  const { NODE_ENV, SOME_APP_SECRET } = process.env;
  return [NODE_ENV, SOME_APP_SECRET];
}

function badAliases() {
  // ruleid: luke-no-direct-env
  const all = process.env;
  // ruleid: luke-no-direct-env
  let e = process.env;
  // ruleid: luke-no-direct-env
  e = process.env;
  return [all, e];
}

function badSpreadAndPass() {
  // ruleid: luke-no-direct-env
  const copy = { ...process.env };
  // ruleid: luke-no-direct-env
  read(process.env);
  // ruleid: luke-no-direct-env
  return [copy, Object.keys(process.env)];
}

export { env, bad, goodNextPublic, goodNodeEnv, badOptionalChain, goodAppVersion, badBracketExemptKey, badBracketSecret, badDynamicKey, badDestructureExemptKey, badDestructureMixed, badAliases, badSpreadAndPass };
