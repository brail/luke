'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '../../../../lib/trpc';
import { PageHeader } from '../../../../components/PageHeader';
import { UserAvatar } from '../../../../components/UserAvatar';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Badge } from '../../../../components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Progress } from '../../../../components/ui/progress';
import {
  Clock,
  Shield,
  Smartphone,
  Monitor,
  Copy,
  Download,
  LogOut,
  CheckCircle,
  AlertCircle,
  Info,
  User,
  Mail,
  Globe,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';

/**
 * Pagina di Test Profilo - Versione Migliorata
 * Sperimenta nuovi layout e funzionalità senza modificare la pagina principale
 */
export default function ProfileTestPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'security' | 'settings'
  >('overview');

  // Query per ottenere i dati del profilo utente
  const {
    data: user,
    isLoading,
    error,
  } = trpc.me.get.useQuery(undefined, {
    enabled: !!session?.accessToken,
  });

  // Mock data per testing (da rimuovere in produzione)
  const mockStats = {
    lastLogin: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 ore fa
    accountCreated: new Date('2024-01-15'),
    sessionsActive: 2,
    profileCompletion: 85,
    loginCount: 127,
  };

  const mockDevices = [
    {
      id: 1,
      name: 'MacBook Pro',
      type: 'desktop',
      lastSeen: new Date(Date.now() - 30 * 60 * 1000),
      current: true,
    },
    {
      id: 2,
      name: 'iPhone 15',
      type: 'mobile',
      lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000),
      current: false,
    },
  ];

  const mockRecentLogins = [
    {
      id: 1,
      date: new Date(Date.now() - 2 * 60 * 60 * 1000),
      ip: '192.168.1.100',
      location: 'Milano, IT',
      success: true,
    },
    {
      id: 2,
      date: new Date(Date.now() - 24 * 60 * 60 * 1000),
      ip: '192.168.1.100',
      location: 'Milano, IT',
      success: true,
    },
    {
      id: 3,
      date: new Date(Date.now() - 48 * 60 * 60 * 1000),
      ip: '10.0.0.50',
      location: 'Roma, IT',
      success: false,
    },
  ];

  // Loading state
  if (status === 'loading' || isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente - Test"
          description="Versione sperimentale con miglioramenti UX"
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Skeleton Loading */}
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="h-3 bg-gray-200 rounded"></div>
                  <div className="h-3 bg-gray-200 rounded w-5/6"></div>
                  <div className="h-3 bg-gray-200 rounded w-4/6"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error || !user) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profilo Utente - Test"
          description="Versione sperimentale con miglioramenti UX"
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

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(user.email);
    toast.success('Email copiata negli appunti');
  };

  const handleExportProfile = () => {
    const profileData = {
      nome: `${user.firstName} ${user.lastName}`,
      email: user.email,
      username: user.username,
      provider: user.provider,
      dataCreazione: mockStats.accountCreated.toISOString(),
      ultimoAccesso: mockStats.lastLogin.toISOString(),
    };

    const blob = new Blob([JSON.stringify(profileData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profilo-${user.username}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Profilo esportato con successo');
  };

  const handleLogoutAllDevices = () => {
    toast.info('Funzionalità in sviluppo - Logout da tutti i dispositivi');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profilo Utente - Test"
        description="Versione sperimentale con miglioramenti UX e nuove funzionalità"
      />

      {/* Progress Bar Completamento Profilo */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Completamento Profilo</span>
            <span className="text-sm text-muted-foreground">
              {mockStats.profileCompletion}%
            </span>
          </div>
          <Progress value={mockStats.profileCompletion} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            Completa il tuo profilo per un&apos;esperienza migliore
          </p>
        </CardContent>
      </Card>

      {/* Layout Grid Responsive */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Attivo
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{user.email}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyEmail}
                  className="h-6 w-6 p-0"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">@{user.username}</span>
              </div>
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{user.locale || 'it-IT'}</span>
              </div>
            </CardContent>
          </Card>

          {/* Statistiche Account */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5" />
                Statistiche Account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Membro dal
                </span>
                <span className="text-sm font-medium">
                  {format(mockStats.accountCreated, 'dd MMM yyyy', {
                    locale: it,
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Ultimo accesso
                </span>
                <span className="text-sm font-medium">
                  {format(mockStats.lastLogin, 'HH:mm', { locale: it })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Accessi totali
                </span>
                <span className="text-sm font-medium">
                  {mockStats.loginCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Sessioni attive
                </span>
                <span className="text-sm font-medium">
                  {mockStats.sessionsActive}
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
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout da Tutti i Dispositivi
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Colonna Destra - Contenuto Principale */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tab Navigation */}
          <div className="flex space-x-1 bg-muted p-1 rounded-lg">
            <Button
              variant={activeTab === 'overview' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('overview')}
              className="flex-1"
            >
              Panoramica
            </Button>
            <Button
              variant={activeTab === 'security' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('security')}
              className="flex-1"
            >
              Sicurezza
            </Button>
            <Button
              variant={activeTab === 'settings' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('settings')}
              className="flex-1"
            >
              Impostazioni
            </Button>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Form Profilo Semplificato */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Informazioni Personali
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">Nome</Label>
                      <Input id="firstName" defaultValue={user.firstName} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Cognome</Label>
                      <Input id="lastName" defaultValue={user.lastName} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" defaultValue={user.email} disabled />
                    <p className="text-xs text-muted-foreground">
                      L&apos;email non può essere modificata
                    </p>
                  </div>
                  <Button className="w-full">Salva Modifiche</Button>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* Dispositivi Connessi */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Smartphone className="h-5 w-5" />
                    Dispositivi Connessi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {mockDevices.map(device => (
                      <div
                        key={device.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          {device.type === 'desktop' ? (
                            <Monitor className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <Smartphone className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium">{device.name}</p>
                            <p className="text-sm text-muted-foreground">
                              Ultimo accesso:{' '}
                              {format(device.lastSeen, 'dd MMM HH:mm', {
                                locale: it,
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {device.current && (
                            <Badge variant="default">Attuale</Badge>
                          )}
                          <Button variant="outline" size="sm">
                            Disconnetti
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Cronologia Accessi */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Accessi Recenti
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {mockRecentLogins.map(login => (
                      <div
                        key={login.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          {login.success ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium">{login.location}</p>
                            <p className="text-sm text-muted-foreground">
                              {login.ip} •{' '}
                              {format(login.date, 'dd MMM HH:mm', {
                                locale: it,
                              })}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={login.success ? 'default' : 'destructive'}
                        >
                          {login.success ? 'Successo' : 'Fallito'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Impostazioni Account
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="locale">Lingua</Label>
                    <Input id="locale" defaultValue={user.locale || 'it-IT'} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Fuso Orario</Label>
                    <Input
                      id="timezone"
                      defaultValue={user.timezone || 'Europe/Rome'}
                    />
                  </div>
                  <Button className="w-full">Salva Impostazioni</Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
