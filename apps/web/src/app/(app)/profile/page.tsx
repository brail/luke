'use client';

import React, { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { trpc } from '../../../lib/trpc';
import { PageHeader } from '../../../components/PageHeader';
import { UserAvatar } from '../../../components/UserAvatar';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import {
  Shield,
  Copy,
  Download,
  LogOut,
  AlertCircle,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFormatDate } from '../../../hooks/use-format-date';
import { UserProfileForm } from './_components/UserProfileForm';
import { ChangePasswordCard } from './_components/ChangePasswordCard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

/**
 * Pagina Profilo Utente Semplificata
 * Layout responsive unico senza tab, con statistiche reali e quick actions
 */
export default function ProfilePage() {
  const { data: session, status } = useSession();
  const formatDate = useFormatDate();
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

  // Query per ottenere i dati del profilo utente
  const {
    data: user,
    isLoading,
    error,
  } = trpc.me.get.useQuery(undefined, {
    enabled: !!session?.accessToken,
  });

  // Mutation per logout globale (me.revokeAllSessions)
  const revokeAllSessionsMutation = trpc.me.revokeAllSessions.useMutation({
    onSuccess: () => {
      toast.success('Tutte le sessioni sono state revocate');
      // Force logout
      signOut({ callbackUrl: '/login' });
    },
    onError: error => {
      toast.error(`Errore: ${error.message}`);
    },
  });

  // Loading state
  if (status === 'loading' || isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali e le impostazioni di sicurezza"
        />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {[1, 2].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-1"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'unauthenticated') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali e le impostazioni di sicurezza"
        />
        <div className="text-center py-8">
          <p>Reindirizzamento al login...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente"
          description="Gestisci le tue informazioni personali e le impostazioni di sicurezza"
        />
        <div className="text-center py-8">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-destructive mb-2">
            Errore nel caricamento del profilo
          </p>
          <p className="text-sm text-muted-foreground">
            {error?.message || 'Nessun dato utente disponibile'}
          </p>
        </div>
      </div>
    );
  }

  // Calcola statistiche da dati reali
  const userStats = {
    lastLogin: user.lastLoginAt || new Date(),
    accountCreated: user.createdAt || new Date(),
    sessionsActive: 1, // Sempre 1 (sessione corrente)
    loginCount: user.loginCount || 0,
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(user.email);
    toast.success('Email copiata negli appunti!');
  };

  const handleExportProfile = () => {
    const profileData = {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      locale: user.locale,
      timezone: user.timezone,
      provider: user.provider,
      createdAt: user.createdAt,
      lastLogin: userStats.lastLogin,
      loginCount: userStats.loginCount,
    };

    const blob = new Blob([JSON.stringify(profileData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profile_${user.username}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Profilo esportato con successo');
  };

  const handleLogoutAllDevices = () => {
    revokeAllSessionsMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profilo Utente"
        description="Gestisci le tue informazioni personali e le impostazioni di sicurezza"
      />

      {/* Layout Grid Responsive */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Colonna Sinistra - Avatar e Info Base */}
        <div className="lg:col-span-1 space-y-6">
          {/* Avatar e Info Principali */}
          <Card>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <UserAvatar
                  firstName={user.firstName}
                  lastName={user.lastName}
                  size="lg"
                />
              </div>
              <CardTitle className="text-xl">
                {user.firstName} {user.lastName}
              </CardTitle>
              <div className="flex items-center justify-center gap-2 mt-2">
                <Badge
                  variant={user.provider === 'LOCAL' ? 'default' : 'secondary'}
                >
                  {user.provider}
                </Badge>
                <Badge variant="outline">
                  {user.isActive ? 'Attivo' : 'Inattivo'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Membro dal
                </span>
                <span className="text-sm font-medium">
                  {formatDate.compactDate(userStats.accountCreated)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Ultimo accesso
                </span>
                <span className="text-sm font-medium">
                  {user.lastLoginAt
                    ? formatDate.time(userStats.lastLogin)
                    : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Accessi totali
                </span>
                <span className="text-sm font-medium">
                  {userStats.loginCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Sessioni attive
                </span>
                <span className="text-sm font-medium">
                  {userStats.sessionsActive}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Azioni Rapide</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleCopyEmail}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copia Email
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleExportProfile}
              >
                <Download className="h-4 w-4 mr-2" />
                Esporta Profilo
              </Button>
              {user.provider === 'LOCAL' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setShowChangePasswordModal(true)}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Cambia Password
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-red-600 hover:text-red-700"
                onClick={handleLogoutAllDevices}
                disabled={revokeAllSessionsMutation.isPending}
              >
                <LogOut className="h-4 w-4 mr-2" />
                {revokeAllSessionsMutation.isPending
                  ? 'Revocando...'
                  : 'Logout da tutti i dispositivi'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Colonna Destra - Contenuto Principale */}
        <div className="lg:col-span-3 space-y-6">
          {/* Informazioni Profilo */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Informazioni Profilo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <UserProfileForm user={user} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal Cambio Password */}
      <Dialog
        open={showChangePasswordModal}
        onOpenChange={setShowChangePasswordModal}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Cambia Password
            </DialogTitle>
          </DialogHeader>
          <ChangePasswordCard
            visible={true}
            onSuccess={() => setShowChangePasswordModal(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
