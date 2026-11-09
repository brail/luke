// Fixture for .semgrep/rules/audit-row-transaction.yml.

async function inTransaction(ctx: Ctx) {
  await ctx.prisma.$transaction(async tx => {
    // ruleid: luke-audit-row-transaction
    await logAudit(ctx, { action: 'USER_ACCESS_CHANGED', targetType: 'User' });

    // ruleid: luke-audit-row-transaction
    await logAudit({ ...ctx, prisma: tx }, { action: 'USER_ACCESS_CHANGED', targetType: 'User' });

    // ok: luke-audit-row-transaction
    await logAudit(ctx, { action: 'USER_ACCESS_CHANGED', targetType: 'User' }, { tx });

    // ruleid: luke-audit-row-transaction
    await logAuditMany(ctx, rows);

    // ok: luke-audit-row-transaction
    await logAuditMany(ctx, rows, { tx });
  });

  await ctx.prisma.$transaction(async (tx) => {
    // ok: luke-audit-row-transaction
    await logAudit(ctx, { action: 'USER_ACCESS_CHANGED', targetType: 'User' }, { required: true, tx });
  }, { timeout: 15000 });

  // ok: luke-audit-row-transaction
  await logAudit(ctx, { action: 'USER_ACCESS_CHANGED', targetType: 'User' });
}
