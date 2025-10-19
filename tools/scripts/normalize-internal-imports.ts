#!/usr/bin/env tsx

/**
 * Script per normalizzare i path import interni
 * Converte path relativi profondi in alias workspace (@luke/*, @/*)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative, dirname } from 'path';

interface ImportReplacement {
  file: string;
  line: number;
  oldImport: string;
  newImport: string;
  type: 'relative-to-alias' | 'deep-relative-to-shallow';
}

function isInternalImport(importPath: string): boolean {
  return (
    importPath.startsWith('@luke/') ||
    importPath.startsWith('@/') ||
    importPath.startsWith('./') ||
    importPath.startsWith('../')
  );
}

function shouldNormalize(importPath: string, currentFile: string): boolean {
  // Non normalizzare se già usa alias
  if (importPath.startsWith('@luke/') || importPath.startsWith('@/')) {
    return false;
  }

  // Normalizzare path relativi profondi (più di 2 livelli)
  if (importPath.startsWith('../')) {
    const levels = (importPath.match(/\.\.\//g) || []).length;
    return levels > 2;
  }

  return false;
}

function normalizeImport(
  importPath: string,
  currentFile: string
): string | null {
  if (!shouldNormalize(importPath, currentFile)) {
    return null;
  }

  // Calcola il path assoluto dell'import
  const currentDir = dirname(currentFile);
  const absoluteImportPath = join(currentDir, importPath);

  // Mappa ai workspace alias
  if (absoluteImportPath.includes('packages/core/src')) {
    const relativeToCore = relative(
      join(process.cwd(), 'packages/core/src'),
      absoluteImportPath
    );
    if (relativeToCore === 'index.ts' || relativeToCore === 'index') {
      return '@luke/core';
    }
    return `@luke/core/${relativeToCore.replace(/\.ts$/, '')}`;
  }

  if (absoluteImportPath.includes('apps/web/src')) {
    const relativeToWeb = relative(
      join(process.cwd(), 'apps/web/src'),
      absoluteImportPath
    );
    return `@/${relativeToWeb.replace(/\.tsx?$/, '')}`;
  }

  if (absoluteImportPath.includes('apps/api/src')) {
    const relativeToApi = relative(
      join(process.cwd(), 'apps/api/src'),
      absoluteImportPath
    );
    return `@/${relativeToApi.replace(/\.ts$/, '')}`;
  }

  return null;
}

function processFile(filePath: string): ImportReplacement[] {
  const replacements: ImportReplacement[] = [];

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Cerca import statements
      const importMatch = line.match(
        /import\s+.*\s+from\s+['"`]([^'"`]+)['"`]/
      );
      if (importMatch) {
        const importPath = importMatch[1];

        if (isInternalImport(importPath)) {
          const normalized = normalizeImport(importPath, filePath);
          if (normalized) {
            replacements.push({
              file: filePath,
              line: lineNum,
              oldImport: importPath,
              newImport: normalized,
              type: 'relative-to-alias',
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Errore processando file ${filePath}:`, error);
  }

  return replacements;
}

function applyReplacements(replacements: ImportReplacement[]): number {
  let applied = 0;

  for (const replacement of replacements) {
    try {
      const content = readFileSync(replacement.file, 'utf8');
      const lines = content.split('\n');

      // Trova la linea da sostituire
      const lineIndex = replacement.line - 1;
      if (lineIndex < lines.length) {
        const oldLine = lines[lineIndex];
        const newLine = oldLine.replace(
          new RegExp(
            `(['"\`])${replacement.oldImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['"\`])`
          ),
          `$1${replacement.newImport}$2`
        );

        if (newLine !== oldLine) {
          lines[lineIndex] = newLine;
          writeFileSync(replacement.file, lines.join('\n'));
          applied++;
          console.log(
            `✅ Sostituito in ${replacement.file}:${replacement.line} - ${replacement.oldImport} → ${replacement.newImport}`
          );
        }
      }
    } catch (error) {
      console.error(
        `❌ Errore applicando sostituzione in ${replacement.file}:`,
        error
      );
    }
  }

  return applied;
}

function scanDirectory(dirPath: string): ImportReplacement[] {
  const replacements: ImportReplacement[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        replacements.push(...scanDirectory(fullPath));
      } else if (
        stat.isFile() &&
        (extname(fullPath) === '.ts' || extname(fullPath) === '.tsx')
      ) {
        replacements.push(...processFile(fullPath));
      }
    }
  } catch (error) {
    console.error(`❌ Errore scandendo directory ${dirPath}:`, error);
  }

  return replacements;
}

function main() {
  console.log('🔍 Normalizzazione path import interni...');

  const sourceDirs = [
    join(process.cwd(), 'apps/api/src'),
    join(process.cwd(), 'apps/web/src'),
    join(process.cwd(), 'packages/core/src'),
  ];

  let allReplacements: ImportReplacement[] = [];

  for (const dir of sourceDirs) {
    console.log(`📁 Scansionando ${dir}...`);
    allReplacements.push(...scanDirectory(dir));
  }

  if (allReplacements.length === 0) {
    console.log('✅ Nessun import da normalizzare trovato!');
    return;
  }

  console.log(`\n📋 Trovati ${allReplacements.length} import da normalizzare:`);

  for (const replacement of allReplacements) {
    const relativePath = replacement.file.replace(process.cwd(), '');
    console.log(
      `  ${relativePath}:${replacement.line} - ${replacement.oldImport} → ${replacement.newImport}`
    );
  }

  console.log('\n🔧 Applicando sostituzioni...');
  const applied = applyReplacements(allReplacements);

  console.log(
    `\n✅ Applicate ${applied} sostituzioni su ${allReplacements.length} trovate`
  );

  // Genera report
  const report = {
    timestamp: new Date().toISOString(),
    totalReplacements: allReplacements.length,
    appliedReplacements: applied,
    replacements: allReplacements.map(r => ({
      file: r.file.replace(process.cwd(), ''),
      line: r.line,
      oldImport: r.oldImport,
      newImport: r.newImport,
      type: r.type,
    })),
  };

  const reportPath = join(
    process.cwd(),
    'tools/reports/import-normalization-report.json'
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report salvato in ${reportPath}`);
}

main();
