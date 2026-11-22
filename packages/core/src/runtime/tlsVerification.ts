/**
 * The problem to report when the environment turns Node's default TLS certificate verification off,
 * or `undefined` when it does not. Shared by apps/api (`assertEnvPolicy`) and the apps/web server
 * start (`instrumentation.ts`): one rule, one message (ADR-045, ADR-046).
 */
export function tlsVerificationOffProblem(env: Readonly<Record<string, string | undefined>>): string | undefined {
  // A value check: Node turns default verification off for exactly '0' (`getAllowUnauthorized`).
  if (env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') return undefined;
  return (
    'NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate verification by default. ' +
    'Remove it and configure trusted certificates instead.'
  );
}
