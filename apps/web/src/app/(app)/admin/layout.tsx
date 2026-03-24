import React from 'react';

import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

/**
 * Layout per sezione Admin
 * Protegge tutte le route sotto /admin — accessibili solo agli admin
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertSectionAccess('admin');
  return <>{children}</>;
}
