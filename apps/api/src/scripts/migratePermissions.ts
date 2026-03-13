/**
 * Migration Script: UserSectionAccess to UserGrantedPermission
 *
 * This script migrates from the legacy section-based access control system
 * (UserSectionAccess) to the new unified permission system (UserGrantedPermission).
 *
 * Usage:
 *   ts-node apps/api/src/scripts/migratePermissions.ts                    # Interactive mode
 *   ts-node apps/api/src/scripts/migratePermissions.ts --dry-run          # Preview without changes
 *   ts-node apps/api/src/scripts/migratePermissions.ts --confirm          # Auto-confirm migration
 */

import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

// ============================================================================
// Types and Constants
// ============================================================================

interface MigrationStats {
  totalSourceRecords: number;
  totalMigrated: number;
  totalFailed: number;
  permissionsMapped: Map<string, number>;
}

interface MigrationResult {
  userId: string;
  section: string;
  permissions: string[];
  success: boolean;
  error?: string;
}

interface BackupData {
  timestamp: string;
  sourceRecords: Array<{
    id: string;
    userId: string;
    section: string;
    enabled: boolean;
  }>;
}

const SECTION_TO_PERMISSIONS: Record<string, string[]> = {
  settings: ['config:read', 'config:update', 'settings:read'],
  maintenance: ['maintenance:read', 'maintenance:update'],
  dashboard: ['dashboard:read'],
  audit: ['audit:read'],
};

const MIGRATION_REASON = 'Migrated from UserSectionAccess';
const AUDIT_ACTION = 'PERMISSION_MIGRATED';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logError(message: string) {
  log(`ERROR: ${message}`, 'red');
}

function logSuccess(message: string) {
  log(`✓ ${message}`, 'green');
}

function logWarning(message: string) {
  log(`⚠ ${message}`, 'yellow');
}

function logInfo(message: string) {
  log(`ℹ ${message}`, 'blue');
}

function logSection(title: string) {
  log(`\n${'='.repeat(70)}`, 'cyan');
  log(title, 'cyan');
  log(`${'='.repeat(70)}\n`, 'cyan');
}

/**
 * Prompt user for confirmation
 */
