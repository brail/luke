import React from 'react';

import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

/**
 * Layout per sezione Settings
 * Protegge tutte le route sotto /settings con controllo accesso
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertSectionAccess('settings');
  return <>{children}</>;
}
