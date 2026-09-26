import React from 'react';

import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

/**
 * Layout for the Settings section.
 * Protects every route under /settings with an access check.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertSectionAccess('settings');
  return <>{children}</>;
}
