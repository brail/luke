/**
 * Cosa il repo può affermare, e cosa no.
 *
 * Uno script di verifica deve pronunciarsi solo su ciò che il repo contiene. Un
 * path escluso da `.gitignore` esiste sul disco di chi lavora e non in un
 * checkout pulito: verificarlo fa passare il controllo in locale e fallire in
 * CI — cioè legge il mondo sbagliato.
 *
 * Vive qui e non dentro un singolo checker perché è già successo di applicarla a
 * metà: `check-docs-integrity.ts` la usava per scegliere *quali file leggere*
 * (`git ls-files`), `check-skill-integrity.ts` non la usava affatto, e quando è
 * stata aggiunta al secondo il primo continuava a verificare *link target*
 * ignorati. Due CI rosse per la stessa causa. Una regola condivisa fra due
 * script deve stare in un posto solo.
 */

import { execFileSync } from 'child_process';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

function checkIgnore(path: string): boolean {
  try {
    // exit 0 = ignorato, 1 = non ignorato, >1 = errore (trattato come non ignorato)
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
 * `true` se git esclude il path.
 *
 * Prova anche la forma con slash finale. Un pattern directory-only in
 * `.gitignore` (`docs/access-porting/`) matcha solo se git può stabilire che il
 * path è una directory: quando il path **non esiste** — cioè esattamente il caso
 * del checkout pulito che qui interessa — non può, e serve dirglielo con lo
 * slash. Misurato su questo repo:
 *
 *   docs/access-porting    → exit 1, non matcha
 *   docs/access-porting/   → exit 0, matcha
 *
 * `path.resolve()` strippa lo slash finale, quindi senza questo tentativo il
 * controllo tornava `false` e segnalava come rotto un link a una directory
 * deliberatamente esclusa.
 *
 * @param path - Relativo alla root del repo, o assoluto al suo interno.
 */
export function isGitIgnored(path: string): boolean {
  if (checkIgnore(path)) return true;
  return path.endsWith('/') ? false : checkIgnore(`${path}/`);
}
