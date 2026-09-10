/**
 * Verifies that skills in `.claude/skills/` have not drifted from the codebase.
 *
 * ## Why it exists
 *
 * For months, `luke-test/SKILL.md` instructed agents to add every new spec to
 * `test/integration-specs.ts` — a deleted file — and to use
 * `hasTestDatabase()`, a function removed because its enabling pattern made the
 * job report green with zero tests executed. A skill that teaches a structure
 * that no longer exists is worse than no skill: the next run writes to the
 * wrong place using a deleted helper.
 *
 * Skills are prose, and prose remains a level-4 control. The **verifiable
 * facts** they assert — paths, symbols, and agent capabilities — can be raised
 * to level 2. That is what this script does.
 *
 * ## Intentional references
 *
 * A reference to something removed can be deliberate: skills also explain what
 * NOT to do anymore, and citing it is the point. Mark those lines with
 * `<!-- skill-check-ignore -->`. If many such markers become necessary, the
 * heuristic or the skill is the problem — do not add markers indiscriminately,
 * or the checker becomes decoration.
 */

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';

import { isGitIgnored } from './lib/gitPaths';
import { formatProblems, REPO_ROOT, type Problem } from './lib/report';

const SKILLS_DIR = join(REPO_ROOT, '.claude', 'skills');
export const IGNORE_MARKER = '<!-- skill-check-ignore -->';

/** Top-level directories that make a token a repository path. */
const REPO_TOP_DIRS = [
  'apps/',
  'packages/',
  'docs/',
  'tools/',
  'scripts/',
  'prisma/',
  '.github/',
  '.semgrep/',
  '.husky/',
  '.claude/',
];

/** Extensions that make a token a file path regardless of its location. */
const FILE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.prisma',
  '.sh',
];

/** All Markdown files belonging to skills. */
function skillFiles(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(entry.parentPath ?? SKILLS_DIR, entry.name))
    .sort();
}

/**
 * A token is a repository path when it contains `/` and either sits below a
 * known directory or has a file extension. Placeholders and globs stay out:
 * `<name>.yml` and `apps/<app>/next.config.*` make no assertion about an
 * existing file.
 */
export function isRepoPath(token: string): boolean {
  if (!token.includes('/')) return false;
  if (/[<>*$\s()]/.test(token)) return false;
  if (token.startsWith('http')) return false;
  if (token.startsWith('@')) return false; // npm package, not a path
  return (
    REPO_TOP_DIRS.some(dir => token.startsWith(dir)) ||
    FILE_EXTENSIONS.some(ext => token.endsWith(ext))
  );
}

/** A token is a symbol reference when it has the form `identifier()`. */
export function isSymbolRef(token: string): boolean {
  return /^[a-zA-Z_$][\w$]*\(\)$/.test(token);
}

/**
 * Reference frames in which a path cited by a skill may be expressed.
 *
 * Skills describe paths from different perspectives: `references/adr-rules.md`
 * is relative to the skill, `apps/api/test/helpers.ts` to the repository root,
 * `test/helpers.ts` to `apps/api`, and `lib/debug.ts` to `apps/web/src`. Trying
 * every real frame is less fragile than demanding a single convention in a
 * prose file.
 */
