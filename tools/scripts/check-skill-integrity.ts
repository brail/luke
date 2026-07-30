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
import { dirname, join, relative } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const SKILLS_DIR = join(REPO_ROOT, '.claude', 'skills');
const IGNORE_MARKER = '<!-- skill-check-ignore -->';

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

interface Problem {
  file: string;
  line: number;
  message: string;
}

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
 * `apps/*​/next.config.*` non sono affermazioni su file esistenti.
 */
function isRepoPath(token: string): boolean {
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
function isSymbolRef(token: string): boolean {
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
  'apps/api',
  'apps/web',
  'apps/web/src',
  'packages/core',
  'packages/nav',
  'packages/calendar',
];

function pathResolves(token: string, skillDir: string): boolean {
  if (existsSync(join(skillDir, token))) return true;
  return PATH_ROOTS.some(root => existsSync(join(REPO_ROOT, root, token)));
}

/**
 * Il simbolo esiste da qualche parte in apps/ o packages/.
 *
 * Cerca l'**esistenza**, non l'export: una skill può citare legittimamente una
 * funzione module-local (`assertEnvPolicy()` in `server.ts` non è esportata, ma
 * l'affermazione della skill su di essa è vera). Ciò che va intercettato è il
 * riferimento a qualcosa che non esiste più.
 */
function symbolExists(name: string): boolean {
  const pattern = `(function|const|class|type|interface) ${name}\\b`;
  try {
    execFileSync(
      'grep',
      ['-rEq', '--include=*.ts', '--include=*.tsx', pattern, 'apps', 'packages'],
      { cwd: REPO_ROOT, stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
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

  for (const file of files) {
    const relPath = relative(REPO_ROOT, file);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

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

  if (problems.length > 0) {
    const detail = problems
      .map(p => `  ${p.file}:${p.line} — ${p.message}`)
      .join('\n');
    throw new Error(
      `[skill-integrity] ${problems.length} riferimenti rotti nelle skill:\n${detail}\n\n` +
        `Ripara la skill, oppure marca la riga con ${IGNORE_MARKER} se il ` +
        'riferimento a qualcosa di rimosso è deliberato.'
    );
  }

  console.log(
    `[skill-integrity] ok — ${files.length} skill, ${pathRefs} path e ` +
      `${symbolRefs} simboli verificati.`
  );
}

main();
