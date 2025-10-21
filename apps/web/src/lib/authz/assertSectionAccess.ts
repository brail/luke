/**
 * Server-side utility per controllo accesso alle sezioni
 * Implementa la stessa logica dell'API per enforcement uniforme
 */

import { redirect } from 'next/navigation';

import { effectiveSectionAccess, permissions } from '@luke/core';
import type { Section } from '@luke/core';

import { auth } from '../../auth';

/**
 * Verifica accesso a una sezione e redirige se negato
 * @param section - Sezione da verificare
 */
export async function assertSectionAccess(section: Section) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  // Fetch override da API (server-to-server) - manteniamo per ora
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  let override: { enabled?: boolean } | undefined;

  try {
    const res = await fetch(`${apiUrl}/trpc/sectionAccess.getForMe`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      const found = data.result?.data?.find((o: any) => o.section === section);
      if (found) override = { enabled: found.enabled };
    }
  } catch (err) {
    // Log ma non bloccare; fallback a ruolo
    console.warn('Errore fetch override sezione:', err);
  }

  // Per ora, usiamo solo override e RBAC classico
  // TODO: Implementare fetch RBAC config via API quando necessario
  const allowed = effectiveSectionAccess({
    role: session.user.role as string,
    roleToPermissions:
      permissions[session.user.role as keyof typeof permissions] || {},
    sectionAccessDefaults: {}, // TODO: fetch da API
    userOverride: override,
    section,
    disabledSections: [], // TODO: fetch da API
  });

  if (!allowed) {
    redirect('/app/dashboard' as any);
  }
}
