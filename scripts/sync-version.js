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

// Pacchetti nel monorepo che devono essere sincronizzati
const PACKAGES = [
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/core/package.json',
  'packages/nav/package.json',
  'packages/eslint-plugin-luke/package.json',
];

const checkOnly = process.argv.includes('--check');

try {
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
  const version = gitTag.replace(/^v/, '');
  console.log(`📌 Versione dal tag: ${gitTag} → ${version}`);

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
