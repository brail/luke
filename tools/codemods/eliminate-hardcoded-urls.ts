#!/usr/bin/env tsx

/**
 * Codemod: Eliminate Hardcoded URLs
 *
 * Automatically migrates hardcoded URLs in frontend code to use centralized utilities.
 * Uses ts-morph to perform safe AST transformations.
 *
 * Usage:
 *   tsx tools/codemods/eliminate-hardcoded-urls.ts [--dry-run] [--file <path>]
 *
 * @version 0.1.0
 * @author Luke Team
 */

import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

interface CodemodOptions {
  dryRun: boolean;
  targetFile?: string;
  verbose: boolean;
}

interface TransformationResult {
  file: string;
  changes: Array<{
    type: 'replacement' | 'import';
    description: string;
    before: string;
    after: string;
    line?: number;
  }>;
  errors: string[];
}

class HardcodedUrlEliminator {
  private project: Project;
  private results: TransformationResult[] = [];

  constructor() {
    this.project = new Project({
      tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
    });
  }

  /**
   * Main execution method
   */
  async run(options: CodemodOptions): Promise<void> {
    console.log('🔧 Luke Codemod: Eliminate Hardcoded URLs');
    console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log('');

    const targetFiles = this.getTargetFiles(options.targetFile);

    if (targetFiles.length === 0) {
      console.log('❌ No target files found');
      return;
    }

    console.log(`📁 Found ${targetFiles.length} files to process:`);
    targetFiles.forEach(file => console.log(`   - ${file}`));
    console.log('');

    for (const filePath of targetFiles) {
      await this.processFile(filePath, options);
    }

    this.generateReport(options);
  }

  /**
   * Get list of target files to process
   */
  private getTargetFiles(specificFile?: string): string[] {
    if (specificFile) {
      return [path.resolve(specificFile)];
    }

    // Target files identified from analysis
    const targetFiles = [
      'apps/web/src/auth.ts',
      'apps/web/src/lib/trpc.tsx',
      'apps/web/src/lib/trpc-auth.ts',
      'apps/web/src/lib/api.ts',
      'apps/web/src/app/api/uploads/[...path]/route.ts',
      'apps/web/src/app/(app)/settings/mail/page.tsx',
    ];

    return targetFiles
      .map(file => path.resolve(file))
      .filter(file => fs.existsSync(file));
  }

  /**
   * Process a single file
   */
  private async processFile(
    filePath: string,
    options: CodemodOptions
  ): Promise<void> {
    const result: TransformationResult = {
      file: path.relative(process.cwd(), filePath),
      changes: [],
      errors: [],
    };

    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);

      // Apply transformations
      this.transformHardcodedUrls(sourceFile, result);
      this.addImports(sourceFile, result);

      if (!options.dryRun && result.changes.length > 0) {
        sourceFile.saveSync();
      }

      this.results.push(result);

