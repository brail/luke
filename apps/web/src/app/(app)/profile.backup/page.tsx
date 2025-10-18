'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '../../../lib/trpc';
import { PageHeader } from '../../../components/PageHeader';
import { SectionCard } from '../../../components/SectionCard';
import { UserAvatar } from '../../../components/UserAvatar';
import { UserProfileForm } from './_components/UserProfileForm';
import { ChangePasswordCard } from './_components/ChangePasswordCard';

/**
 * Pagina Profilo Utente
 * Permette agli utenti di visualizzare e modificare il proprio profilo
 * Include cambio password per utenti LOCAL e campi read-only per provider esterni
 */
export default function ProfilePage() {
  const { data: session, status } = useSession();

  // Query per ottenere i dati del profilo utente
  const {
    data: user,
    isLoading,
    error,
  } = trpc.me.get.useQuery(undefined, {
    enabled: !!session?.accessToken, // Aspetta che la sessione sia caricata
  });

  // Loading state per sessione
  if (status === 'loading') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali"
        />
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Caricamento sessione...</p>
        </div>
      </div>
    );
  }

  // Redirect a login se non autenticato (gestito dal middleware)
  if (status === 'unauthenticated') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali"
        />
        <div className="text-center py-8">
          <p>Reindirizzamento al login...</p>
        </div>
      </div>
    );
  }

  // Loading state per dati utente
  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali"
        />
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Caricamento profilo...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali"
        />
        <div className="text-center py-8">
          <div className="text-destructive mb-2">
            Errore nel caricamento del profilo
          </div>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  // Nessun dato utente
  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali"
        />
        <div className="text-center py-8">
          <p>Nessun dato utente disponibile</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profilo Utente"
        description="Gestisci le tue informazioni personali e le impostazioni di sicurezza"
      />

      {/* Avatar e Info Base */}
      <SectionCard
        title="Avatar"
        description="Il tuo avatar è generato dalle iniziali del tuo nome"
      >
        <div className="flex items-center gap-4">
          <UserAvatar
            firstName={user.firstName}
            lastName={user.lastName}
            size="lg"
          />
          <div>
            <h3 className="font-medium">
              {user.firstName} {user.lastName}
            </h3>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <p className="text-sm text-muted-foreground">
              Provider: {user.provider}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Form Profilo */}
      <SectionCard
        title="Informazioni Profilo"
        description="Modifica le tue informazioni personali e le preferenze"
      >
        <UserProfileForm user={user} />
      </SectionCard>

      {/* Cambio Password (solo per utenti LOCAL) */}
      <ChangePasswordCard visible={user.provider === 'LOCAL'} />
    </div>
  );
}
