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
 * 3. **Completezza dell'indice ADR**: ogni ADR tracciato compare esattamente una
 *    volta in `docs/decisions/README.md`, ogni voce dell'indice punta a un ADR
 *    esistente, e nessun numero è duplicato.
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

/**
 * Completezza dell'indice ADR.
 *
 * Gli ADR 013 e 014 esistevano, erano Accepted, e l'indice generato si fermava
 * al 012: la manutenzione era stata rimandata, e nulla la reclamava. Questo
 * controllo impedisce che una manutenzione differita diventi drift permanente.
 *
 * Cosa **non** fa: non è il canale di scoperta degli ADR. `luke-audit` legge i
 * file tracciati sotto `docs/decisions/` direttamente, proprio perché l'indice
 * non è prova di esistenza — un ADR fuori dall'indice resta visibile all'audit
 * architetturale. Qui si garantisce che l'indice **umano** resti completo e
 * coerente con il corpus tracciato: ogni ADR rappresentato esattamente una
 * volta, ogni voce che risolve a un ADR reale.
 *
 * Deliberatamente **non** verifica lo `Status`: il repo usa due formati di
 * header (`## Status` e `**Status**:`), e lo stato di un ADR è comunque un
 * fatto semantico sotto decisione umana. Qui si controlla solo ciò che è
 * strutturale e non ambiguo.
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
          `ci sono ${adrFiles.length} ADR nel working tree ma l'indice ` +
          "non c'è. Finché è così la completezza dell'indice non è " +
          'verificabile: annulla la sola cancellazione del file, senza ' +
          'sovrascrivere le modifiche già presenti, oppure metti in stage la ' +
          'rimozione deliberata insieme alla disposizione degli ADR che ' +
          'indicizzava.',
      });
    }
    return 0;
  }

  const index = readFileSync(absoluteIndex, 'utf8');
  const linked = [...index.matchAll(/\|\s*\[(\d+)\]\(([^)]+)\)/g)];

  // Numero -> file, dai file tracciati.
  const byNumber = new Map<string, string>();
  for (const name of adrFiles) {
    const number = name.split('-')[0];
    const existing = byNumber.get(number);
    if (existing !== undefined) {
      problems.push({
        file: 'docs/decisions/',
        line: 1,
        message:
          `numero ADR duplicato \`${number}\`: \`${existing}\` e \`${name}\`. ` +
          'Il numero è il modo in cui una decisione viene citata: due file che ' +
          'lo condividono rendono ambiguo ogni riferimento.',
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
          `l'ADR \`${name}\` non compare nell'indice. L'audit lo vede comunque ` +
          '(legge i file, non l\'indice), ma l\'indice umano è incompleto.',
      });
    }
  }

  for (const [, number, target] of linked) {
    if (!byNumber.has(number)) {
      problems.push({
        file: indexPath,
        line: 1,
        message:
          `la voce \`${number}\` dell'indice punta a \`${target}\`, che non è ` +
          'un ADR del corpus: o non è tracciato, o è stato cancellato dal ' +
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
      '[docs-integrity] nessun markdown tracciato e presente nel working tree. ' +
        'O non siamo in un repo git, o i markdown non sono tracciati, o sono ' +
        'stati tutti cancellati: il controllo passerebbe senza aver letto nulla.'
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

  const adrsChecked = checkAdrIndex(REPO_ROOT, problems);

  // Stessa guardia zero-discovery del resto del file: se la scoperta degli ADR
  // smette di trovarli, il controllo di completezza passerebbe senza aver
  // verificato nulla.
  if (adrsChecked === 0 && existsSync(join(REPO_ROOT, 'docs/decisions/README.md'))) {
    throw new Error(
      '[docs-integrity] indice ADR presente ma nessun ADR tracciato e presente ' +
        'nel working tree. La completezza dell\'indice sarebbe verde senza aver ' +
        'confrontato nulla.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `[docs-integrity] ${problems.length} problemi:\n${formatProblems(problems)}\n\n` +
        'Ripara il link o cancellalo. Non aggiungere eccezioni.'
    );
  }

  console.log(
    `[docs-integrity] ok — ${files.length} file, ${linksChecked} link, ` +
      `${markersSeen} marker e ${adrsChecked} ADR indicizzati verificati.`
  );
}

main();