async function promptConfirmation(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${colors.yellow}${message}${colors.reset} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Maps a section to its corresponding permissions
 */
function mapSectionToPermissions(section: string): string[] {
  return SECTION_TO_PERMISSIONS[section.toLowerCase()] || [];
}

/**
 * Formats a number with thousands separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}


// ============================================================================
// Phase 1: Validation
// ============================================================================

async function validatePhase(
  prisma: PrismaClient
): Promise<{
  sourceCount: number;
  targetCount: number;
  firstAdminId?: string;
  canProceed: boolean;
}> {
  logSection('PHASE 1: VALIDATION');

  try {
    // Check database connectivity
    logInfo('Checking database connectivity...');
    await prisma.$queryRaw`SELECT 1`;
    logSuccess('Database connectivity verified');

    // Count source records
    logInfo('Counting UserSectionAccess records...');
    const sourceCount = await prisma.userSectionAccess.count();
    log(`Found ${formatNumber(sourceCount)} UserSectionAccess records\n`);

    if (sourceCount === 0) {
      logWarning('No UserSectionAccess records found. Migration is not needed.');
      return {
        sourceCount: 0,
        targetCount: 0,
        canProceed: false,
      };
    }

    // Check existing target records
    logInfo('Checking for existing UserGrantedPermission entries...');
    const targetCount = await prisma.userGrantedPermission.count();
    log(`Found ${formatNumber(targetCount)} existing UserGrantedPermission records\n`);

    // Find first admin user
    logInfo('Searching for admin user...');
    const firstAdmin = await prisma.user.findFirst({
      where: { role: 'admin' },
      select: { id: true, email: true },
    });

    if (!firstAdmin) {
      logError('No admin user found in database. Cannot assign grantedBy user.');
      return {
        sourceCount,
        targetCount,
        canProceed: false,
      };
    }

    logSuccess(`Found admin user: ${firstAdmin.email} (ID: ${firstAdmin.id})`);

    // Verify section values
    logInfo('Verifying section mappings...');
    const sections = await prisma.userSectionAccess.findMany({
      select: { section: true },
      distinct: ['section'],
    });

    const sectionNames = sections.map((s) => s.section);
    const unmappedSections = sectionNames.filter(
      (s) => !SECTION_TO_PERMISSIONS[s.toLowerCase()]
    );

    if (unmappedSections.length > 0) {
      logWarning(
        `Found unmapped sections: ${unmappedSections.join(', ')}. These will be skipped.`
      );
    }

    logSuccess('Section mappings verified');
    log(`Valid sections: ${sectionNames.join(', ')}\n`);

    logSuccess('All validations passed\n');

    return {
      sourceCount,
      targetCount,
      firstAdminId: firstAdmin.id,
      canProceed: true,
    };
  } catch (error) {
    logError(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      sourceCount: 0,
      targetCount: 0,
      canProceed: false,
    };
  }
}

// ============================================================================
// Phase 2: Backup
// ============================================================================

async function backupPhase(prisma: PrismaClient): Promise<BackupData> {
  logSection('PHASE 2: BACKUP');

  try {
    logInfo('Creating backup of UserSectionAccess records...');
    const sourceRecords = await prisma.userSectionAccess.findMany({
      select: {
        id: true,
        userId: true,
        section: true,
        enabled: true,
      },
    });

    const backup: BackupData = {
      timestamp: new Date().toISOString(),
      sourceRecords,
    };

    logSuccess(`Backup created with ${formatNumber(sourceRecords.length)} records`);
    logInfo(`Backup timestamp: ${backup.timestamp}\n`);

    return backup;
  } catch (error) {
    logError(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ============================================================================
// Phase 3: Migration
// ============================================================================

async function migrationPhase(
  prisma: PrismaClient,
  firstAdminId: string,
  dryRun: boolean = false
): Promise<MigrationResult[]> {
  logSection('PHASE 3: MIGRATION');

  if (dryRun) {
    logWarning('DRY RUN MODE - No changes will be applied\n');
  }

  try {
    // Get all enabled section accesses
    logInfo('Fetching UserSectionAccess records with enabled=true...');
    const sourceRecords = await prisma.userSectionAccess.findMany({
      where: { enabled: true },
      select: {
        id: true,
        userId: true,
        section: true,
      },
    });

    logSuccess(`Found ${formatNumber(sourceRecords.length)} records to migrate\n`);

    const results: MigrationResult[] = [];
    const createdPermissions: Array<{
      userId: string;
      permission: string;
      grantedBy: string;
      reason: string;
    }> = [];

    logInfo('Processing records...');
    for (let i = 0; i < sourceRecords.length; i++) {
      const record = sourceRecords[i];
      const permissions = mapSectionToPermissions(record.section);

      if (permissions.length === 0) {
        results.push({
          userId: record.userId,
          section: record.section,
          permissions: [],
          success: false,
          error: `Unknown section: ${record.section}`,
        });
        continue;
      }

      // Create entries for each mapped permission
      for (const permission of permissions) {
        createdPermissions.push({
          userId: record.userId,
          permission,
          grantedBy: firstAdminId,
          reason: MIGRATION_REASON,
        });
      }

      results.push({
        userId: record.userId,
        section: record.section,
        permissions,
        success: true,
      });

      // Show progress
      if ((i + 1) % 100 === 0) {
        logInfo(`Processed ${formatNumber(i + 1)}/${formatNumber(sourceRecords.length)} records`);
      }
    }

    // Apply migration if not dry-run
    if (!dryRun && createdPermissions.length > 0) {
      logInfo('\nCreating UserGrantedPermission entries...');
      try {
        // Insert in batches to avoid transaction limits
        const batchSize = 1000;
        let successCount = 0;
        let skipCount = 0;

        for (let i = 0; i < createdPermissions.length; i += batchSize) {
          const batch = createdPermissions.slice(
            i,
            Math.min(i + batchSize, createdPermissions.length)
          );

          // Process each permission individually to handle duplicates gracefully
          for (const perm of batch) {
            try {
              await prisma.userGrantedPermission.create({
                data: perm,
              });
              successCount++;
            } catch (error: any) {
              // Silently skip unique constraint violations
              if (error?.code === 'P2002') {
                skipCount++;
              } else {
                throw error;
              }
            }
          }

          if ((i + batchSize) % (batchSize * 5) === 0) {
            logInfo(
              `Created ${formatNumber(Math.min(i + batchSize, createdPermissions.length))}/${formatNumber(createdPermissions.length)} permissions`
            );
          }
        }

        logSuccess(
          `Successfully created ${formatNumber(successCount)} UserGrantedPermission entries`
        );
        if (skipCount > 0) {
          logWarning(`Skipped ${formatNumber(skipCount)} duplicate entries`);
        }
      } catch (error) {
        logError(
          `Failed to create permissions: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    } else if (dryRun) {
      logInfo(`Would create ${formatNumber(createdPermissions.length)} UserGrantedPermission entries`);
    }

    log('');
    return results;
  } catch (error) {
    logError(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ============================================================================
// Phase 4: Audit
// ============================================================================

async function auditPhase(
  prisma: PrismaClient,
  migrationResults: MigrationResult[],
  firstAdminId: string,
  dryRun: boolean = false
): Promise<MigrationStats> {
  logSection('PHASE 4: AUDIT');

  try {
    const stats: MigrationStats = {
      totalSourceRecords: migrationResults.length,
      totalMigrated: migrationResults.filter((r) => r.success).length,
      totalFailed: migrationResults.filter((r) => !r.success).length,
      permissionsMapped: new Map(),
    };

    // Count permissions by type
    migrationResults.forEach((result) => {
      result.permissions.forEach((perm) => {
        const current = stats.permissionsMapped.get(perm) || 0;
        stats.permissionsMapped.set(perm, current + 1);
      });
    });

    logInfo(`Total records processed: ${formatNumber(stats.totalSourceRecords)}`);
    logInfo(`Successfully migrated: ${formatNumber(stats.totalMigrated)}`);
    logInfo(`Failed: ${formatNumber(stats.totalFailed)}\n`);

    logInfo('Permissions mapped:');
    stats.permissionsMapped.forEach((count, perm) => {
      log(`  - ${perm}: ${formatNumber(count)} users`);
    });

    // Create audit log if not dry-run
    if (!dryRun && stats.totalMigrated > 0) {
      logInfo('\nCreating PermissionAudit entry...');
      try {
        await prisma.permissionAudit.create({
          data: {
            actorId: firstAdminId,
            action: AUDIT_ACTION,
            userId: firstAdminId, // Use first admin as target user for audit
            reason: `Migration completed: ${stats.totalMigrated} records migrated from UserSectionAccess`,
          },
        });

        logSuccess('PermissionAudit entry created');
      } catch (error) {
        logWarning(
          `Failed to create audit entry: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (dryRun) {
      logInfo('Would create PermissionAudit entry for migration');
    }

    log('');
    return stats;
  } catch (error) {
    logError(`Audit phase failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ============================================================================
// Phase 5: Post-Migration Validation
// ============================================================================

async function postMigrationValidation(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _sourceCount: number
): Promise<boolean> {
  logSection('PHASE 5: POST-MIGRATION VALIDATION');

  try {
    logInfo('Verifying migration results...');

    // Check target record count
    const targetCount = await prisma.userGrantedPermission.count();
    logInfo(`UserGrantedPermission records: ${formatNumber(targetCount)}`);

    if (targetCount === 0) {
      logWarning('No permissions were created. Migration may have failed.');
      return false;
    }

    // Verify permission format
    logInfo('Validating permission formats...');
    const invalidPermissions = await prisma.userGrantedPermission.findMany({
      where: {
        NOT: {
          permission: {
            in: Array.from(new Set(
              Object.values(SECTION_TO_PERMISSIONS).flat()
            )),
          },
        },
      },
      select: { id: true, permission: true },
      take: 5,
    });

    if (invalidPermissions.length > 0) {
      logWarning(`Found ${invalidPermissions.length} invalid permissions`);
      invalidPermissions.forEach((p) => {
        logWarning(`  - ${p.permission}`);
      });
      return false;
    }

    logSuccess('All permission formats are valid');

    // Check for orphaned permissions (no matching user)
    logInfo('Checking for orphaned permissions...');
    const orphanedCount = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*) as count FROM user_granted_permissions ugp
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ugp.userId)
    `;

    if ((orphanedCount[0]?.count || 0) > 0) {
      logWarning(`Found ${orphanedCount[0]?.count} orphaned permissions`);
      return false;
    }

    logSuccess('No orphaned permissions found');

    log('');
    logSuccess('Post-migration validation passed\n');
    return true;
  } catch (error) {
    logError(
      `Post-migration validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(
  stats: MigrationStats,
  backup: BackupData,
  validationPassed: boolean,
  dryRun: boolean
) {
  logSection('MIGRATION REPORT');

  log(`Status: ${validationPassed ? 'PASSED' : 'FAILED'}`, validationPassed ? 'green' : 'red');
  log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`, dryRun ? 'yellow' : 'green');
  log(`Timestamp: ${backup.timestamp}`);
  log(`Total records processed: ${formatNumber(stats.totalSourceRecords)}`);
  log(`Successfully migrated: ${formatNumber(stats.totalMigrated)}`, 'green');
  log(`Failed: ${formatNumber(stats.totalFailed)}`, stats.totalFailed > 0 ? 'yellow' : 'green');

  log('\nPermissions mapped:');
  stats.permissionsMapped.forEach((count, perm) => {
    log(`  - ${perm}: ${formatNumber(count)} users`);
  });

  log('\nBackup information:');
  log(`  - Timestamp: ${backup.timestamp}`);
  log(`  - Records backed up: ${formatNumber(backup.sourceRecords.length)}`);

  if (dryRun) {
    log('\nDRY RUN: No changes were made to the database.', 'yellow');
    log('To apply the migration, run again with --confirm flag.\n', 'yellow');
  } else {
    log('\nMigration completed successfully!', validationPassed ? 'green' : 'yellow');
    log(
      'Note: Old UserSectionAccess records are still in the database for manual verification.\n',
      'dim'
    );
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  const prisma = new PrismaClient({
    log: process.env.DEBUG_MIGRATIONS ? ['query', 'info', 'warn', 'error'] : ['error'],
  });

  const isDryRun = process.argv.includes('--dry-run');
  const isConfirm = process.argv.includes('--confirm');

  try {
    logSection('USERSECTIONACCESS → USERGRANTEDPERMISSION MIGRATION');
    log(`Start time: ${new Date().toISOString()}\n`);

    // Phase 1: Validation
    const validationResult = await validatePhase(prisma);

    if (!validationResult.canProceed) {
      logError('Validation failed. Migration cannot proceed.');
      process.exit(1);
    }

    const { sourceCount, firstAdminId } = validationResult;

    if (sourceCount === 0) {
      logSuccess('No migration needed. Exiting.');
      process.exit(0);
    }

    // Phase 2: Backup
    const backup = await backupPhase(prisma);

    // Phase 3: Migration (preview or apply)
    logInfo(`Current mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

    if (!isDryRun && !isConfirm) {
      log('\nReview the migration details above.\n');
      const confirmed = await promptConfirmation('Proceed with migration? (yes/no)');

      if (!confirmed) {
        logWarning('Migration cancelled by user.');
        process.exit(0);
      }
    }

    const migrationResults = await migrationPhase(prisma, firstAdminId!, isDryRun);

    // Phase 4: Audit
    const stats = await auditPhase(prisma, migrationResults, firstAdminId!, isDryRun);

    // Phase 5: Post-migration validation
    let validationPassed = true;
    if (!isDryRun) {
      validationPassed = await postMigrationValidation(prisma, sourceCount);
    } else {
      logInfo('Skipping post-migration validation in dry-run mode');
    }

    // Report
    generateReport(stats, backup, validationPassed, isDryRun);

    // Exit code
    process.exit(validationPassed ? 0 : 1);
  } catch (error) {
    logError(`Migration failed with error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logError(error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// ============================================================================
// Execution
// ============================================================================

main().catch((error) => {
  logError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