const PATH_ROOTS = [
  '',
  // Package roots are not listed by hand: the previous list omitted
  // `packages/eslint-plugin-luke`, so every path cited relative to that package
  // was reported as broken — a false positive in a CI-blocking check, exactly
  // the pressure that makes ignore markers proliferate. As with
  // `trackedMarkdown()`, git declares the world.
  ...execFileSync('git', ['ls-files', '*/package.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map(p => dirname(p)),
  // This is not a package root, but it is a frame skills actually use
  // (`lib/debug.ts` is relative to it).
  'apps/web/src',
];

function pathResolves(token: string, skillDir: string): boolean {
  if (existsSync(join(skillDir, token))) return true;
  if (PATH_ROOTS.some(root => existsSync(join(REPO_ROOT, root, token)))) {
    return true;
  }
  // Not found. If git ignores it — `.planning/ROADMAP.md`, cited by
  // `luke-docs` — the repository cannot make a claim: it exists on a
  // developer's disk but not in a clean checkout. See `lib/gitPaths.ts`.
  return isGitIgnored(token);
}

/**
 * Whether the symbol exists somewhere under apps/ or packages/.
 *
 * This checks **existence**, not exports: a skill may legitimately cite a
 * module-local function (`assertEnvPolicy()` in `server.ts` is not exported,
 * but the skill's assertion about it is true). What matters is catching a
 * reference to something that no longer exists.
 */
let declaredSymbols: Set<string> | null = null;

function symbolExists(name: string): boolean {
  // Scan the corpus once, not once per symbol. The previous version ran a
  // recursive `grep -q` over apps/ and packages/ for every cited token,
  // including duplicates: about 5s of the script's roughly 5.7s total, with
  // cost growing linearly with the number of skills. Extracting every
  // declaration at once takes about 70ms and reduces later checks to Set
  // lookups.
  if (!declaredSymbols) {
    const output = execFileSync(
      'grep',
      [
        '-rhoE',
        '--include=*.ts',
        '--include=*.tsx',
        '(function|const|class|type|interface) [a-zA-Z_$][a-zA-Z0-9_$]*',
        'apps',
        'packages',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );

    declaredSymbols = new Set(
      output
        .split('\n')
        .filter(Boolean)
        .map(match => match.slice(match.indexOf(' ') + 1))
    );

    // Same zero-discovery guard as the rest of the file: an empty corpus means
    // the grep no longer matches, not that no symbols exist. Without this
    // guard, every reference would be reported as broken at once.
    if (declaredSymbols.size === 0) {
      throw new Error(
        '[skill-integrity] no declaration extracted from apps/ and packages/. ' +
          'The pattern no longer matches anything: continuing would report ' +
          'every symbol cited by the skills as broken.'
      );
    }
  }

  return declaredSymbols.has(name);
}

/**
 * Execution contract of a `SKILL.md`.
 *
 * Claude Code's skill frontmatter makes `background` optional, and a fork
 * defaults to running as a background agent that reports back as a task
 * notification instead of blocking the turn. `luke-full` instructs itself to
 * wait for each child skill before starting the next — under that default the
 * children would not block and the instruction would be a promise the runtime
 * cannot keep. Same class as the fan-out this file already guards: a skill
 * asserting behavior the runtime does not provide.
 *
 * Unknown frontmatter keys are deliberately NOT checked. The key set belongs to
 * Claude Code, not to this repo, and hardcoding it here would turn the next CLI
 * upgrade into a red gate. Only invariants the project owns are enforced.
 *
 * See `.claude/skills/luke-shared/audit-protocol.md` §6.1.
 */

/** Tools the read-only marker asserts are gone. Not a filesystem sandbox: a skill keeping Bash can still write through it. */
const DIRECT_WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/** The project-owned literal by which a skill declares itself read-only. */
const READONLY_MARKER = 'Do NOT modify any file';

/**
 * The frontmatter block, matched once for every reader of it.
 *
 * Two spellings of this regex is two definitions of "what frontmatter is": the
 * day one learns about CRLF or a trailing space after `---`, the other keeps
 * the old shape, and a check that depends on where the body starts silently
 * accepts a frontmatter line as a body line.
 */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** Frontmatter body of a skill file, or null when it has none. */
function frontmatter(content: string): string | null {
  const match = content.match(FRONTMATTER_RE);
  return match ? match[1] : null;
}

/** 0-based index of the first body line: everything after the frontmatter. */
function bodyStart(content: string): number {
  const match = content.match(FRONTMATTER_RE);
  return match ? match[0].split('\n').length : 0;
}

/** 1-based line of the first match, for anchoring a problem. */
function lineOf(content: string, pattern: RegExp): number {
  const match = content.match(pattern);
  return match?.index === undefined
    ? 1
    : content.slice(0, match.index).split('\n').length;
}

/**
 * Checks the declaration, not the enforcement: that the fields are present and
 * mutually consistent. Whether the runtime honors them is Claude Code's
 * contract, read from its frontmatter schema and not proven here.
 */
export function checkExecutionContract(
  relPath: string,
  content: string,
  problems: Problem[]
): void {
  const fm = frontmatter(content);
  if (fm === null) {
    problems.push({
      file: relPath,
      line: 1,
      message:
        'no frontmatter. A SKILL.md without it declares no execution ' +
        'contract at all, so every invariant below is silently unenforced.',
    });
    return;
  }

  if (/^context:\s*fork\s*$/m.test(fm)) {
    // fork-declares-background
    if (!/^background:\s*(true|false)\s*$/m.test(fm)) {
      problems.push({
        file: relPath,
        line: lineOf(content, /^context:\s*fork\s*$/m),
        message:
          'declares `context: fork` without an explicit `background: true|false`. ' +
          'A fork defaults to background execution, so an orchestrator that ' +
          'waits for this skill would not actually be waiting. Declare it.',
      });
    }

    // fork-declares-agent
    if (!/^agent:\s*\S+/m.test(fm)) {
      problems.push({
        file: relPath,
        line: lineOf(content, /^context:\s*fork\s*$/m),
        message:
          'declares `context: fork` without `agent:`. The agent type is what ' +
          'decides the fork\'s tool and permission model — leaving it implicit ' +
          'makes that model unreviewable.',
      });
    }
  }

  // readonly-skill-disallows-direct-write-tools
  if (content.includes(READONLY_MARKER)) {
    const declared = fm.match(/^disallowed-tools:\s*(.+)$/m)?.[1] ?? '';
    const missing = DIRECT_WRITE_TOOLS.filter(
      tool => !new RegExp(`\\b${tool}\\b`).test(declared)
    );
    if (missing.length > 0) {
      problems.push({
        file: relPath,
        line: lineOf(content, new RegExp(READONLY_MARKER)),
        message:
          `says "${READONLY_MARKER}" but does not remove ${missing.join(', ')} ` +
          'via `disallowed-tools`. Prose is a level-4 control; the frontmatter ' +
          'field is structural. This removes the direct write tools only — a ' +
          'skill keeping Bash is still not sandboxed.',
      });
    }
  }
}

/** The one line on which a `SKILL.md` may spell the arguments placeholder. */
export const ARGUMENT_BINDING = '**Invocation arguments:** $ARGUMENTS';

/**
 * `$ARGUMENTS` appears only on the canonical binding line.
 *
 * Claude Code substitutes every occurrence of the placeholder, so one written
 * inside a sentence rewrites that sentence with the invocation. `luke-docs`
 * carried "No mode in $ARGUMENTS -> run readme -> inline -> adr in sequence":
 * invoked with `readme` that renders, deterministically, as an instruction to
 * run all three modes — a valid and unsafe path out of a single-mode request.
 * The substitution also consumes the placeholder, so the runtime's trailing
 * `ARGUMENTS: <value>` fallback never fires to correct it.
 *
 * A `/luke-docs readme` run was separately observed doing ADR work and
 * rewriting the ADR index, and its signature matches that path. It is not
 * proven to be the cause: one A/B run against the unfixed text did not
 * reproduce the cross-mode write. The rendering is the demonstrated fact; the
 * attribution is plausible. Either way the path had to go.
 *
 * So the rule is unconditional: **every `SKILL.md` carries exactly one
 * canonical binding line in its body**, whether or not its frontmatter declares
 * `argument-hint:`. `audit-protocol.md` §1 step 1 asks for the binding in prose;
 * fixing the exact line is what makes it checkable, and the failure message
 * carries the literal so a skill written to the protocol can be repaired
 * without reading this file.
 *
 * Keying the requirement on `argument-hint:` was tried and rejected: deleting
 * the hint and the binding together left the gate green, so the one edit that
 * reintroduces the defect was the one edit it could not see. Deciding which
 * skills "take arguments" needs a heuristic this checker has no way to get
 * right; a uniform line is smaller than the heuristic. A skill that takes no
 * arguments still carries it and is handed an empty value.
 *
 * Indentation does not defeat the invariant — the placeholder is still alone on
 * its line — so the comparison trims both ends. A binding only counts in the
 * **body**, though: the folded `description:` block indents its continuation
 * lines, so a canonical-looking line there would trim to a match and satisfy
 * the requirement while the body still never binds. An occurrence inside the
 * frontmatter is reported like any other.
 *
 * Known limit: a canonical line inside a fenced code block still counts. No
 * skill is in that shape, and a fence-aware parser is more machinery than the
 * risk earns — but it is a hole, not a decision.
 *
 * `<!-- skill-check-ignore -->` is deliberately NOT honoured here. That marker
 * says "this reference to something removed is intentional"; it cannot say
 * "this substitution does not happen", because it does happen. Honouring it
 * would let the defect back in with a comment on top of it.
 *
 * Only `SKILL.md` is subject to this. `audit-protocol.md` and the `references/`
 * files are read as references and never substituted, which is exactly why §1
 * can quote the token while explaining it.
 */
export function checkArgumentBinding(
  relPath: string,
  content: string,
  problems: Problem[]
): void {
  let canonical = 0;
  // The frontmatter is a declaration, never the place a skill reasons about its
  // arguments.
  const firstBodyLine = bodyStart(content);

  content.split('\n').forEach((line, index) => {
    if (!line.includes('$ARGUMENTS')) return;

    if (index >= firstBodyLine && line.trim() === ARGUMENT_BINDING) {
      canonical++;
      if (canonical > 1) {
        problems.push({
          file: relPath,
          line: index + 1,
          message:
            `a second \`${ARGUMENT_BINDING}\` line. One binding is where the ` +
            'value lands; a second is a second copy of it, and nothing says ' +
            'which one the skill reasons about.',
        });
      }
      return;
    }

    problems.push({
      file: relPath,
      line: index + 1,
      message:
        '`$ARGUMENTS` outside the binding line. Claude Code substitutes every ' +
        'occurrence, so the invocation is rendered into this sentence and the ' +
        `placeholder is consumed. Bind it alone on \`${ARGUMENT_BINDING}\` and ` +
        'reason about the bound value.',
    });
  });

  if (canonical === 0) {
    problems.push({
      file: relPath,
      line: firstBodyLine + 1,
      message:
        `no \`${ARGUMENT_BINDING}\` line in the body. Every skill carries one, ` +
        'so the invocation has exactly one place to land and no sentence has to ' +
        'spell the placeholder. A skill that takes no arguments carries it too ' +
        'and is handed an empty value. See audit-protocol.md §1 step 1.',
    });
  }
}

function main(): void {
  const files = skillFiles();
  if (files.length === 0) {
    throw new Error(
      '[skill-integrity] no .md file found below .claude/skills/. Skills are ' +
        'version-controlled: if this directory is empty, either the path ' +
        'changed or something deleted them. This is not a success.'
    );
  }

  const problems: Problem[] = [];
  let pathRefs = 0;
  let symbolRefs = 0;
  let contracts = 0;

  for (const file of files) {
    const relPath = relative(REPO_ROOT, file);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Only SKILL.md carries an execution contract. `audit-protocol.md` quotes
    // the read-only marker while documenting it, and is not a skill.
    if (basename(file) === 'SKILL.md') {
      contracts++;
      checkExecutionContract(relPath, content, problems);
      checkArgumentBinding(relPath, content, problems);
    }

    // Capability constraint: an Explore agent has no Agent tool and therefore
    // cannot invoke subagents. See audit-protocol.md section 6.
    const declaresExplore = /^agent:\s*Explore\s*$/m.test(content);
    if (declaresExplore) {
      const forbidden = [
        /agents? in parallel/i,
        /^###\s+Agent \d/m,
        /\bTask\(/,
        /\bAgent tool\b/,
      ];
      for (const pattern of forbidden) {
        const match = content.match(pattern);
        if (match) {
          problems.push({
            file: relPath,
            line: content.slice(0, match.index).split('\n').length,
            message:
              `declares \`agent: Explore\` but contains "${match[0].trim()}". ` +
              'An Explore agent has no Agent tool: this is a promise the ' +
              'runtime cannot keep. See audit-protocol.md section 6.',
          });
        }
      }
    }

    lines.forEach((line, index) => {
      if (line.includes(IGNORE_MARKER)) return;

      for (const [, token] of line.matchAll(/`([^`\n]+)`/g)) {
        if (isRepoPath(token)) {
          pathRefs++;
          if (!pathResolves(token, dirname(file))) {
            problems.push({
              file: relPath,
              line: index + 1,
              message: `path \`${token}\` does not exist.`,
            });
          }
        } else if (isSymbolRef(token)) {
          symbolRefs++;
          const name = token.slice(0, -2);
          if (!symbolExists(name)) {
            problems.push({
              file: relPath,
              line: index + 1,
              message: `\`${token}\` does not exist in apps/ or packages/.`,
            });
          }
        }
      }
    });
  }

  // Zero-discovery guard: an accidentally narrow heuristic must not turn the
  // script into a permanently green no-op. This is the same lesson as the
  // empty memoized table list in `apps/api/test/helpers/database.ts`.
  if (pathRefs === 0 && symbolRefs === 0) {
    throw new Error(
      `[skill-integrity] zero references extracted from ${files.length} files. ` +
        'The heuristic no longer matches anything: the check would pass ' +
        'without verifying anything.'
    );
  }

  // Same zero-discovery guard, for the execution contract. If the SKILL.md
  // naming convention ever changes, this check must go red rather than
  // silently vouch for zero skills.
  if (contracts === 0) {
    throw new Error(
      `[skill-integrity] no SKILL.md among ${files.length} skill files. ` +
        'The execution contract (fork/background/agent and write tools) would ' +
        'not be verified for any skill.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `[skill-integrity] ${problems.length} broken references in skills:\n` +
        `${formatProblems(problems)}\n\n` +
        `Fix the skill, or mark the line with ${IGNORE_MARKER} when the ` +
        'reference to something removed is deliberate. The marker does not ' +
        'apply to the `$ARGUMENTS` binding: substitution still happens there, ' +
        'so the line must be fixed.'
    );
  }

  console.log(
    `[skill-integrity] ok — ${files.length} skills, ${pathRefs} paths, ` +
      `${symbolRefs} symbols, and ${contracts} execution contracts verified.`
  );
}

// Runs the real check only as the CLI entrypoint. Without this the fixture
// suite would execute `main()` against the live repository on import, so an
// unrelated broken skill would fail these tests for the wrong reason — the
// failure mode `luke-test` SKILL.md §3.3 names. Same guard as
// `check-platform-integrity.ts`.
if (require.main === module) {
  main();
}
