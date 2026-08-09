/**
 * Verifica marker e link della documentazione.
 *
 * ## Perché esiste
 *
 * `/luke-docs` faceva questi due controlli come "Phase 3 — Verifica cross-link",
 * cioè affidava a un LLM del parsing puro. È un controllo di livello 4 dove ne
 * basta uno di livello 2: gratuito, ripetibile, e in CI su ogni push. La Phase 3
 * è stata cancellata dalla skill in cambio di questo file.
 *
 * ## Cosa controlla
 *
 * 1. **Integrità dei marker** `luke-docs:start` / `luke-docs:end`: appaiati,
 *    non annidati, non orfani. Un marker sbilanciato fa sì che la rigenerazione
 *    successiva sovrascriva contenuto scritto a mano.
 * 2. **Link relativi**: ogni link markdown a un path relativo risolve su disco.
 *
 * ## Nessuna lista di eccezioni
 *
 * Un link rotto va riparato o cancellato. Se qui comparisse una allow-list, il
 * checker diventerebbe arredamento — lo stesso motivo per cui la baseline delle
 * skill di audit richiede un motivo scritto per ogni voce.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

import { isGitIgnored } from './lib/gitPaths';
import { formatProblems, REPO_ROOT, type Problem } from './lib/report';

/**
 * I markdown **tracciati da git**.
 *
 * Non una scansione del filesystem: `docs/access-porting/` e
 * `docs/merchandising-reference/` sono gitignored, e materiale escluso dal repo
 * non è documentazione del repo. Delegare a git significa anche che la
 * definizione resta una sola, in `.gitignore`, invece di una lista di SKIP_DIRS
 * da tenere in sync a mano.
 *
 * `.claude/skills/` è escluso perché ha il proprio checker, con regole diverse.
 */
function trackedMarkdown(): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '*.md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .filter(Boolean)
    .filter(path => !path.startsWith('.claude/'))
    .map(path => join(REPO_ROOT, path))
    .sort();
}

/**
 * Forma reale del marker: commento HTML **nominato**,
 * `<!-- luke-docs:start:overview -->` / `<!-- luke-docs:end:overview -->`.
 *
 * Il match è sulla forma completa, non sulla sottostringa `luke-docs:start`:
 * altrimenti una riga di prosa che *cita* i marker (come questa, o come §6 di
 * `docs/quality-hardening-plan.md`) verrebbe letta come un blocco aperto. Il
 * nome serve ad appaiare i blocchi, non solo a contarli.
 */
const MARKER_RE = /<!--\s*luke-docs:(start|end):([\w-]+)\s*-->/g;

/** Marker appaiati, non annidati, non orfani. */
function checkMarkers(
  file: string,
  lines: string[],
  problems: Problem[]
): number {
  /** Nome del blocco → riga di apertura ancora da chiudere. */
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
            message: `blocco \`${name}\` riaperto: quello di riga ${previous} non è chiuso.`,
          });
        } else {
          open.set(name, lineNumber);
        }
      } else if (!open.delete(name)) {
        problems.push({
          file,
          line: lineNumber,
          message: `\`luke-docs:end:${name}\` orfano: nessuna apertura corrispondente.`,
        });
      }
    }
  });

  for (const [name, lineNumber] of open) {
    problems.push({
      file,
      line: lineNumber,
      message:
        `blocco \`${name}\` mai chiuso. Una rigenerazione sovrascriverebbe ` +
        'tutto ciò che segue.',
    });
  }

  return seen;
}

/** Ogni link markdown relativo deve risolvere. */
function checkLinks(
  absoluteFile: string,
  relPath: string,
  lines: string[],
  problems: Problem[]
): number {
  let checked = 0;
  const baseDir = dirname(absoluteFile);

  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];

      // Fuori scope: URL assoluti, mailto, ancore pure, template.
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      if (/[<>*${}]/.test(target)) continue;

      // Un'ancora si verifica solo per la parte di path.
      const [pathPart] = target.split('#');
      if (!pathPart) continue;

      checked++;
      const absolute = resolve(baseDir, pathPart);

      // `docs/merchandising-reference/` e `docs/access-porting/` sono
      // gitignored: i link a quelle directory risolvono sul disco di chi lavora
      // e non in un checkout pulito. La stessa regola che sceglie *quali file*
      // leggere (`git ls-files`) vale sui *target*, altrimenti è applicata a
      // metà — ed è così che questo controllo è passato in locale ed è fallito
      // in CI. Vedi `lib/gitPaths.ts`.
      if (!existsSync(absolute) && !isGitIgnored(absolute)) {
        problems.push({
          file: relPath,
          line: index + 1,
          message: `il link \`${target}\` non risolve.`,
        });
      }
    }
  });

  return checked;
}

function main(): void {
  const files = trackedMarkdown();

  if (files.length === 0) {
    throw new Error(
      '[docs-integrity] `git ls-files "*.md"` non restituisce nulla. O non ' +
        'siamo in un repo git, o i markdown non sono tracciati: il controllo ' +
        'passerebbe senza aver letto nulla.'
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

  // Guardia zero-discovery: un'espressione regolare troppo stretta renderebbe
  // questo script un no-op verde permanente, e nessuno se ne accorgerebbe.
  if (linksChecked === 0) {
    throw new Error(
      `[docs-integrity] zero link estratti da ${files.length} file markdown. ` +
        'Il pattern non matcha più nulla.'
    );
  }
  if (markersSeen === 0) {
    throw new Error(
      '[docs-integrity] nessun marker `luke-docs:` trovato. I README generati ne ' +
        'contengono: se sono spariti tutti, o la sintassi è cambiata o la ' +
        'generazione li ha persi. In entrambi i casi il controllo sui marker ' +
        'sarebbe verde senza verificare nulla.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `[docs-integrity] ${problems.length} problemi:\n${formatProblems(problems)}\n\n` +
        'Ripara il link o cancellalo. Non aggiungere eccezioni.'
    );
  }

  console.log(
    `[docs-integrity] ok — ${files.length} file, ${linksChecked} link e ` +
      `${markersSeen} marker verificati.`
  );
}

main();
