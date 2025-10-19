#!/usr/bin/env tsx

/**
 * Script per validare i boundary client/server
 * Verifica che i file client non importino @luke/core/server o moduli node:
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

interface Violation {
  file: string;
  line: number;
  column: number;
  import: string;
  type: 'server-only' | 'node-module';
}

function isClientFile(filePath: string): boolean {
  // File client sono quelli in apps/web/src che non sono in server/ o api/
  return (
    filePath.includes('apps/web/src') &&
    !filePath.includes('/server/') &&
    !filePath.includes('/api/') &&
    !filePath.includes('middleware.ts') &&
    !filePath.includes('auth.ts')
  );
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Cerca import di @luke/core/server
      const serverImportMatch = line.match(
        /import.*from\s+['"`]@luke\/core\/server['"`]/
      );
      if (serverImportMatch) {
        violations.push({
          file: filePath,
          line: lineNum,
          column: line.indexOf('@luke/core/server'),
          import: '@luke/core/server',
          type: 'server-only',
        });
      }

      // Cerca import di moduli node:
      const nodeImportMatch = line.match(
        /import.*from\s+['"`]node:([^'"`]+)['"`]/
      );
      if (nodeImportMatch) {
        violations.push({
          file: filePath,
          line: lineNum,
          column: line.indexOf('node:'),
          import: `node:${nodeImportMatch[1]}`,
          type: 'node-module',
        });
      }
    }
  } catch (error) {
    console.error(`❌ Errore leggendo file ${filePath}:`, error);
  }

  return violations;
}

function scanDirectory(dirPath: string): Violation[] {
  const violations: Violation[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        violations.push(...scanDirectory(fullPath));
      } else if (
        stat.isFile() &&
        (extname(fullPath) === '.ts' || extname(fullPath) === '.tsx')
      ) {
        if (isClientFile(fullPath)) {
          violations.push(...scanFile(fullPath));
        }
      }
    }
  } catch (error) {
    console.error(`❌ Errore scandendo directory ${dirPath}:`, error);
  }

  return violations;
}

function main() {
  console.log('🔍 Validazione boundary client/server...');

  const webSrcPath = join(process.cwd(), 'apps/web/src');
  const violations = scanDirectory(webSrcPath);

  if (violations.length === 0) {
    console.log('✅ Nessuna violazione di boundary client/server trovata!');
    return;
  }

  console.log(`\n❌ Trovate ${violations.length} violazioni di boundary:`);

  const violationsByType = violations.reduce(
    (acc, violation) => {
      if (!acc[violation.type]) {
        acc[violation.type] = [];
      }
      acc[violation.type].push(violation);
      return acc;
    },
    {} as Record<string, Violation[]>
  );

  for (const [type, typeViolations] of Object.entries(violationsByType)) {
    console.log(
      `\n📋 ${type.toUpperCase()} (${typeViolations.length} violazioni):`
    );

    for (const violation of typeViolations) {
      const relativePath = violation.file.replace(process.cwd(), '');
      console.log(
        `  ${relativePath}:${violation.line}:${violation.column} - ${violation.import}`
      );
    }
  }

  // Genera report
  const report = {
    timestamp: new Date().toISOString(),
    totalViolations: violations.length,
    violationsByType: Object.keys(violationsByType).reduce(
      (acc, type) => {
        acc[type] = violationsByType[type].length;
        return acc;
      },
      {} as Record<string, number>
    ),
    violations: violations.map(v => ({
      file: v.file.replace(process.cwd(), ''),
      line: v.line,
      column: v.column,
      import: v.import,
      type: v.type,
    })),
  };

  const reportPath = join(
    process.cwd(),
    'tools/reports/client-server-boundary-violations.json'
  );
  require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report salvato in ${reportPath}`);

  process.exit(1);
}

main();
