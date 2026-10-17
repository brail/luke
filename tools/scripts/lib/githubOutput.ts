/**
 * `$GITHUB_OUTPUT` writing shared by the release gates.
 *
 * The runner reads a one-line value as `name=value` and a multiline one as a
 * `name<<DELIMITER` block. `check-release-provenance.ts` and
 * `check-release-tree.ts` both hand outputs to `release.yml`, so the format
 * rules live here once.
 */

import { randomUUID } from 'crypto';
import { appendFileSync } from 'fs';

/**
 * One multiline output block. The delimiter is random so the value cannot end
 * the block early; a value that contains it anyway is refused, not truncated.
 */
export function githubOutputBlock(
  name: string,
  value: string,
  delimiter = `ghadelimiter_${randomUUID()}`
): string {
  if (value.split('\n').includes(delimiter)) {
    throw new Error(`the ${name} output contains its own delimiter.`);
  }
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

/** Appends every output to `file`: one-line values as `name=value`, the rest as blocks. */
export function appendGithubOutput(
  file: string,
  outputs: Record<string, string>
): void {
  appendFileSync(
    file,
    Object.entries(outputs)
      .map(([name, value]) =>
        value.includes('\n')
          ? githubOutputBlock(name, value)
          : `${name}=${value}\n`
      )
      .join('')
  );
}
