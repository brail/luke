'use client';

import { PageHeader } from '../../../components/PageHeader';
import { SectionCard } from '../../../components/SectionCard';

/**
 * Pagina principale per sezione Maintenance
 * Placeholder per funzionalità di manutenzione e diagnostica
 */
export default function MaintenancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Manutenzione"
        description="Strumenti di manutenzione e diagnostica del sistema"
      />

      <SectionCard
        title="Stato Sistema"
        description="Monitoraggio e diagnostica"
      >
        <p className="text-muted-foreground">
          Placeholder per funzionalità di manutenzione del sistema.
        </p>
      </SectionCard>
    </div>
  );
}
