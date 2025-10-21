import React from 'react';

import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

/**
 * Layout per sezione Maintenance
 * Protegge tutte le route sotto /maintenance con controllo accesso
 */
export default async function MaintenanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertSectionAccess('maintenance');
  return <>{children}</>;
}