      if (options.verbose || result.changes.length > 0) {
        console.log(`📝 ${result.file}: ${result.changes.length} changes`);
        result.changes.forEach(change => {
          console.log(`   ${change.type}: ${change.description}`);
        });
      }
    } catch (error) {
      result.errors.push(`Failed to process file: ${error}`);
      console.error(`❌ Error processing ${filePath}:`, error);
    }
  }

  /**
   * Transform hardcoded URLs to use utilities
   */
  private transformHardcodedUrls(
    sourceFile: SourceFile,
    result: TransformationResult
  ): void {
    // Pattern 1: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const envPattern = sourceFile.getDescendantsOfKind(
      SyntaxKind.BinaryExpression
    );

    envPattern.forEach(node => {
      if (this.isApiUrlFallbackPattern(node)) {
        const replacement = 'getApiBaseUrl()';
        const before = node.getText();

        result.changes.push({
          type: 'replacement',
          description: 'Replace API URL fallback with getApiBaseUrl()',
          before: before,
          after: replacement,
          line: node.getStartLineNumber(),
        });

        node.replaceWithText(replacement);
      }
    });

    // Pattern 2: Template literals with API URL construction
    const templateLiterals = sourceFile.getDescendantsOfKind(
      SyntaxKind.TemplateExpression
    );

    templateLiterals.forEach(node => {
      const text = node.getText();

      // Match: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/path`
      const apiUrlPattern =
        /\$\{process\.env\.NEXT_PUBLIC_API_URL\s*\|\|\s*['"`]http:\/\/localhost:3001['"`]\}\/(.+)/;
      const match = text.match(apiUrlPattern);

      if (match) {
        const path = match[1];
        const replacement = `buildApiUrl('/${path}')`;

        result.changes.push({
          type: 'replacement',
          description: `Replace template literal with buildApiUrl('/${path}')`,
          before: text,
          after: replacement,
          line: node.getStartLineNumber(),
        });

        node.replaceWithText(replacement);
      }
    });

    // Pattern 3: String literals with localhost URLs
    const stringLiterals = sourceFile.getDescendantsOfKind(
      SyntaxKind.StringLiteral
    );

    stringLiterals.forEach(node => {
      const text = node.getText();
      const value = text.slice(1, -1); // Remove quotes

      if (value.startsWith('http://localhost:3001')) {
        let replacement: string;
        let description: string;

        if (value.includes('/trpc/')) {
          const pathMatch = value.match(/\/trpc\/(.+)$/);
          if (pathMatch) {
            const procedure = pathMatch[1];
            replacement = `buildTrpcUrl('${procedure}')`;
            description = `Replace tRPC URL with buildTrpcUrl('${procedure}')`;
          } else {
            return; // Skip if pattern doesn't match
          }
        } else if (value.includes('/upload/brand-logo/')) {
          const brandMatch = value.match(/\/upload\/brand-logo\/(.+)$/);
          if (brandMatch) {
            const brandId = brandMatch[1];
            if (brandId === 'temp') {
              replacement = 'buildTempBrandLogoUploadUrl()';
              description =
                'Replace temp upload URL with buildTempBrandLogoUploadUrl()';
            } else {
              replacement = `buildBrandLogoUploadUrl('${brandId}')`;
              description = `Replace brand upload URL with buildBrandLogoUploadUrl('${brandId}')`;
            }
          } else {
            return; // Skip if pattern doesn't match
          }
        } else {
          // Generic API URL
          const pathMatch = value.match(/localhost:3001(.+)$/);
          if (pathMatch) {
            const path = pathMatch[1];
            replacement = `buildApiUrl('${path}')`;
            description = `Replace API URL with buildApiUrl('${path}')`;
          } else {
            return; // Skip if pattern doesn't match
          }
        }

        result.changes.push({
          type: 'replacement',
          description,
          before: text,
          after: replacement,
          line: node.getStartLineNumber(),
        });

        node.replaceWithText(replacement);
      }
    });
  }

  /**
   * Check if a binary expression is the API URL fallback pattern
   */
  private isApiUrlFallbackPattern(node: Node): boolean {
    if (!Node.isBinaryExpression(node)) return false;

    const text = node.getText();
    return (
      text.includes('process.env.NEXT_PUBLIC_API_URL') &&
      text.includes('http://localhost:3001')
    );
  }

  /**
   * Add necessary imports to the file
   */
  private addImports(
    sourceFile: SourceFile,
    result: TransformationResult
  ): void {
    const changes = result.changes;
    if (changes.length === 0) return;

    // Check what imports we need
    const needsGetApiBaseUrl = changes.some(c =>
      c.after.includes('getApiBaseUrl')
    );
    const needsBuildApiUrl = changes.some(c => c.after.includes('buildApiUrl'));
    const needsBuildTrpcUrl = changes.some(c =>
      c.after.includes('buildTrpcUrl')
    );
    const needsBuildBrandLogoUploadUrl = changes.some(c =>
      c.after.includes('buildBrandLogoUploadUrl')
    );
    const needsBuildTempBrandLogoUploadUrl = changes.some(c =>
      c.after.includes('buildTempBrandLogoUploadUrl')
    );

    if (
      !needsGetApiBaseUrl &&
      !needsBuildApiUrl &&
      !needsBuildTrpcUrl &&
      !needsBuildBrandLogoUploadUrl &&
      !needsBuildTempBrandLogoUploadUrl
    ) {
      return;
    }

    // Check if import already exists
    const existingImports = sourceFile.getImportDeclarations();
    const hasCoreImport = existingImports.some(imp =>
      imp.getModuleSpecifierValue().startsWith('@luke/core')
    );

    if (hasCoreImport) {
      // Add to existing import
      const coreImport = existingImports.find(imp =>
        imp.getModuleSpecifierValue().startsWith('@luke/core')
      );

      if (coreImport) {
        const namedImports = coreImport.getNamedImports();
        const existingNames = namedImports.map(imp => imp.getName());

        const newImports: string[] = [];
        if (needsGetApiBaseUrl && !existingNames.includes('getApiBaseUrl')) {
          newImports.push('getApiBaseUrl');
        }
        if (needsBuildApiUrl && !existingNames.includes('buildApiUrl')) {
          newImports.push('buildApiUrl');
        }
        if (needsBuildTrpcUrl && !existingNames.includes('buildTrpcUrl')) {
          newImports.push('buildTrpcUrl');
        }
        if (
          needsBuildBrandLogoUploadUrl &&
          !existingNames.includes('buildBrandLogoUploadUrl')
        ) {
          newImports.push('buildBrandLogoUploadUrl');
        }
        if (
          needsBuildTempBrandLogoUploadUrl &&
          !existingNames.includes('buildTempBrandLogoUploadUrl')
        ) {
          newImports.push('buildTempBrandLogoUploadUrl');
        }

        if (newImports.length > 0) {
          coreImport.addNamedImports(newImports);
          result.changes.push({
            type: 'import',
            description: `Added imports: ${newImports.join(', ')}`,
            before: '',
            after: newImports.join(', '),
          });
        }
      }
    } else {
      // Create new import
      const imports: string[] = [];
      if (needsGetApiBaseUrl) imports.push('getApiBaseUrl');
      if (needsBuildApiUrl) imports.push('buildApiUrl');
      if (needsBuildTrpcUrl) imports.push('buildTrpcUrl');
      if (needsBuildBrandLogoUploadUrl) imports.push('buildBrandLogoUploadUrl');
      if (needsBuildTempBrandLogoUploadUrl)
        imports.push('buildTempBrandLogoUploadUrl');

      const importDeclaration = sourceFile.addImportDeclaration({
        moduleSpecifier: '@luke/core',
        namedImports: imports,
      });

      result.changes.push({
        type: 'import',
        description: `Added import from @luke/core: ${imports.join(', ')}`,
        before: '',
        after: `import { ${imports.join(', ')} } from '@luke/core';`,
      });
    }
  }

  /**
   * Generate final report
   */
  private generateReport(options: CodemodOptions): void {
    console.log('\n📊 CODEMOD REPORT');
    console.log('==================');

    const totalFiles = this.results.length;
    const filesWithChanges = this.results.filter(
      r => r.changes.length > 0
    ).length;
    const totalChanges = this.results.reduce(
      (sum, r) => sum + r.changes.length,
      0
    );
    const totalErrors = this.results.reduce(
      (sum, r) => sum + r.errors.length,
      0
    );

    console.log(`Files processed: ${totalFiles}`);
    console.log(`Files modified: ${filesWithChanges}`);
    console.log(`Total changes: ${totalChanges}`);
    console.log(`Errors: ${totalErrors}`);

    if (totalChanges > 0) {
      console.log('\n📝 DETAILED CHANGES:');
      this.results.forEach(result => {
        if (result.changes.length > 0) {
          console.log(`\n${result.file}:`);
          result.changes.forEach(change => {
            console.log(`  ${change.type}: ${change.description}`);
            if (options.verbose) {
              console.log(`    Before: ${change.before}`);
              console.log(`    After:  ${change.after}`);
            }
          });
        }
      });
    }

    if (totalErrors > 0) {
      console.log('\n❌ ERRORS:');
      this.results.forEach(result => {
        if (result.errors.length > 0) {
          console.log(`\n${result.file}:`);
          result.errors.forEach(error => {
            console.log(`  ${error}`);
          });
        }
      });
    }

    if (options.dryRun) {
      console.log('\n🔍 This was a DRY RUN. No files were modified.');
      console.log('Run without --dry-run to apply changes.');
    } else if (totalChanges > 0) {
      console.log('\n✅ Changes applied successfully!');
      console.log('Run "pnpm -w lint" to verify the changes.');
    } else {
      console.log('\n✨ No changes needed - all files are already compliant!');
    }
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): CodemodOptions {
  const args = process.argv.slice(2);

  const options: CodemodOptions = {
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--file':
        options.targetFile = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
Usage: tsx tools/codemods/eliminate-hardcoded-urls.ts [options]

Options:
  --dry-run     Show what would be changed without modifying files
  --verbose     Show detailed before/after for each change
  --file <path> Process only the specified file
  --help        Show this help message

Examples:
  tsx tools/codemods/eliminate-hardcoded-urls.ts --dry-run
  tsx tools/codemods/eliminate-hardcoded-urls.ts --verbose
  tsx tools/codemods/eliminate-hardcoded-urls.ts --file apps/web/src/auth.ts
        `);
        process.exit(0);
        break;
    }
  }

  return options;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const eliminator = new HardcodedUrlEliminator();

  try {
    await eliminator.run(options);
  } catch (error) {
    console.error('❌ Codemod failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
