import React from 'react';

import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

/**
 * Layout for the Admin section.
 * Protects every route under /admin — admins only.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertSectionAccess('admin');
  return <>{children}</>;
}
