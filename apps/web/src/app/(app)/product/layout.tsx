import { assertSectionAccess } from '../../../lib/authz/assertSectionAccess';

import type { ReactNode } from 'react';

export default async function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  await assertSectionAccess('product');
  return <>{children}</>;
}
