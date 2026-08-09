#!/usr/bin/env node

/**
 * Sincronizza le versioni nei package.json con il tag git corrente.
 *
 * Legge il tag git più vicino (es: v1.7.0-rc.1) e aggiorna tutti i package.json
 * nel monorepo con quella versione (senza il prefisso 'v').
 *
 * Usage: node scripts/sync-version.js [--check]
 *   --check: solo leggi, non modificare (exit 1 se out of sync)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Package.json da sincronizzare, **derivati dal workspace** e non elencati.
 *
 * Un elenco scritto a mano ha un fallimento asimmetrico: una voce di troppo si
 * nota subito (file non trovato), una voce *mancante* no. `packages/calendar` è
 * nato senza essere aggiunto qui ed è rimasto a `1.10.0-dev.0` mentre
 * `--check` riportava OK: il controllo era verde su un monorepo disallineato.
 *
 * Derivare l'elenco significa che un package nuovo è coperto dal momento in cui
 * esiste, senza che nessuno debba ricordarsene.
 */
function discoverPackages() {
  const root = path.join(__dirname, '..');
  const found = ['package.json']; // la root fa parte del monorepo

  for (const group of ['apps', 'packages']) {
    const dir = path.join(root, group);
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `${group}/${entry.name}/package.json`;
      if (fs.existsSync(path.join(root, rel))) found.push(rel);
    }
  }

  // Guardia zero-discovery: se la struttura cambia e il glob non trova più
  // nulla, questo script diventerebbe un no-op silenzioso — e con lui il gate
  // di allineamento in `.husky/pre-push`.
  if (found.length < 2) {
    throw new Error(
      `Trovato solo ${found.length} package.json sotto apps/ e packages/. ` +
        'La struttura del monorepo è cambiata: aggiorna discoverPackages().'
    );
  }

  return found.sort();
}

const PACKAGES = discoverPackages();

const checkOnly = process.argv.includes('--check');

/**
 * Versione da imporre, per il bump di release.
 *
 * Serve perché la modalità normale legge il tag **esistente**: al momento del
 * bump il tag nuovo non c'è ancora, quindi senza `--set` questo script non può
 * portare i package.json alla versione che stai per rilasciare — li lascerebbe
 * a quella precedente, e il guard in `.husky/pre-push` bloccherebbe il tag.
 *
 * Usage: node scripts/sync-version.js --set 1.11.0
 */
const setIndex = process.argv.indexOf('--set');
const explicitVersion =
  setIndex !== -1 ? process.argv[setIndex + 1]?.replace(/^v/, '') : undefined;

if (setIndex !== -1 && !explicitVersion) {
  console.error('❌ `--set` richiede una versione. Es: --set 1.11.0');
  process.exit(1);
}
if (explicitVersion && checkOnly) {
  console.error('❌ `--set` e `--check` sono incompatibili.');
  process.exit(1);
}

try {
  let version;

  if (explicitVersion) {
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(explicitVersion)) {
      console.error(
        `❌ "${explicitVersion}" non è una versione semver valida (X.Y.Z[-pre]).`
      );
      process.exit(1);
    }
    version = explicitVersion;
    console.log(`📌 Versione richiesta: ${version}`);
  } else {
    // Leggi il tag git più vicino
    let gitTag;
    try {
      gitTag = execSync('git describe --tags --abbrev=0', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'], // Ignora stderr
      }).trim();
    } catch {
      // Se non c'è tag, usa il nome del branch o un default
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
          encoding: 'utf-8',
        }).trim();
        gitTag = `v0.0.0-${branch}`;
      } catch {
        gitTag = 'v0.0.0-dev';
      }
    }

    // Estrai la versione (rimuovi il prefisso 'v')
    version = gitTag.replace(/^v/, '');
    console.log(`📌 Versione dal tag: ${gitTag} → ${version}`);
  }

  let hasChanges = false;

  // Aggiorna ogni package.json
  for (const pkgPath of PACKAGES) {
    const fullPath = path.join(__dirname, '..', pkgPath);

    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️  File non trovato: ${pkgPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const pkg = JSON.parse(content);

    if (pkg.version !== version) {
      hasChanges = true;

      if (checkOnly) {
        console.log(
          `❌ ${pkgPath}: ${pkg.version} → ${version} (out of sync)`
        );
      } else {
        pkg.version = version;
        fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log(`✅ ${pkgPath}: aggiornato a ${version}`);
      }
    } else {
      console.log(`✔️  ${pkgPath}: già sincronizzato (${version})`);
    }
  }

  if (checkOnly && hasChanges) {
    console.error('\n❌ Versioni out of sync! Esegui: pnpm sync-version');
    process.exit(1);
  }

  if (!hasChanges && !checkOnly) {
    console.log('\n✨ Tutte le versioni sono sincronizzate!');
  }
} catch (err) {
  console.error('❌ Errore:', err.message);
  process.exit(1);
}
