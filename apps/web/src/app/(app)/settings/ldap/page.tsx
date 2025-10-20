'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { ldapConfigSchema, type LdapConfigInput } from '@luke/core';

import { SectionCard } from '../../../../components/SectionCard';
import { KeyValueGrid } from '../../../../components/settings/KeyValueGrid';
import { SensitiveField } from '../../../../components/settings/SensitiveField';
import { SettingsActions } from '../../../../components/settings/SettingsActions';
import { SettingsFormShell } from '../../../../components/settings/SettingsFormShell';
import { TestStatusBanner } from '../../../../components/settings/TestStatusBanner';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../components/ui/form';
import { Input } from '../../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Switch } from '../../../../components/ui/switch';
import { Textarea } from '../../../../components/ui/textarea';
import { useToast } from '../../../../hooks/use-toast';
import { debugLog, debugWarn } from '../../../../lib/debug';
import { trpc } from '../../../../lib/trpc';

export default function LdapSettingsPage() {
  const { data: session, status } = useSession();
  const toast = useToast();

  // Form con react-hook-form e validazione Zod
  const form = useForm<LdapConfigInput>({
    resolver: zodResolver(ldapConfigSchema),
    defaultValues: {
      enabled: false,
      url: '',
      bindDN: '',
      bindPassword: '',
      searchBase: '',
      searchFilter: '',
      groupSearchBase: '',
      groupSearchFilter: '',
      roleMapping: '',
      strategy: 'local-first',
    },
  });

  // Stato per i flag di presenza dei campi sensibili
  const [hasBindDN, setHasBindDN] = React.useState(false);
  const [hasBindPassword, setHasBindPassword] = React.useState(false);
  const [testConnectionStatus, setTestConnectionStatus] = React.useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [testConnectionMessage, setTestConnectionMessage] =
    React.useState<string>('');

  // Dialog per test ricerca
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [searchUsername, setSearchUsername] = useState('');

  // Carica configurazione esistente (solo se admin)
  const {
    data: existingConfig,
    isLoading: isLoadingConfig,
    error: configError,
  } = trpc.integrations.auth.getLdapConfig.useQuery(undefined, {
    enabled: session?.user?.role === 'admin',
  });

  // Aggiorna form quando arriva la configurazione esistente
  useEffect(() => {
    if (existingConfig) {
      form.reset({
        enabled: existingConfig.enabled,
        url: existingConfig.url,
        bindDN: '',
        bindPassword: '',
        searchBase: existingConfig.searchBase,
        searchFilter: existingConfig.searchFilter,
        groupSearchBase: existingConfig.groupSearchBase,
        groupSearchFilter: existingConfig.groupSearchFilter,
        roleMapping: existingConfig.roleMapping,
        strategy: existingConfig.strategy,
      });

      setHasBindDN(existingConfig.hasBindDN);
      setHasBindPassword(existingConfig.hasBindPassword);
    }
  }, [existingConfig, form]);

  // Mutations (solo se admin)
  const saveConfigMutation = trpc.integrations.auth.saveLdapConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione LDAP salvata con successo');
      setTestConnectionStatus('idle');
      setTestConnectionMessage('');
    },
    onError: (err: any) => {
      toast.error('Errore durante il salvataggio', {
        description: err.message,
      });
      debugWarn('LDAP save error:', err);
    },
  });

  const testConnectionMutation =
    trpc.integrations.auth.testLdapConnection.useMutation({
      onSuccess: () => {
        toast.success('Test connessione LDAP riuscito');
        setTestConnectionStatus('success');
        setTestConnectionMessage(
          'Connessione al server LDAP stabilita con successo'
        );
      },
      onError: (err: any) => {
        toast.error('Test connessione fallito', {
          description: err.message,
        });
        setTestConnectionStatus('error');
        setTestConnectionMessage(err.message);
        debugWarn('LDAP connection test error:', err);
      },
    });

  const testSearchMutation = trpc.integrations.auth.testLdapSearch.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Test ricerca LDAP: ${data.message}`);
      debugLog('LDAP Search Results:', data);
      setShowSearchDialog(false);
      setSearchUsername('');
    },
    onError: (err: any) => {
      toast.error('Test ricerca fallito', {
        description: err.message,
      });
      debugWarn('LDAP search test error:', err);
    },
  });

  // Controllo accesso admin
  if (status === 'loading') {
    return (
      <SettingsFormShell
        title="Configurazione LDAP"
        description="Caricamento..."
        isLoading={true}
      >
        <div />
      </SettingsFormShell>
    );
  }

  if (!session || session.user.role !== 'admin') {
    return (
      <SettingsFormShell
        title="Configurazione LDAP"
        description="Accesso negato"
      >
        <SectionCard
          title="Accesso Negato"
          description="Permessi insufficienti"
        >
          <div className="text-center space-y-4">
            <div className="text-destructive text-lg font-semibold">
              Accesso Negato
            </div>
            <p className="text-muted-foreground">
              Solo gli amministratori possono gestire la configurazione LDAP.
            </p>
            <Button asChild variant="outline">
              <a href="/dashboard">Torna alla Dashboard</a>
            </Button>
          </div>
        </SectionCard>
      </SettingsFormShell>
    );
  }

  const onSubmit = (data: LdapConfigInput) => {
    // Prepara payload escludendo bindPassword se vuoto
    const { bindPassword, ...payloadWithoutPassword } = data;
    const payload =
      !bindPassword || bindPassword.trim() === ''
        ? payloadWithoutPassword
        : data;

    saveConfigMutation.mutate(payload);
  };

  const handleTestConnection = () => {
    const formData = form.getValues();
    if (!formData.enabled) {
      toast.error('Abilita LDAP prima di testare la connessione');
      return;
    }

    setTestConnectionStatus('idle');
    setTestConnectionMessage('');
    testConnectionMutation.mutate();
  };

  const handleTestSearch = () => {
    const formData = form.getValues();
    if (!formData.enabled) {
      toast.error('Abilita LDAP prima di testare la ricerca');
      return;
    }
    setShowSearchDialog(true);
  };

  const handleSearchDialogSubmit = () => {
    if (searchUsername.trim()) {
      testSearchMutation.mutate({ username: searchUsername.trim() });
    }
  };

  return (
    <SettingsFormShell
      title="Configurazione LDAP"
      description="Configura l'autenticazione enterprise via LDAP con mapping dei ruoli"
      isLoading={isLoadingConfig}
      error={configError}
    >
      <SectionCard
        title="Parametri LDAP"
        description="Configurazione completa per l'autenticazione LDAP"
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Abilita LDAP */}
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      Abilita autenticazione LDAP
                    </FormLabel>
                    <FormDescription>
                      Attiva l&apos;autenticazione via server LDAP
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Strategia Autenticazione */}
            <FormField
              control={form.control}
              name="strategy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Strategia Autenticazione</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona strategia" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="local-first">
                        Locale prima, poi LDAP
                      </SelectItem>
                      <SelectItem value="ldap-first">
                        LDAP prima, poi locale
                      </SelectItem>
                      <SelectItem value="local-only">
                        Solo autenticazione locale
                      </SelectItem>
                      <SelectItem value="ldap-only">
                        Solo autenticazione LDAP
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Determina l&apos;ordine di tentativo per
                    l&apos;autenticazione
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <KeyValueGrid cols={2}>
              {/* URL LDAP */}
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      URL LDAP <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="ldap://server.example.com:389"
                        disabled={!form.watch('enabled')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      URL del server LDAP (es. ldap://server.example.com:389)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Search Base */}
              <FormField
                control={form.control}
                name="searchBase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Search Base <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="dc=example,dc=com"
                        disabled={!form.watch('enabled')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Base DN dove cercare gli utenti
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Search Filter */}
              <FormField
                control={form.control}
                name="searchFilter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Search Filter <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(uid=${username})"
                        disabled={!form.watch('enabled')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Filtro LDAP per cercare utenti (usa ${'{username}'} come
                      placeholder)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Group Search Base */}
              <FormField
                control={form.control}
                name="groupSearchBase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Search Base</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="ou=groups,dc=example,dc=com"
                        disabled={!form.watch('enabled')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Base DN dove cercare i gruppi dell&apos;utente
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Group Search Filter */}
              <FormField
                control={form.control}
                name="groupSearchFilter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Search Filter</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(member=${userDN})"
                        disabled={!form.watch('enabled')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Filtro LDAP per cercare gruppi (usa ${'{userDN}'} come
                      placeholder)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </KeyValueGrid>

            {/* Bind DN */}
            <FormField
              control={form.control}
              name="bindDN"
              render={({ field }) => (
                <SensitiveField
                  label="Bind DN"
                  description="DN dell'account amministrativo per cercare gli utenti"
                  hasValue={hasBindDN}
                  placeholder="cn=admin,dc=example,dc=com"
                  disabled={!form.watch('enabled')}
                  field={field}
                />
              )}
            />

            {/* Bind Password */}
            <FormField
              control={form.control}
              name="bindPassword"
              render={({ field }) => (
                <SensitiveField
                  label="Bind Password"
                  description="Password dell'account amministrativo"
                  hasValue={hasBindPassword}
                  placeholder="Inserisci password"
                  disabled={!form.watch('enabled')}
                  field={field}
                />
              )}
            />

            {/* Role Mapping */}
            <FormField
              control={form.control}
              name="roleMapping"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role Mapping (JSON)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={`{
  "CN=Admins,DC=example,DC=com": "admin",
  "CN=Editors,DC=example,DC=com": "editor",
  "CN=Users,DC=example,DC=com": "viewer"
}`}
                      disabled={!form.watch('enabled')}
                      className="min-h-[120px] font-mono"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Mappa i gruppi LDAP ai ruoli dell&apos;applicazione (admin,
                    editor, viewer)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Bottoni Test */}
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={
                  saveConfigMutation.isPending ||
                  testConnectionMutation.isPending
                }
                aria-busy={testConnectionMutation.isPending}
              >
                {testConnectionMutation.isPending
                  ? 'Test in corso...'
                  : 'Test Connessione'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleTestSearch}
                disabled={
                  saveConfigMutation.isPending || testSearchMutation.isPending
                }
                aria-busy={testSearchMutation.isPending}
              >
                {testSearchMutation.isPending
                  ? 'Ricerca in corso...'
                  : 'Test Ricerca'}
              </Button>
            </div>

            {/* Banner Test Status */}
            <TestStatusBanner
              status={testConnectionStatus}
              message={testConnectionMessage}
            />

            {/* Bottone Salva */}
            <SettingsActions
              isSaving={saveConfigMutation.isPending}
              disabled={
                saveConfigMutation.isPending ||
                testConnectionMutation.isPending ||
                testSearchMutation.isPending
              }
            />
          </form>
        </Form>
      </SectionCard>

      {/* Dialog Test Ricerca */}
      <Dialog open={showSearchDialog} onOpenChange={setShowSearchDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Ricerca LDAP</DialogTitle>
            <DialogDescription>
              Inserisci un username per testare la ricerca nel server LDAP
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Username da cercare"
              value={searchUsername}
              onChange={e => setSearchUsername(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleSearchDialogSubmit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSearchDialog(false)}
            >
              Annulla
            </Button>
            <Button
              onClick={handleSearchDialogSubmit}
              disabled={!searchUsername.trim() || testSearchMutation.isPending}
            >
              {testSearchMutation.isPending ? 'Ricerca...' : 'Cerca'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsFormShell>
  );
}
