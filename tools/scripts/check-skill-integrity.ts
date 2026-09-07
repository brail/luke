/**
 * Verifica che le skill in `.claude/skills/` non siano driftate dalla codebase.
 *
 * ## Perché esiste
 *
 * `luke-test/SKILL.md` ha istruito per mesi ad aggiungere ogni nuova spec a
 * `test/integration-specs.ts` — un file eliminato — e a usare `hasTestDatabase()`,
 * una funzione rimossa proprio perché il pattern che abilitava faceva riportare
 * verde il job con zero test eseguiti. Una skill che insegna una struttura che non
 * esiste più è peggio di nessuna skill: il prossimo run scrive nel posto sbagliato
 * con l'helper cancellato.
 *
 * Le skill sono prose, e la prosa resta un controllo di livello 4. Ma i **fatti
 * verificabili** che affermano — path, simboli, capacità dell'agente — possono
 * salire a livello 2. È ciò che fa questo script.
 *
 * ## Uscite volute
 *
 * Un riferimento a qualcosa di rimosso può essere deliberato: le skill spiegano
 * anche cosa NON fare più, e citarlo è il punto. Quelle righe si marcano con
 * `<!-- skill-check-ignore -->`. Se ti ritrovi ad aggiungerne molti, il problema
 * è l'euristica o la skill — non aggiungere marker a raffica, o il checker
 * diventa arredamento.
 */

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';

import { isGitIgnored } from './lib/gitPaths';
import { formatProblems, REPO_ROOT, type Problem } from './lib/report';

const SKILLS_DIR = join(REPO_ROOT, '.claude', 'skills');
export const IGNORE_MARKER = '<!-- skill-check-ignore -->';

/** Directory di primo livello che rendono un token "path del repo". */
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

/** Estensioni che rendono un token un file, ovunque si trovi. */
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

/** Tutti i file markdown delle skill. */
function skillFiles(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(entry.parentPath ?? SKILLS_DIR, entry.name))
    .sort();
}

/**
 * Un token è un path del repo se contiene `/` e o sta sotto una directory nota
 * o ha un'estensione di file. Placeholder e glob restano fuori: `<nome>.yml`,
 * `apps/<app>/next.config.*` non sono affermazioni su file esistenti.
 */
export function isRepoPath(token: string): boolean {
  if (!token.includes('/')) return false;
  if (/[<>*$\s()]/.test(token)) return false;
  if (token.startsWith('http')) return false;
  if (token.startsWith('@')) return false; // package npm, non un path
  return (
    REPO_TOP_DIRS.some(dir => token.startsWith(dir)) ||
    FILE_EXTENSIONS.some(ext => token.endsWith(ext))
  );
}

/** Un token è un riferimento a simbolo se ha la forma `identificatore()`. */
export function isSymbolRef(token: string): boolean {
  return /^[a-zA-Z_$][\w$]*\(\)$/.test(token);
}

/**
 * Frame di riferimento in cui un path citato da una skill può essere espresso.
 *
 * Le skill parlano di path in prospettive diverse: `references/adr-rules.md` è
 * relativo alla skill, `apps/api/test/helpers.ts` alla root, `test/helpers.ts` a
 * `apps/api`, `lib/debug.ts` a `apps/web/src`. Provarli tutti è meno fragile che
 * pretendere una convenzione unica in un file di prosa.
 */
