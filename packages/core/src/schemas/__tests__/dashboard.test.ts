import { describe, it, expect } from 'vitest';

import { DashboardTaskInputSchema } from '../dashboard.js';

describe('DashboardTaskInputSchema.dueDate', () => {
  const task = (dueDate: string) => DashboardTaskInputSchema.safeParse({ label: 'Task', dueDate });

  it('takes a calendar day', () => {
    expect(task('2026-03-10').data?.dueDate).toBe('2026-03-10');
  });

  it('refuses an instant for a day', () => {
    expect(task('2026-03-09T23:00:00.000Z').success).toBe(false);
  });
});
