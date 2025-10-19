'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle, XCircle } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { ldapConfigSchema, type LdapConfigInput } from '@luke/core';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Button } from '../../../../components/ui/button';
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
import { PasswordInput } from '../../../../components/ui/password-input';
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
        bindDN: '', // Non mostrare il valore esistente per sicurezza
        bindPassword: '', // Non mostrare il valore esistente per sicurezza
        searchBase: existingConfig.searchBase,
        searchFilter: existingConfig.searchFilter,
        groupSearchBase: existingConfig.groupSearchBase,
        groupSearchFilter: existingConfig.groupSearchFilter,
        roleMapping: existingConfig.roleMapping,
        strategy: existingConfig.strategy,
      });

      // Aggiorna i flag per i campi sensibili
      setHasBindDN(existingConfig.hasBindDN);
      setHasBindPassword(existingConfig.hasBindPassword);
    }
  }, [existingConfig, form]);

  // Mutations (solo se admin)
  const saveConfigMutation = trpc.integrations.auth.saveLdapConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione LDAP salvata con successo!');
      setTestConnectionStatus('idle');
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
        toast.success('Test connessione LDAP riuscito!');
        setTestConnectionStatus('success');
      },
      onError: (err: any) => {
        toast.error('Test connessione fallito', {
          description: err.message,
        });
        setTestConnectionStatus('error');
        debugWarn('LDAP connection test error:', err);
      },
    });

  const testSearchMutation = trpc.integrations.auth.testLdapSearch.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Test ricerca LDAP: ${data.message}`);
      debugLog('LDAP Search Results:', data);
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
      <div className="space-y-6">
        <PageHeader title="Configurazione LDAP" description="Caricamento..." />
        <SectionCard
          title="Caricamento"
          description="Verifica accesso in corso"
        >
          <div className="text-center">Caricamento...</div>
        </SectionCard>
      </div>
    );
  }

  if (!session || session.user.role !== 'admin') {
    return (
      <div className="space-y-6">
        <PageHeader title="Configurazione LDAP" description="Accesso negato" />
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
      </div>
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

    testConnectionMutation.mutate();
  };

  const handleTestSearch = () => {
    const formData = form.getValues();
    if (!formData.enabled) {
      toast.error('Abilita LDAP prima di testare la ricerca');
      return;
    }
    const username = prompt('Inserisci username da cercare:');
    if (username) {
      testSearchMutation.mutate({ username });
    }
  };

  if (isLoadingConfig) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Configurazione LDAP"
          description="Caricamento configurazione..."
        />
        <SectionCard
          title="Caricamento"
          description="Recupero configurazione esistente"
        >
          <div className="text-center">Caricamento configurazione...</div>
        </SectionCard>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Configurazione LDAP"
          description="Errore nel caricamento"
        />
        <SectionCard
          title="Errore"
          description="Impossibile caricare la configurazione"
        >
          <div className="text-center space-y-4">
            <div className="text-destructive text-lg font-semibold">
              Errore nel caricamento
            </div>
            <p className="text-muted-foreground">
              {configError.message || 'Errore sconosciuto'}
            </p>
            <Button asChild variant="outline">
              <a href="/dashboard">Torna alla Dashboard</a>
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div key={session?.user?.id} className="space-y-6">
      <PageHeader
        title="Configurazione LDAP"
        description="Configura l'autenticazione enterprise via LDAP con mapping dei ruoli"
      />

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

            {/* URL LDAP */}
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL LDAP *</FormLabel>
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

            {/* Bind DN */}
            <FormField
              control={form.control}
              name="bindDN"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bind DN</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={
                        hasBindDN ? '••••••••' : 'cn=admin,dc=example,dc=com'
                      }
                      disabled={!form.watch('enabled')}
                      hasValue={hasBindDN}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    DN dell&apos;account amministrativo per cercare gli utenti
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Bind Password */}
            <FormField
              control={form.control}
              name="bindPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bind Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={
                        hasBindPassword ? '••••••••' : 'Inserisci password'
                      }
                      disabled={!form.watch('enabled')}
                      hasValue={hasBindPassword}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Password dell&apos;account amministrativo
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
                  <FormLabel>Search Base *</FormLabel>
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
                  <FormLabel>Search Filter *</FormLabel>
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

            {/* Bottoni */}
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={
                  saveConfigMutation.isPending ||
                  testConnectionMutation.isPending
                }
              >
                {testConnectionMutation.isPending ? (
                  'Test in corso...'
                ) : (
                  <>
                    Test Connessione
                    {testConnectionStatus === 'success' && (
                      <CheckCircle className="ml-2 h-4 w-4 text-green-500" />
                    )}
                    {testConnectionStatus === 'error' && (
                      <XCircle className="ml-2 h-4 w-4 text-red-500" />
                    )}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleTestSearch}
                disabled={
                  saveConfigMutation.isPending || testSearchMutation.isPending
                }
              >
                {testSearchMutation.isPending
                  ? 'Ricerca in corso...'
                  : 'Test Ricerca'}
              </Button>
              <Button type="submit" disabled={saveConfigMutation.isPending}>
                {saveConfigMutation.isPending
                  ? 'Salvataggio...'
                  : 'Salva Configurazione'}
              </Button>
            </div>
          </form>
        </Form>
      </SectionCard>
    </div>
  );
}
