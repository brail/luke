'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';
import { trpc } from '../../../../lib/trpc';
import { useStandardMutation } from '../../../../lib/useStandardMutation';

import { EffectivePreview } from './_components/EffectivePreview';
import { RoleSectionDefaultsMatrix } from './_components/RoleSectionDefaultsMatrix';

/**
 * Pagina per gestione accessi alle sezioni
 * Due modalità: override per utente e default per ruolo
 */
export default function SectionAccessPage() {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [overrides, setOverrides] = useState<
    Record<string, 'auto' | 'enabled' | 'disabled'>
  >({
    dashboard: 'auto',
    settings: 'auto',
    maintenance: 'auto',
  });

  // Query per lista utenti
  const { data: usersData, isLoading: isLoadingUsers } =
    trpc.users.list.useQuery({
      page: 1,
      limit: 100,
      search: searchTerm || undefined,
    });

  // Query per override utente selezionato
  const { data: userOverrides } = trpc.sectionAccess.getByUser.useQuery(
    { userId: selectedUserId },
    { enabled: !!selectedUserId }
  );

  // Mutation per salvare override
  const setOverrideMutation = trpc.sectionAccess.set.useMutation();

  const { mutate: saveOverride, isPending: isSaving } = useStandardMutation({
    mutateFn: setOverrideMutation.mutateAsync,
    onSuccessMessage: 'Override salvato con successo',
    onErrorMessage: 'Errore durante il salvataggio',
    onSuccess: () => {
      // Reset form
      setSelectedUserId('');
      setOverrides({
        dashboard: 'auto',
        settings: 'auto',
        maintenance: 'auto',
      });
    },
  });

  // Carica override quando utente selezionato
  React.useEffect(() => {
    if (userOverrides) {
      const newOverrides: Record<string, 'auto' | 'enabled' | 'disabled'> = {
        dashboard: 'auto',
        settings: 'auto',
        maintenance: 'auto',
      };

      userOverrides.forEach(override => {
        if (override.enabled === true) {
          newOverrides[override.section] = 'enabled';
        } else if (override.enabled === false) {
          newOverrides[override.section] = 'disabled';
        }
      });

      setOverrides(newOverrides);
    }
  }, [userOverrides]);

  const handleSave = () => {
    if (!selectedUserId) {
      toast.error('Seleziona un utente');
      return;
    }

    // Salva ogni override modificato
    const promises = Object.entries(overrides).map(([section, value]) => {
      const enabled = value === 'auto' ? null : value === 'enabled';
      return saveOverride({
        userId: selectedUserId,
        section: section as 'dashboard' | 'settings' | 'maintenance',
        enabled,
      });
    });

    Promise.all(promises);
  };

  const sections = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'settings', label: 'Settings' },
    { key: 'maintenance', label: 'Maintenance' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestione Accessi Sezioni"
        description="Gestisci accessi alle sezioni tramite override utente o default per ruolo"
      />

      <Tabs defaultValue="user-overrides" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="user-overrides">Per Utente</TabsTrigger>
          <TabsTrigger value="role-defaults">Default per Ruolo</TabsTrigger>
        </TabsList>

        <TabsContent value="user-overrides" className="space-y-6">
          <SectionCard
            title="Selezione Utente"
            description="Seleziona l'utente per cui modificare gli accessi"
          >
            <div className="space-y-4">
              <div>
                <Label htmlFor="user-search">Cerca utente</Label>
                <Input
                  id="user-search"
                  placeholder="Nome, email o username..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              {isLoadingUsers ? (
                <p>Caricamento utenti...</p>
              ) : (
                <div className="space-y-2">
                  <Label>Seleziona utente</Label>
                  <Select
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleziona un utente" />
                    </SelectTrigger>
                    <SelectContent>
                      {usersData?.users.map(user => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.firstName} {user.lastName} ({user.email}) -{' '}
                          {user.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </SectionCard>

          {selectedUserId && (
            <SectionCard
              title="Override Accessi"
              description="Imposta l'accesso per ogni sezione"
            >
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sezione</TableHead>
                      <TableHead>Stato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections.map(section => (
                      <TableRow key={section.key}>
                        <TableCell className="font-medium">
                          {section.label}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={overrides[section.key]}
                            onValueChange={value =>
                              setOverrides(prev => ({
                                ...prev,
                                [section.key]: value as
                                  | 'auto'
                                  | 'enabled'
                                  | 'disabled',
                              }))
                            }
                          >
                            <SelectTrigger className="w-48">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">
                                Auto (da ruolo)
                              </SelectItem>
                              <SelectItem value="enabled">Abilitata</SelectItem>
                              <SelectItem value="disabled">
                                Disabilitata
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-32"
                  >
                    {isSaving ? 'Salvataggio...' : 'Salva modifiche'}
                  </Button>
                </div>
              </div>
            </SectionCard>
          )}
        </TabsContent>

        <TabsContent value="role-defaults" className="space-y-6">
          <RoleSectionDefaultsMatrix />
          <EffectivePreview />
        </TabsContent>
      </Tabs>
    </div>
  );
}
