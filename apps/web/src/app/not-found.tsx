import Link from 'next/link';
import React from 'react';

import Logo from '../components/Logo';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-10">
      <PageHeader
        title="Pagina non trovata"
        description="La risorsa richiesta non esiste o è stata spostata."
      />

      <SectionCard
        title="Errore 404"
        description="Controlla l'URL o torna alla dashboard"
      >
        <div className="flex flex-col items-center text-center gap-6 py-6">
          <div className="mx-auto aspect-square w-24 max-w-full text-muted-foreground">
            <Logo size="xl" className="w-full h-full object-contain" />
          </div>
          <div className="text-sm text-muted-foreground">
            Non siamo riusciti a trovare quello che cercavi.
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard" aria-label="Torna alla Dashboard">
              <Button>Torna alla Dashboard</Button>
            </Link>
            <Link href={'/support' as any} aria-label="Apri supporto">
              <Button variant="outline">Supporto</Button>
            </Link>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
