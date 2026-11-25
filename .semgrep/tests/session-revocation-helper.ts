declare const tx: { user: { update(args: unknown): Promise<unknown>; updateMany(args: unknown): Promise<unknown> } };
declare const revoke: { user(id: string): { increment: 1 } };

export async function bareIncrement(id: string) {
  // ruleid: luke-session-revocation-helper
  return tx.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
}

export async function bulkIncrement() {
  // ruleid: luke-session-revocation-helper
  return tx.user.updateMany({ where: { role: 'viewer' }, data: { role: 'viewer', tokenVersion: { increment: 1 } } });
}

export async function throughTheHelper(id: string) {
  // ok: luke-session-revocation-helper
  return tx.user.update({ where: { id }, data: { tokenVersion: revoke.user(id) } });
}
