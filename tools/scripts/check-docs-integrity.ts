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
 * 5. **Fragments** in inline Markdown links: same-file and tracked Markdown
 *    targets, including directory README indexes, resolve to heading anchors.
 * 6. **Owned indexes**: the docs hub links the ADR index once, without ADR
 *    rows; each ADR index title matches the target H1, without its ADR prefix.
 *
 * ## No exception list
 *
 * A broken link must be fixed or removed. An allowlist here would turn the
 * checker into decoration — the same reason audit-skill baselines require a
 * written rationale for every entry.
 * Unlike the skill checker, this checker has no inline ignore marker: skills
 * sometimes cite deliberately removed paths, whereas navigation must resolve.
 * Frozen historical documents are not exempt from structural checks.
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
 * `.claude/**` is excluded because it has its own checker, with different
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

/** Hide fenced examples and HTML comments while preserving source line numbers. */
function proseLines(text: string): string[] {
  let fence = '';
  return text
    .replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => {
      const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (
          delimiter &&
          delimiter[1][0] === fence[0] &&
          delimiter[1].length >= fence.length &&
          !delimiter[2].trim()
        )
          fence = '';
        return '';
      }
      if (delimiter) {
        fence = delimiter[1];
        return '';
      }
      return line;
    });
}

/** Heading text, not link destinations or HTML tags, determines the anchor. */
function headingText(text: string): string {
  const code: string[] = [];
  return text
    .replace(/(`+)(.*?)\1/g, (_match, _ticks: string, contents: string) => {
      code.push(contents);
      return `\uE000${code.length - 1}\uE000`;
    })
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/([*~]+)(.*?)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}])(_{1,2})(.+?)\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(
      /\uE000(\d+)\uE000/g,
      (_match, index: string) => code[Number(index)]
    )
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|apos|nbsp);/g, '')
    .trim();
}

/**
 * ATX and single-line Setext headings outside fenced examples/comments.
 * GitHub section-link rules: lowercase, punctuation removal, one hyphen per
 * space (not whitespace collapsing), then collision-aware numeric suffixes.
 * Tests cite GitHub's documentation and pin Unicode and duplicate collisions.
 * This is not a full Markdown renderer: reference-style links, HTML headings,
 * and block-container headings are outside the parser's supported syntax.
 */
export function headingAnchors(text: string): Set<string> {
  const lines = proseLines(text);
  const anchors = new Set<string>();
  lines.forEach((line, index) => {
    const atx = line.match(/^ {0,3}#{1,6}[ \t]+(.+)$/);
    const setext = /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '');
    const heading =
      atx?.[1].replace(/[ \t]+#+[ \t]*$/, '') ??
      (setext && line.trim() ? line.trim() : null);
    if (heading === null) return;
    const base = headingText(heading)
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '')
      .replace(/ /g, '-');
    let slug = base;
    let suffix = 0;
    while (anchors.has(slug)) slug = `${base}-${++suffix}`;
    anchors.add(slug);
  });
  return anchors;
}

/**
 * Same corpus as reachability, including frozen bodies. Raw HTML custom anchors
 * leave a documented gap: per the approved plan, targets containing them are
 * skipped rather than pretending the heading parser understands HTML anchors.
 * Missing files remain checkLinks' responsibility; external fragments and
 * non-Markdown targets are outside this check. No per-file exemption list.
 */
export function checkAnchors(
  root: string,
  files: string[],
  problems: Problem[]
): number {
  const corpus = new Set(files);
  const texts = new Map(files.map(file => [file, readFileSync(file, 'utf8')]));
  const anchors = new Map(
    files.map(file => [file, headingAnchors(texts.get(file) ?? '')])
  );
  let checked = 0;
  for (const file of files) {
    proseLines(texts.get(file) ?? '').forEach((line, index) => {
      // Inline examples are not navigation links either.
      const prose = line.replace(/(`+)[\s\S]*?\1/g, '');
      for (const match of prose.matchAll(MARKDOWN_LINK_RE)) {
        const target = match[1];
        const hash = target.indexOf('#');
        if (
          hash < 0 ||
          /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) ||
          /[<>*${}]/.test(target)
        )
          continue;
        const path = target.slice(0, hash);
        let destination = path ? resolve(dirname(file), path) : file;
        if (!corpus.has(destination))
          destination = join(destination, 'README.md');
        if (!corpus.has(destination)) continue;
        const destinationProse = proseLines(texts.get(destination) ?? '')
          .map(line => line.replace(/(`+)[\s\S]*?\1/g, ''))
          .join('\n');
        if (/<a\b[^>]*\b(?:name|id)\s*=/i.test(destinationProse)) continue;
        let fragment: string;
        try {
          fragment = decodeURIComponent(target.slice(hash + 1));
        } catch {
          problems.push({
            file: relative(root, file),
            line: index + 1,
            message: `fragment in \`${target}\` has invalid percent encoding.`,
          });
          continue;
        }
        if (!fragment) continue; // An empty fragment addresses the document top.
        checked++;
        if (!anchors.get(destination)?.has(fragment)) {
          problems.push({
            file: relative(root, file),
            line: index + 1,
            message: `fragment \`${target}\` does not resolve to a heading.`,
          });
        }
      }
    });
  }
  return checked;
}

