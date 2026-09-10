/**
 * What the repository can assert, and what it cannot.
 *
 * A verification script must make claims only about what the repository
 * contains. A path excluded by `.gitignore` exists on a developer's disk but
 * not in a clean checkout: checking it makes the check pass locally and fail in
 * CI, which means it is reading the wrong world.
 *
 * This lives here rather than inside one checker because the rule has already
 * been applied only halfway: `check-docs-integrity.ts` used it to choose *which
 * files to read* (`git ls-files`), while `check-skill-integrity.ts` did not use
 * it at all. When it was added to the latter, the former still checked ignored
 * *link targets*. Two CI failures had the same cause. A rule shared by two
 * scripts belongs in one place.
 */

import { execFileSync } from 'child_process';

import { REPO_ROOT } from './report';

function checkIgnore(path: string): boolean {
  try {
    // Exit 0 means ignored, 1 means not ignored, and >1 is an error treated as not ignored.
    execFileSync('git', ['check-ignore', '-q', '--', path], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `true` when git ignores the path.
 *
 * Also tries the form with a trailing slash. A directory-only pattern in
 * `.gitignore` (`docs/access-porting/`) matches only when git can determine that
 * the path is a directory. When the path **does not exist** — exactly the clean
 * checkout case that matters here — git cannot do so unless the slash supplies
 * that information. Measured in this repository:
 *
 *   docs/access-porting    → exit 1, does not match
 *   docs/access-porting/   → exit 0, matches
 *
 * `path.resolve()` strips the trailing slash, so without this attempt the check
 * returned `false` and reported a link to a deliberately ignored directory as
 * broken.
 *
 * @param path - Relative to the repository root, or absolute within it.
 */
export function isGitIgnored(path: string): boolean {
  if (checkIgnore(path)) return true;
  return path.endsWith('/') ? false : checkIgnore(`${path}/`);
}
