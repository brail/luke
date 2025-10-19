#!/usr/bin/env tsx

/**
 * Script per rilevare e rimuovere import non utilizzati
 * Analizza l'output di TypeScript e rimuove import non utilizzati
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface UnusedImport {
  file: string;
  line: number;
  column: number;
  variable: string;
  type: 'variable' | 'parameter' | 'error';
}

function parseTypeScriptOutput(output: string): UnusedImport[] {
  const lines = output.split('\n');
  const unusedImports: UnusedImport[] = [];

  console.log('🔍 Analizzando output TypeScript...');
  console.log('Prime 10 righe:', lines.slice(0, 10));

  for (const line of lines) {
    // Pattern per errori TypeScript: file(line,col): error TS6133: 'var' is defined but never used
    const match = line.match(
      /(.+?)\((\d+),(\d+)\): error TS6133: '(.+?)' is declared but its value is never read/
    );
    if (match) {
      const [, file, lineNum, col, variable] = match;
      const cleanFile = file
        .replace(/^@luke\/api:typecheck: /, '')
        .replace(/^@luke\/api:build: /, '');
      unusedImports.push({
        file: cleanFile.trim(),
        line: parseInt(lineNum),
        column: parseInt(col),
        variable: variable.trim(),
        type: 'variable',
      });
      console.log(`📋 Trovato: ${cleanFile}:${lineNum}:${col} - ${variable}`);
    }

    // Pattern per parametri non utilizzati
    const paramMatch = line.match(
      /(.+?)\((\d+),(\d+)\): error TS6133: '(.+?)' is defined but never used\. Allowed unused args must match/
    );
    if (paramMatch) {
      const [, file, lineNum, col, variable] = paramMatch;
      const cleanFile = file
        .replace(/^@luke\/api:typecheck: /, '')
        .replace(/^@luke\/api:build: /, '');
      unusedImports.push({
        file: cleanFile.trim(),
        line: parseInt(lineNum),
        column: parseInt(col),
        variable: variable.trim(),
        type: 'parameter',
      });
      console.log(
        `📋 Trovato parametro: ${cleanFile}:${lineNum}:${col} - ${variable}`
      );
    }

    // Pattern per errori catch non utilizzati
    const errorMatch = line.match(
      /(.+?)\((\d+),(\d+)\): error TS6133: '(.+?)' is defined but never used\. Allowed unused caught errors must match/
    );
    if (errorMatch) {
      const [, file, lineNum, col, variable] = errorMatch;
      const cleanFile = file
        .replace(/^@luke\/api:typecheck: /, '')
        .replace(/^@luke\/api:build: /, '');
      unusedImports.push({
        file: cleanFile.trim(),
        line: parseInt(lineNum),
        column: parseInt(col),
        variable: variable.trim(),
        type: 'error',
      });
      console.log(
        `📋 Trovato errore: ${cleanFile}:${lineNum}:${col} - ${variable}`
      );
    }
  }

  return unusedImports;
}

function removeUnusedImport(
  filePath: string,
  unusedImport: UnusedImport
): boolean {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Trova la riga con l'import non utilizzato
    const targetLine = lines[unusedImport.line - 1];

    if (!targetLine) {
      console.warn(`Linea ${unusedImport.line} non trovata in ${filePath}`);
      return false;
    }

    // Verifica se è un import statement
    if (!targetLine.includes('import')) {
      console.warn(
        `Linea ${unusedImport.line} non è un import in ${filePath}: ${targetLine}`
      );
      return false;
    }

    // Rimuovi la variabile dall'import
    let newLine = targetLine;

    // Gestisci diversi tipi di import
    if (targetLine.includes('{')) {
      // Named import: import { a, b, c } from 'module'
      const importMatch = targetLine.match(
        /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/
      );
      if (importMatch) {
        const [, imports, module] = importMatch;
        const importList = imports.split(',').map(imp => imp.trim());
        const filteredImports = importList.filter(
          imp => imp !== unusedImport.variable
        );

        if (filteredImports.length === 0) {
          // Rimuovi l'intera riga se non ci sono più import
          lines[unusedImport.line - 1] = '';
        } else {
          // Aggiorna la riga con gli import rimanenti
          newLine = `import { ${filteredImports.join(', ')} } from '${module}';`;
          lines[unusedImport.line - 1] = newLine;
        }
      }
    } else if (targetLine.includes('import type')) {
      // Type import: import type { Type } from 'module'
      const typeImportMatch = targetLine.match(
        /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/
      );
      if (typeImportMatch) {
        const [, imports, module] = typeImportMatch;
        const importList = imports.split(',').map(imp => imp.trim());
        const filteredImports = importList.filter(
          imp => imp !== unusedImport.variable
        );

        if (filteredImports.length === 0) {
          lines[unusedImport.line - 1] = '';
        } else {
          newLine = `import type { ${filteredImports.join(', ')} } from '${module}';`;
          lines[unusedImport.line - 1] = newLine;
        }
      }
    } else {
      // Default import o import completo
      console.warn(
        `Tipo di import non supportato in ${filePath}: ${targetLine}`
      );
      return false;
    }

    // Scrivi il file aggiornato
    const newContent = lines.join('\n');
    writeFileSync(filePath, newContent, 'utf8');

    console.log(
      `✅ Rimosso import non utilizzato '${unusedImport.variable}' da ${filePath}:${unusedImport.line}`
    );
    return true;
  } catch (error) {
    console.error(`❌ Errore nel processare ${filePath}:`, error);
    return false;
  }
}

function main() {
  console.log('🔍 Rilevamento import non utilizzati...');

  try {
    // Esegui TypeScript check e cattura sia stdout che stderr
    let output = '';
    try {
      output = execSync('pnpm typecheck', {
        encoding: 'utf8',
        cwd: process.cwd(),
        stdio: 'pipe',
      });
    } catch (error: any) {
      // Cattura l'output anche se il comando fallisce
      output = error.stdout || error.stderr || '';
    }

    console.log('📊 Analisi output TypeScript...');
    const unusedImports = parseTypeScriptOutput(output);

    if (unusedImports.length === 0) {
      console.log('✅ Nessun import non utilizzato trovato!');
      return;
    }

    console.log(`📋 Trovati ${unusedImports.length} import non utilizzati:`);

    // Raggruppa per file
    const importsByFile = unusedImports.reduce(
      (acc, imp) => {
        if (!acc[imp.file]) acc[imp.file] = [];
        acc[imp.file].push(imp);
        return acc;
      },
      {} as Record<string, UnusedImport[]>
    );

    let totalRemoved = 0;

    for (const [filePath, imports] of Object.entries(importsByFile)) {
      console.log(`\n📁 Processando ${filePath}:`);

      // Costruisci il path completo
      const fullPath = join(process.cwd(), 'apps/api', filePath);

      for (const unusedImport of imports) {
        const removed = removeUnusedImport(fullPath, unusedImport);
        if (removed) totalRemoved++;
      }
    }

    console.log(
      `\n✅ Rimossi ${totalRemoved} import non utilizzati su ${unusedImports.length} totali`
    );

    // Genera report
    const report = {
      timestamp: new Date().toISOString(),
      totalFound: unusedImports.length,
      totalRemoved,
      files: Object.keys(importsByFile).length,
      details: importsByFile,
    };

    writeFileSync(
      join(process.cwd(), 'tools/reports/unused-imports-report.json'),
      JSON.stringify(report, null, 2)
    );

    console.log(
      '📄 Report salvato in tools/reports/unused-imports-report.json'
    );
  } catch (error) {
    console.error("❌ Errore durante l'esecuzione:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
