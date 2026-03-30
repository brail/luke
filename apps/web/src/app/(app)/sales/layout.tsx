import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

import type { ReactNode } from 'react';

export default async function SalesLayout({ children }: { children: ReactNode }) {
  await assertSectionAccess('sales');
  return <>{children}</>;
}