const PATH_ROOTS = [
  '',
  // Le radici dei package non si elencano a mano: la lista precedente ometteva
  // `packages/eslint-plugin-luke`, quindi ogni path citato rispetto a quel
  // package veniva riportato come rotto — un falso positivo in un controllo che
  // blocca la CI, cioè la pressione esatta che fa proliferare i marker di
  // ignore. Come per `trackedMarkdown()`, il mondo lo dichiara git.
  ...execFileSync('git', ['ls-files', '*/package.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map(p => dirname(p)),
  // Non è la radice di un package, ma è un frame che le skill usano davvero
  // (`lib/debug.ts` è relativo a qui).
  'apps/web/src',
];

function pathResolves(token: string, skillDir: string): boolean {
  if (existsSync(join(skillDir, token))) return true;
  if (PATH_ROOTS.some(root => existsSync(join(REPO_ROOT, root, token)))) {
    return true;
  }
  // Non trovato. Se git lo esclude — `.planning/ROADMAP.md`, citato da
  // `luke-docs` — il repo non può pronunciarsi: esiste sul disco di chi lavora
  // e non in un checkout pulito. Vedi `lib/gitPaths.ts`.
  return isGitIgnored(token);
}

/**
 * Il simbolo esiste da qualche parte in apps/ o packages/.
 *
 * Cerca l'**esistenza**, non l'export: una skill può citare legittimamente una
 * funzione module-local (`assertEnvPolicy()` in `server.ts` non è esportata, ma
 * l'affermazione della skill su di essa è vera). Ciò che va intercettato è il
 * riferimento a qualcosa che non esiste più.
 */
let declaredSymbols: Set<string> | null = null;

function symbolExists(name: string): boolean {
  // Una passata sola sul corpus, non una per simbolo. La versione precedente
  // lanciava un `grep -q` ricorsivo su apps/ e packages/ per ogni token citato,
  // duplicati inclusi: ~5s degli ~5,7s totali dello script, e il costo cresceva
  // linearmente con le skill. Estrarre tutte le dichiarazioni in un colpo costa
  // ~70ms e riduce i controlli successivi a lookup su Set.
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

    // Stessa guardia zero-discovery del resto del file: un corpus vuoto vuol
    // dire che il grep non matcha più, non che i simboli non esistono. Senza
    // questa riga ogni riferimento risulterebbe rotto in blocco.
    if (declaredSymbols.size === 0) {
      throw new Error(
        '[skill-integrity] nessuna dichiarazione estratta da apps/ e packages/. ' +
          'Il pattern non matcha più nulla: proseguire segnalerebbe come rotto ' +
          'ogni simbolo citato dalle skill.'
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
      '[skill-integrity] nessun file .md sotto .claude/skills/. Le skill sono ' +
        'versionate: se questa directory è vuota, o il path è cambiato o ' +
        'qualcosa le ha cancellate. Non è un successo.'
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

    // Vincolo di capacità: un agente Explore non ha il tool Agent, quindi non
    // può invocare subagenti. Vedi audit-protocol.md §6.
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
              `dichiara \`agent: Explore\` ma contiene "${match[0].trim()}". ` +
              'Un agente Explore non ha il tool Agent: è una promessa che il ' +
              'runtime non può mantenere. Vedi audit-protocol.md §6.',
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
              message: `il path \`${token}\` non esiste.`,
            });
          }
        } else if (isSymbolRef(token)) {
          symbolRefs++;
          const name = token.slice(0, -2);
          if (!symbolExists(name)) {
            problems.push({
              file: relPath,
              line: index + 1,
              message: `\`${token}\` non esiste in apps/ né packages/.`,
            });
          }
        }
      }
    });
  }

  // Guardia zero-discovery: un'euristica ristretta per sbaglio non deve
  // trasformare lo script in un no-op verde permanente. Stessa lezione della
  // lista di tabelle memoizzata vuota in `apps/api/test/helpers/database.ts`.
  if (pathRefs === 0 && symbolRefs === 0) {
    throw new Error(
      `[skill-integrity] zero riferimenti estratti da ${files.length} file. ` +
        "L'euristica non matcha più nulla: il controllo sarebbe verde senza " +
        'aver verificato niente.'
    );
  }

  // Same zero-discovery guard, for the execution contract. If the SKILL.md
  // naming convention ever changes, this check must go red rather than
  // silently vouch for zero skills.
  if (contracts === 0) {
    throw new Error(
      `[skill-integrity] nessun SKILL.md fra ${files.length} file di skill. ` +
        'Il contratto di esecuzione (fork/background/agent, tool di scrittura) ' +
        'non sarebbe verificato su nessuna skill.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `[skill-integrity] ${problems.length} riferimenti rotti nelle skill:\n` +
        `${formatProblems(problems)}\n\n` +
        `Ripara la skill, oppure marca la riga con ${IGNORE_MARKER} se il ` +
        'riferimento a qualcosa di rimosso è deliberato. Il marker non vale ' +
        'per il binding di `$ARGUMENTS`: lì la sostituzione avviene comunque, ' +
        'quindi la riga va corretta.'
    );
  }

  console.log(
    `[skill-integrity] ok — ${files.length} skill, ${pathRefs} path, ` +
      `${symbolRefs} simboli e ${contracts} contratti di esecuzione verificati.`
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
