/**
 * Verifies the integrity and navigability of the tracked Markdown corpus.
 *
 * ## Why it exists
 *
 * `/luke-docs` used to perform these two checks as "Phase 3 — Cross-link
 * verification", delegating pure parsing to an LLM. That is a level-4 control
 * where a level-2 one is sufficient: free, repeatable, and run in CI on every
 * push. Phase 3 was removed from the skill in exchange for this file.
 *
 * ## What it checks
 *
 * 1. **Marker integrity** for `luke-docs:start` / `luke-docs:end`: paired,
 *    non-nested, and non-orphaned. An unbalanced marker can make the next
 *    regeneration overwrite hand-written content.
 * 2. **Relative links**: every Markdown link to a relative path resolves on
 *    disk.
 * 3. **ADR index completeness**: every tracked ADR appears exactly once in
 *    `docs/decisions/README.md`, every index entry points to an existing ADR,
 *    and no number is duplicated.
 * 4. **Reachability**: every tracked Markdown document outside `.claude/` is
 *    reachable by relative links from the repository `README.md`.
 *
 * ## No exception list
 *
 * A broken link must be fixed or removed. An allowlist here would turn the
 * checker into decoration — the same reason audit-skill baselines require a
 * written rationale for every entry.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

import { isGitIgnored } from './lib/gitPaths';
import { formatProblems, REPO_ROOT, type Problem } from './lib/report';

/**
 * The Markdown files **tracked by git and present in the working tree**.
 *
 * Not a filesystem scan: `docs/access-porting/` and
 * `docs/merchandising-reference/` are gitignored, and material excluded from the
 * repository is not the repository's documentation. Delegating to git also keeps
 * that definition in one place, `.gitignore`, instead of a hand-maintained
 * SKIP_DIRS list.
 *
 * `.claude/skills/` is excluded because it has its own checker, with different
 * rules.
 *
 * Both conditions are needed, for opposite reasons. `git ls-files` reads the
 * **index**: it answers "which files does the repository declare", which is what
 * keeps ignored and untracked material out. But the contents are read from the
 * **working tree**, and the two sets diverge the moment someone deletes a file
 * without `git add`: the index still lists it, the disk does not, and the
 * `readFileSync` below died with an unhandled `ENOENT` and a stack trace instead
 * of a diagnosis. An inventory whose purpose is reading must describe what can
 * be read.
 *
 * `existsSync` is an inventory predicate here, not a `catch`: a file that is
 * present but unreadable (permissions, say) still fails the checker, as it
 * should. What is excluded is only what the working tree does not contain.
 */
export function trackedMarkdown(root: string): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '*.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .filter(Boolean)
    .filter(path => !path.startsWith('.claude/'))
    .map(path => join(root, path))
    .filter(path => existsSync(path))
    .sort();
}

/**
 * Actual marker form: a **named** HTML comment,
 * `<!-- luke-docs:start:overview -->` / `<!-- luke-docs:end:overview -->`.
 *
 * The regex matches the complete form rather than the `luke-docs:start`
 * substring. Otherwise, prose that *mentions* the markers (such as this text or
 * section 6 of `docs/quality-hardening-plan.md`) would be read as an open
 * block. The name pairs blocks rather than merely counting them.
 */
