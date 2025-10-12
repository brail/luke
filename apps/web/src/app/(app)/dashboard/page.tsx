'use client';

import { useSession } from 'next-auth/react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';

/**
 * Pagina dashboard con info sessione e statistiche
 * Layout e header gestiti dal layout padre
 */
export default function DashboardPage() {
  const { data: session } = useSession();

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Info Sessione */}
        <Card>
          <CardHeader>
            <CardTitle>Informazioni Sessione</CardTitle>
            <CardDescription>Dettagli utente corrente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <span className="font-medium">Nome:</span> {session?.user?.name}
            </div>
            <div>
              <span className="font-medium">Email:</span> {session?.user?.email}
            </div>
            <div>
              <span className="font-medium">Ruolo:</span>{' '}
              {session?.user?.role || 'N/A'}
            </div>
            <div>
              <span className="font-medium">ID:</span> {session?.user?.id}
            </div>
          </CardContent>
        </Card>

        {/* Benvenuto */}
        <Card>
          <CardHeader>
            <CardTitle>Benvenuto in Luke</CardTitle>
            <CardDescription>Console amministrativa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Utilizza la sidebar per navigare tra le diverse sezioni
              dell&apos;applicazione.
            </p>
            <p className="text-sm text-muted-foreground">
              Puoi gestire utenti, configurazioni, storage, mail e
              autenticazione LDAP.
            </p>
          </CardContent>
        </Card>

        {/* Statistiche (Placeholder) */}
        <Card>
          <CardHeader>
            <CardTitle>Statistiche</CardTitle>
            <CardDescription>Panoramica sistema</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">0</div>
            <div className="text-sm text-muted-foreground">Utenti totali</div>
            <div className="text-2xl font-bold">0</div>
            <div className="text-sm text-muted-foreground">Configurazioni</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