/** Only the generated docs hub is constrained; ordinary ADR citations are free. */
export function checkOwnedIndexSurfaces(
  root: string,
  problems: Problem[]
): void {
  const file = 'docs/README.md';
  const absolute = join(root, file);
  if (!existsSync(absolute)) {
    problems.push({
      file,
      line: 1,
      message:
        'documentation hub is missing; its owned index cannot be checked.',
    });
    return;
  }
  const text = readFileSync(absolute, 'utf8');
  const blocks = [
    ...text.matchAll(
      /<!--\s*luke-docs:start:index\s*-->([\s\S]*?)<!--\s*luke-docs:end:index\s*-->/g
    ),
  ];
  if (blocks.length !== 1) {
    problems.push({
      file,
      line: 1,
      message: 'expected exactly one generated `index` block.',
    });
    return;
  }
  const block = blocks[0];
  const startLine = text.slice(0, block.index).split('\n').length;
  let indexLinks = 0;
  proseLines(block[1]).forEach((line, index) => {
    for (const match of line.matchAll(MARKDOWN_LINK_RE)) {
      const path = relativePathPart(match[1]);
      if (!path) continue;
      const target = relative(root, resolve(root, 'docs', path));
      if (target === 'docs/decisions/README.md' || target === 'docs/decisions')
        indexLinks++;
      if (/^docs\/decisions\/\d+-[^/]+\.md$/.test(target)) {
        problems.push({
          file,
          line: startLine + index,
          message:
            'generated docs index must link the ADR index, not individual ADRs.',
        });
      }
    }
  });
  if (indexLinks !== 1)
    problems.push({
      file,
      line: startLine,
      message: `expected exactly one link to \`decisions/README.md\`, found ${indexLinks}.`,
    });
}

/** Pin both legacy colon and newer em-dash H1 prefixes without changing status. */
export function checkAdrTitleMatch(
  root: string,
  files: string[],
  problems: Problem[]
): number {
  const file = 'docs/decisions/README.md';
  const absolute = join(root, file);
  if (!files.includes(absolute)) return 0; // Missing index is diagnosed by checkAdrIndex.
  const corpus = new Set(files);
  const seen = new Set<string>();
  let checked = 0;
  proseLines(readFileSync(absolute, 'utf8')).forEach((line, index) => {
    const row = line.match(/^\s*\|\s*\[(\d+)\]\(([^)]+)\)\s*\|\s*([^|]*)\|/);
    if (!row) {
      if (/^\s*\|\s*\[\d+\]\(/.test(line))
        problems.push({
          file,
          line: index + 1,
          message: 'ADR index row must contain a title cell.',
        });
      return;
    }
    const [, number, target, title] = row;
    const report = (message: string): void => {
      problems.push({ file, line: index + 1, message });
    };
    if (seen.has(number)) report(`duplicate ADR index entry \`${number}\`.`);
    seen.add(number);
    const destination = resolve(dirname(absolute), target);
    if (
      !corpus.has(destination) ||
      !new RegExp(`^${number}-[^/]+\\.md$`).test(
        relative(dirname(absolute), destination)
      )
    ) {
      report(`ADR index entry \`${number}\` must target its tracked ADR file.`);
      return;
    }
    checked++;
    const h1 = proseLines(readFileSync(destination, 'utf8')).find(value =>
      /^#\s+/.test(value)
    );
    const prefix = new RegExp(`^#\\s+ADR-${number}(?::|\\s+—)\\s+(.+?)\\s*$`);
    const canonical = h1?.match(prefix)?.[1];
    if (canonical === undefined)
      report(`ADR \`${target}\` has no matching numbered H1.`);
    else if (title.trim() !== canonical)
      report(`ADR index title must match H1 exactly: \`${canonical}\`.`);
  });
  return checked;
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
  const fragmentsChecked = checkAnchors(REPO_ROOT, files, problems);
  if (fragmentsChecked === 0) {
    throw new Error(
      '[docs-integrity] zero heading fragments checked; navigation anchors were not verified.'
    );
  }
  checkOwnedIndexSurfaces(REPO_ROOT, problems);
  const titlesChecked = checkAdrTitleMatch(REPO_ROOT, files, problems);
  if (titlesChecked === 0 && adrsChecked > 0) {
    throw new Error(
      '[docs-integrity] no ADR titles compared; the title parser discovered no rows.'
    );
  }

  // Same zero-discovery guard as the rest of the file: if ADR discovery stops
  // finding them, the completeness check would pass without verifying anything.
  if (
    adrsChecked === 0 &&
    existsSync(join(REPO_ROOT, 'docs/decisions/README.md'))
  ) {
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
      `indexed ADRs verified; ${fragmentsChecked} fragments and ${titlesChecked} ADR titles checked.`
  );
}

main();