const MARKER_RE = /<!--\s*luke-docs:(start|end):([\w-]+)\s*-->/g;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** Returns the path portion of a relative Markdown target, or null if skipped. */
function relativePathPart(target: string): string | null {
  // Out of scope: absolute URLs, mailto links, pure anchors, and templates.
  if (/^(https?:|mailto:|#)/.test(target)) return null;
  if (/[<>*${}]/.test(target)) return null;

  // Anchors are checked separately; reachability and file existence use the path.
  const [pathPart] = target.split('#');
  return pathPart || null;
}

/** Checks for paired, non-nested, non-orphaned markers. */
export function checkMarkers(
  file: string,
  lines: string[],
  problems: Problem[]
): number {
  /** Block name to the opening line that still needs to be closed. */
  const open = new Map<string, number>();
  let seen = 0;

  lines.forEach((line, index) => {
    for (const [, kind, name] of line.matchAll(MARKER_RE)) {
      seen++;
      const lineNumber = index + 1;

      if (kind === 'start') {
        const previous = open.get(name);
        if (previous !== undefined) {
          problems.push({
            file,
            line: lineNumber,
            message: `block \`${name}\` reopened: the one on line ${previous} is not closed.`,
          });
        } else {
          open.set(name, lineNumber);
        }
      } else if (!open.delete(name)) {
        problems.push({
          file,
          line: lineNumber,
          message: `orphaned \`luke-docs:end:${name}\`: no matching opening marker.`,
        });
      }
    }
  });

  for (const [name, lineNumber] of open) {
    problems.push({
      file,
      line: lineNumber,
      message:
        `block \`${name}\` is never closed. Regeneration would overwrite ` +
        'everything that follows.',
    });
  }

  return seen;
}

/** Checks that every relative Markdown link resolves. */
export function checkLinks(
  absoluteFile: string,
  relPath: string,
  lines: string[],
  problems: Problem[]
): number {
  let checked = 0;
  const baseDir = dirname(absoluteFile);

  lines.forEach((line, index) => {
    for (const match of line.matchAll(MARKDOWN_LINK_RE)) {
      const target = match[1];
      const pathPart = relativePathPart(target);
      if (!pathPart) continue;

      checked++;
      const absolute = resolve(baseDir, pathPart);

      // `docs/merchandising-reference/` and `docs/access-porting/` are ignored
      // by git: links to those directories resolve on a developer's disk but
      // not in a clean checkout. The rule that selects *which files* to read
      // (`git ls-files`) also applies to *targets*. Otherwise, it is only half
      // applied — which is how this check passed locally and failed in CI. See
      // `lib/gitPaths.ts`.
      if (!existsSync(absolute) && !isGitIgnored(absolute)) {
        problems.push({
          file: relPath,
          line: index + 1,
          message: `link \`${target}\` does not resolve.`,
        });
      }
    }
  });

  return checked;
}

/**
 * Checks that the tracked Markdown corpus is reachable from `README.md`.
 *
 * The root is a constant, not an inventory that grows with the corpus. Any
 * reached Markdown file can link onward and therefore act as an index. A link
 * to a directory contributes an edge only when that directory has a tracked
 * and present `README.md`; the checker never crawls a directory merely because
 * it exists on one developer's disk. This also leaves gitignored reference
 * directories outside the governed corpus, matching `trackedMarkdown` and
 * `checkLinks`.
 */
export function checkReachability(
  root: string,
  files: string[],
  problems: Problem[]
): number {
  const byRelativePath = new Map(
    files.map(file => [relative(root, file), file] as const)
  );
  const rootPath = 'README.md';

  if (!byRelativePath.has(rootPath)) {
    throw new Error(
      '[docs-integrity] navigation root `README.md` is not tracked and present ' +
        'in the working tree. Reachability cannot be verified.'
    );
  }

  const reachable = new Set<string>([rootPath]);
  const pending = [rootPath];
  let traversedEdges = 0;

  while (pending.length > 0) {
    const currentPath = pending.shift();
    if (currentPath === undefined) break;

    const currentFile = byRelativePath.get(currentPath);
    if (currentFile === undefined) continue;

    const lines = readFileSync(currentFile, 'utf8').split('\n');
    for (const line of lines) {
      for (const match of line.matchAll(MARKDOWN_LINK_RE)) {
        const pathPart = relativePathPart(match[1]);
        if (!pathPart) continue;

        const absoluteTarget = resolve(dirname(currentFile), pathPart);
        const directTarget = relative(root, absoluteTarget);
        const directoryIndex = join(directTarget, 'README.md');
        let nextPath: string | null = null;
        if (byRelativePath.has(directTarget)) {
          nextPath = directTarget;
        } else if (byRelativePath.has(directoryIndex)) {
          nextPath = directoryIndex;
        }

        if (nextPath === null) continue;
        traversedEdges++;

        if (!reachable.has(nextPath)) {
          reachable.add(nextPath);
          pending.push(nextPath);
        }
      }
    }
  }

  // Zero-discovery guard: a broken link parser must fail loudly rather than
  // reporting a permanently green reachability check over only the root.
  if (traversedEdges === 0 || reachable.size === 1) {
    throw new Error(
      '[docs-integrity] navigation traversal produced no closure beyond ' +
        `\`README.md\`: 1 reachable, ${files.length - 1} orphaned. The link ` +
        'pattern may no longer match the documentation graph.'
    );
  }

  for (const relPath of byRelativePath.keys()) {
    if (!reachable.has(relPath)) {
      problems.push({
        file: relPath,
        line: 1,
        message:
          'document is not reachable from `README.md`. Link it from the ' +
          'appropriate documentation index; do not add reachability exceptions.',
      });
    }
  }

  return reachable.size;
}

/**
 * ADR index completeness.
 *
 * ADRs 013 and 014 existed and were Accepted, but the generated index stopped
 * at 012: maintenance had been deferred, and nothing required it. This check
 * prevents deferred maintenance from becoming permanent drift.
 *
 * What it does **not** do: this is not the ADR discovery channel. `luke-audit`
 * reads tracked files under `docs/decisions/` directly because the index is not
 * proof of existence — an ADR missing from the index remains visible to the
 * architecture audit. This check keeps the **human** index complete and
 * consistent with the tracked corpus: every ADR represented exactly once and
 * every entry resolving to a real ADR.
 *
 * It deliberately does **not** verify `Status`: the repository uses two header
 * formats (`## Status` and `**Status**:`), and an ADR's status is a semantic
 * fact subject to human decision. This check covers only what is structural
 * and unambiguous.
 */
export function checkAdrIndex(root: string, problems: Problem[]): number {
  const indexPath = 'docs/decisions/README.md';
  const absoluteIndex = join(root, indexPath);

  const tracked = execFileSync('git', ['ls-files', 'docs/decisions/*.md'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  // Same rule as `trackedMarkdown`: tracked **and** present. An ADR deleted
  // without staging stayed in `git ls-files` and was counted as present, so the
  // index row citing it did not read as dangling — the check confirmed an index
  // pointing at a file that could no longer be read.
  const adrFiles = tracked
    .filter(path => existsSync(join(root, path)))
    .map(path => path.split('/').pop() ?? '')
    .filter(name => /^\d+-/.test(name));

  if (!existsSync(absoluteIndex)) {
    // Two different states, not one, and the ADR corpus is what separates them.
    // A repository with no index and no ADRs never had the contract and is not
    // judged: return zero. A repository that still has ADRs but no index has
    // lost the contract it had, whatever git's index says about the file.
    //
    // Asking git whether the index file is still tracked is what this used to
    // do, and it failed open one step later: staging the deletion — the state a
    // commit and CI actually see — drops the path from `git ls-files`, and the
    // completeness check would go quiet with every ADR still in place. The
    // zero-discovery guard in `main` cannot cover it either, being conditioned
    // on that same file existing.
    if (adrFiles.length > 0) {
      problems.push({
        file: indexPath,
        line: 1,
        message:
          `there are ${adrFiles.length} ADRs in the working tree but the index ` +
          'is missing. Until it is restored, index completeness cannot be ' +
          'verified: undo only the file deletion without overwriting existing ' +
          'edits, or stage the deliberate removal together with the ' +
          'disposition of the ADRs it indexed.',
      });
    }
    return 0;
  }

  const index = readFileSync(absoluteIndex, 'utf8');
  const linked = [...index.matchAll(/\|\s*\[(\d+)\]\(([^)]+)\)/g)];

  // ADR number to file, from tracked and present files.
  const byNumber = new Map<string, string>();
  for (const name of adrFiles) {
    const number = name.split('-')[0];
    const existing = byNumber.get(number);
    if (existing !== undefined) {
      problems.push({
        file: 'docs/decisions/',
        line: 1,
        message:
          `duplicate ADR number \`${number}\`: \`${existing}\` and \`${name}\`. ` +
          'The number identifies a decision in citations, so two files sharing ' +
          'it make every reference ambiguous.',
      });
    } else {
      byNumber.set(number, name);
    }
  }

  const indexedNumbers = new Set(linked.map(match => match[1]));

  for (const [number, name] of byNumber) {
    if (!indexedNumbers.has(number)) {
      problems.push({
        file: indexPath,
        line: 1,
        message:
          `ADR \`${name}\` does not appear in the index. The audit still sees ` +
          'it because it reads files rather than the index, but the human ' +
          'index is incomplete.',
      });
    }
  }

  for (const [, number, target] of linked) {
    if (!byNumber.has(number)) {
      problems.push({
        file: indexPath,
        line: 1,
        message:
          `index entry \`${number}\` points to \`${target}\`, which is not an ` +
          'ADR in the corpus: it is either untracked or deleted from the ' +
          'working tree.',
      });
    }
  }

  return byNumber.size;
}

function main(): void {
  const files = trackedMarkdown(REPO_ROOT);

  if (files.length === 0) {
    throw new Error(
      '[docs-integrity] no Markdown file is tracked and present in the working ' +
        'tree. Either this is not a git repository, Markdown files are not ' +
        'tracked, or all of them were deleted: the check would pass without ' +
        'reading anything.'
    );
  }

  const problems: Problem[] = [];
  let linksChecked = 0;
  let markersSeen = 0;

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const relPath = relative(REPO_ROOT, file);
    markersSeen += checkMarkers(relPath, lines, problems);
    linksChecked += checkLinks(file, relPath, lines, problems);
  }

  // Zero-discovery guard: an overly narrow regular expression would turn this
  // script into a permanently green no-op without anyone noticing.
  if (linksChecked === 0) {
    throw new Error(
      `[docs-integrity] zero links extracted from ${files.length} Markdown files. ` +
        'The pattern no longer matches anything.'
    );
  }
  if (markersSeen === 0) {
    throw new Error(
      '[docs-integrity] no `luke-docs:` marker found. Generated READMEs contain ' +
        'them: if all markers disappeared, either the syntax changed or ' +
        'generation lost them. In either case, the marker check would pass ' +
        'without verifying anything.'
    );
  }

  const reachableFiles = checkReachability(REPO_ROOT, files, problems);

  const adrsChecked = checkAdrIndex(REPO_ROOT, problems);

  // Same zero-discovery guard as the rest of the file: if ADR discovery stops
  // finding them, the completeness check would pass without verifying anything.
  if (adrsChecked === 0 && existsSync(join(REPO_ROOT, 'docs/decisions/README.md'))) {
    throw new Error(
      '[docs-integrity] ADR index present but no ADR is tracked and present in ' +
        'the working tree. Index completeness would pass without comparing ' +
        'anything.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `[docs-integrity] ${problems.length} problems:\n${formatProblems(problems)}\n\n` +
        'Fix or remove the link. Do not add exceptions.'
    );
  }

  console.log(
    `[docs-integrity] ok — ${files.length} files, ${linksChecked} links, ` +
      `${markersSeen} markers, ${reachableFiles} reachable, and ${adrsChecked} ` +
      'indexed ADRs verified.'
  );
}

main();
