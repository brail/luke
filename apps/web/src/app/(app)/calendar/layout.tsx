import React from 'react';

import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

export default async function CalendarLayout({ children }: { children: React.ReactNode }) {
  await assertSectionAccess('planning');
  return <>{children}</>;
}
