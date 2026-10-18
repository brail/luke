import React from 'react';

import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

/**
 * Layout for the Maintenance section.
 * Protects every route under /maintenance with an access check.
 */
export default async function MaintenanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertSectionAccess('maintenance');
  return <>{children}</>;
}
