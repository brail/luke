import { describe, expect, it } from 'vitest';

import { tlsVerificationOffProblem } from '../tlsVerification.js';

describe('tlsVerificationOffProblem', () => {
  it('names the variable and the remedy for exactly "0"', () => {
    const problem = tlsVerificationOffProblem({ NODE_TLS_REJECT_UNAUTHORIZED: '0' });
    expect(problem).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate verification');
    expect(problem).toContain('configure trusted certificates');
  });

  // Node turns verification off for exactly '0' (`getAllowUnauthorized`, lib/internal/options.js).
  it.each(['1', '', ' 0', '00', 'false', undefined])('reports nothing for %j, which Node keeps verifying', value => {
    expect(tlsVerificationOffProblem({ NODE_TLS_REJECT_UNAUTHORIZED: value })).toBeUndefined();
  });
});
