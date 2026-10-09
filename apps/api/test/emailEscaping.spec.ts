/**
 * User-entered text reaches HTML email bodies — event titles, actor names and cancel reasons in the
 * calendar digest, the reason of a scheduled maintenance. Interpolated raw, an editor could put a
 * real link or markup inside a trusted Luke email. `escapeHtml` is the one place that turns such
 * text into HTML; this pins it and the maintenance email that uses it. The plain-text bodies fill
 * their templates with the value as itself, `$&` and the like included (#94).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn(async () => ({})) }));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock, close: () => undefined }) },
}));

const SMTP: Record<string, string> = { 'smtp.host': 'smtp.test', 'smtp.port': '587', 'smtp.user': 'u', 'smtp.pass': 'p', 'smtp.from': 'luke@test' };
vi.mock('../src/lib/configManager', () => ({
  getConfig: async (_prisma: unknown, key: string) => SMTP[key] ?? null,
  getConfigOrDefault: async () => false,
}));

const { escapeHtml, sendAccountApprovedEmail, sendMaintenanceScheduledEmail } = await import('../src/lib/mailer');

const HOSTILE = '<a href="https://evil.example">Clicca qui</a> & \'altro\'';

beforeEach(() => sendMailMock.mockClear());

describe('escapeHtml', () => {
  it('escapes the five characters that change meaning in HTML text or an attribute', () => {
    expect(escapeHtml(HOSTILE)).toBe('&lt;a href=&quot;https://evil.example&quot;&gt;Clicca qui&lt;/a&gt; &amp; &#39;altro&#39;');
  });
});

describe('sendMaintenanceScheduledEmail', () => {
  it('writes the reason into the HTML as text, never as markup', async () => {
    await sendMaintenanceScheduledEmail({} as PrismaClient, 'a@test', new Date('2026-10-01T08:00:00Z'), HOSTILE, 'https://luke.test', 'Europe/Rome'); // the stub reaches no query: config is mocked
    const html = (sendMailMock.mock.calls[0] as unknown as [{ html: string }])[0].html; // vitest types mock calls loosely
    expect(html).toContain(escapeHtml(HOSTILE));
    expect(html).not.toContain('<a href="https://evil.example">');
  });
});

describe('sendAccountApprovedEmail', () => {
  it('writes the name into the text body as itself', async () => {
    await sendAccountApprovedEmail({} as PrismaClient, 'a@test', "a$&b$'c", 'https://luke.test'); // the stub reaches no query: config is mocked
    const text = (sendMailMock.mock.calls[0] as unknown as [{ text: string }])[0].text; // vitest types mock calls loosely
    expect(text).toContain("Ciao a$&b$'c!");
  });

  it('leaves a placeholder inside the name unfilled', async () => {
    await sendAccountApprovedEmail({} as PrismaClient, 'a@test', '{{loginUrl}}', 'https://luke.test'); // the stub reaches no query: config is mocked
    const text = (sendMailMock.mock.calls[0] as unknown as [{ text: string }])[0].text; // vitest types mock calls loosely
    expect(text).toContain('Ciao {{loginUrl}}!');
  });
});
