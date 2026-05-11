'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle, FileJson, LogOut, Unplug } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

import { SectionCard } from '../../../../components/SectionCard';
import { KeyValueGrid } from '../../../../components/settings/KeyValueGrid';
import { SettingsFormShell } from '../../../../components/settings/SettingsFormShell';
import { TestStatusBanner } from '../../../../components/settings/TestStatusBanner';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
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
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';

const baseSchema = z.object({
  authMode: z.enum(['service_account', 'oauth_user']),
  domain: z.string().min(1, 'Workspace domain obbligatorio').or(z.literal('')),
  calendarSyncEnabled: z.boolean(),
});

const schema = z.discriminatedUnion('authMode', [
  baseSchema.extend({
    authMode: z.literal('service_account'),
    serviceEmail: z.string().email('Email non valida').or(z.literal('')),
    serviceKey: z.string().optional(),
    impersonateEmail: z.string().email('Email non valida').or(z.literal('')),
  }),
  baseSchema.extend({
    authMode: z.literal('oauth_user'),
    oauthClientId: z.string().min(1, 'Client ID obbligatorio').or(z.literal('')),
    oauthClientSecret: z.string().optional(),
  }),
]);

type FormValues = z.infer<typeof schema>;

interface ServiceAccountJson {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
}

export default function GoogleWorkspacePage() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { can } = usePermission();
  const canUpdate = can('config:update');
  const searchParams = useSearchParams();

  const [hasServiceKey, setHasServiceKey] = useState(false);
  const [hasOauthClientSecret, setHasOauthClientSecret] = useState(false);
  const [hasOauthToken, setHasOauthToken] = useState(false);
  const [oauthUserEmail, setOauthUserEmail] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [jsonPaste, setJsonPaste] = useState('');
  const [jsonError, setJsonError] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      authMode: 'service_account',
      domain: '',
      calendarSyncEnabled: false,
      serviceEmail: '',
      serviceKey: '',
      impersonateEmail: '',
    },
  });

  const authMode = form.watch('authMode');

  const { data: config, isLoading } = trpc.integrations.google.getConfig.useQuery();

  useEffect(() => {
    if (!config) return;
    setHasServiceKey(config.hasServiceKey);
    setHasOauthClientSecret(config.hasOauthClientSecret);
    setHasOauthToken(config.hasOauthToken);
    setOauthUserEmail(config.oauthUserEmail);

    if (config.authMode === 'service_account') {
      form.reset({
        authMode: 'service_account',
        domain: config.domain,
        calendarSyncEnabled: config.calendarSyncEnabled,
        serviceEmail: config.serviceEmail,
        serviceKey: '',
        impersonateEmail: config.impersonateEmail,
      });
    } else {
      form.reset({
        authMode: 'oauth_user',
        domain: config.domain,
        calendarSyncEnabled: config.calendarSyncEnabled,
        oauthClientId: config.oauthClientId,
        oauthClientSecret: '',
      });
    }
  }, [config, form]);

  // Handle OAuth callback: exchange code if present in URL
  const exchangeMutation = trpc.integrations.google.exchangeOAuthCode.useMutation({
    onSuccess: (data) => {
      toast.success(`Account Google connesso: ${data.userEmail}`);
      setHasOauthToken(true);
      setOauthUserEmail(data.userEmail);
      void utils.integrations.google.getConfig.invalidate();
    },
    onError: (error) => {
      toast.error('Connessione OAuth fallita', { description: error.message });
    },
  });

  useEffect(() => {
    const code = searchParams.get('oauth_code');
    const oauthError = searchParams.get('oauth_error');
    if (oauthError) {
      toast.error('Autorizzazione Google negata');
    }
    if (code && !exchangeMutation.isPending) {
      const redirectUri = `${window.location.origin}/api/google/oauth/callback`;
      exchangeMutation.mutate({ code, redirectUri });
      // Clean URL
      window.history.replaceState({}, '', '/settings/google');
    }
  }, []);

  const saveMutation = trpc.integrations.google.saveConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione Google Workspace salvata');
      void utils.integrations.google.getConfig.invalidate();
    },
    onError: (error) => {
      toast.error('Errore durante il salvataggio', { description: error.message });
    },
  });

  const testMutation = trpc.integrations.google.testConnection.useMutation({
    onSuccess: (data) => {
      if (data.ok) {
        setTestStatus('success');
        setTestMessage('Connessione Google riuscita.');
        toast.success('Test riuscito');
      } else {
        setTestStatus('error');
        setTestMessage(data.error ?? 'Connessione fallita');
        toast.error('Test fallito');
      }
    },
    onError: (error) => {
      setTestStatus('error');
      setTestMessage(error.message);
      toast.error('Test fallito', { description: error.message });
    },
  });

  const getOAuthUrlMutation = trpc.integrations.google.getOAuthUrl.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      toast.error('Impossibile avviare OAuth', { description: error.message });
    },
  });

  const disconnectMutation = trpc.integrations.google.disconnectOAuth.useMutation({
    onSuccess: () => {
      toast.success('Account Google disconnesso');
      setHasOauthToken(false);
      setOauthUserEmail('');
      void utils.integrations.google.getConfig.invalidate();
    },
    onError: (error) => {
      toast.error('Errore disconnessione', { description: error.message });
    },
  });

  const handleJsonPaste = (value: string) => {
    setJsonPaste(value);
    setJsonError('');
    if (!value.trim()) return;
    try {
      const parsed = JSON.parse(value) as ServiceAccountJson;
      if (!parsed.client_email || !parsed.private_key) {
        setJsonError('JSON non valido: mancano client_email o private_key');
        return;
      }
      type SAValues = Extract<FormValues, { authMode: 'service_account' }>;
      const saForm = form as unknown as UseFormReturn<SAValues>;
      saForm.setValue('serviceEmail', parsed.client_email, { shouldValidate: true });
      saForm.setValue('serviceKey', parsed.private_key, { shouldValidate: true });
      setJsonPaste('');
      toast.success('Credenziali estratte dal JSON');
    } catch {
      setJsonError('JSON non valido — verifica di aver incollato il file completo');
    }
  };

  const handleConnectOAuth = async () => {
    const redirectUri = `${window.location.origin}/api/google/oauth/callback`;
    getOAuthUrlMutation.mutate({ redirectUri });
  };

  const onSubmit = (data: FormValues) => {
    if (data.authMode === 'service_account') {
      saveMutation.mutate({
        authMode: 'service_account',
        serviceEmail: data.serviceEmail,
        serviceKey: data.serviceKey?.trim() || undefined,
        impersonateEmail: data.impersonateEmail || undefined,
        domain: data.domain,
        calendarSyncEnabled: data.calendarSyncEnabled,
      });
    } else {
      saveMutation.mutate({
        authMode: 'oauth_user',
        oauthClientId: data.oauthClientId,
        oauthClientSecret: data.oauthClientSecret?.trim() || undefined,
        domain: data.domain,
        calendarSyncEnabled: data.calendarSyncEnabled,
      });
    }
  };

  return (
    <SettingsFormShell
      title="Google Workspace"
      description="Integrazione con Google Workspace. Le credenziali sono condivise tra tutti i prodotti Google (Calendar, Drive, ecc.)."
      isLoading={isLoading}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Modalità autenticazione */}
          <SectionCard
            title="Modalità autenticazione"
            description="Scegli come Luke si autentica con Google."
          >
            <FormField
              control={form.control}
              name="authMode"
              render={({ field }) => (
                <FormItem>
                  <Select
                    value={field.value}
                    onValueChange={val => {
                      field.onChange(val);
                      if (val === 'service_account') {
                        form.reset({
                          authMode: 'service_account',
                          domain: form.getValues('domain'),
                          calendarSyncEnabled: form.getValues('calendarSyncEnabled'),
                          serviceEmail: config?.serviceEmail ?? '',
                          serviceKey: '',
                          impersonateEmail: config?.impersonateEmail ?? '',
                        });
                      } else {
                        form.reset({
                          authMode: 'oauth_user',
                          domain: form.getValues('domain'),
                          calendarSyncEnabled: form.getValues('calendarSyncEnabled'),
                          oauthClientId: config?.oauthClientId ?? '',
                          oauthClientSecret: '',
                        });
                      }
                    }}
                    disabled={!canUpdate}
                  >
                    <FormControl>
                      <SelectTrigger className="w-64">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="service_account">Service Account (tecnico)</SelectItem>
                      <SelectItem value="oauth_user">Account utente OAuth (collega virtuale)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {authMode === 'service_account'
                      ? 'Il service account opera con identità tecnica. Inviti da indirizzo @iam.gserviceaccount.com (o utente impersonato con DWD).'
                      : 'Luke agisce come un vero utente Google Workspace (es. luke@azienda.com). Inviti, eventi e mail escono da quell\'indirizzo.'}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SectionCard>

          {/* Service Account */}
          {authMode === 'service_account' && (
            <SectionCard
              title="Service Account"
              description="Credenziali dal file JSON scaricato da Google Cloud Console → IAM → Service Accounts → Keys → Add Key → JSON."
            >
              <div className="space-y-4">
                {canUpdate && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileJson size={15} className="text-muted-foreground" />
                      <span>Incolla JSON service account</span>
                      <span className="text-muted-foreground font-normal">(compila i campi in automatico)</span>
                    </div>
                    <Textarea
                      placeholder={'{\n  "type": "service_account",\n  "client_email": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n..."\n}'}
                      rows={4}
                      value={jsonPaste}
                      onChange={e => handleJsonPaste(e.target.value)}
                      className="font-mono text-xs"
                    />
                    {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
                  </div>
                )}

                <KeyValueGrid cols={2}>
                  <FormField
                    control={form.control}
                    name="serviceEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Account Email <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="nome@progetto.iam.gserviceaccount.com" disabled={!canUpdate} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="domain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Workspace Domain <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="azienda.com" disabled={!canUpdate} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="impersonateEmail"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Impersonazione utente (DWD — opzionale)</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="luke@azienda.com" disabled={!canUpdate} {...field} />
                        </FormControl>
                        <FormDescription>
                          Richiede Domain-Wide Delegation in Google Admin Console. Se vuoto: Luke usa l&apos;identità del service account.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </KeyValueGrid>

                <FormField
                  control={form.control}
                  name="serviceKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Private Key {!hasServiceKey && <span className="text-red-500">*</span>}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={hasServiceKey ? '•••••••• (già configurata)' : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
                          rows={4}
                          disabled={!canUpdate}
                          className="font-mono text-xs"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {hasServiceKey ? 'Già configurata e cifrata. Lascia vuoto per mantenerla.' : 'Estratta automaticamente dal JSON.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>
          )}

          {/* OAuth user */}
          {authMode === 'oauth_user' && (
            <SectionCard
              title="OAuth 2.0 — Account utente"
              description="Luke si autentica come un vero utente Google Workspace. Richiede un'app OAuth configurata in Google Cloud Console."
            >
              <div className="space-y-4">
                <KeyValueGrid cols={2}>
                  <FormField
                    control={form.control}
                    name="oauthClientId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>OAuth Client ID <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="xxxxxxxxxx.apps.googleusercontent.com" disabled={!canUpdate} {...field} />
                        </FormControl>
                        <FormDescription>Google Cloud Console → APIs → Credentials → OAuth 2.0 Client IDs</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="domain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Workspace Domain <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="azienda.com" disabled={!canUpdate} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </KeyValueGrid>

                <FormField
                  control={form.control}
                  name="oauthClientSecret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OAuth Client Secret {!hasOauthClientSecret && <span className="text-red-500">*</span>}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={hasOauthClientSecret ? '•••••••• (già configurato)' : 'GOCSPX-...'}
                          disabled={!canUpdate}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {hasOauthClientSecret ? 'Già configurato e cifrato.' : 'Client secret dell\'app OAuth.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Connessione account */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Account connesso</p>
                      {hasOauthToken && oauthUserEmail ? (
                        <div className="flex items-center gap-2 mt-1">
                          <CheckCircle size={14} className="text-green-600" />
                          <span className="text-sm text-muted-foreground">{oauthUserEmail}</span>
                          <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">Connesso</Badge>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-1">Nessun account connesso</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {hasOauthToken && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => disconnectMutation.mutate()}
                          disabled={disconnectMutation.isPending || !canUpdate}
                        >
                          <Unplug size={14} className="mr-1" />
                          Disconnetti
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleConnectOAuth}
                        disabled={getOAuthUrlMutation.isPending || !canUpdate}
                      >
                        <LogOut size={14} className="mr-1" />
                        {hasOauthToken ? 'Riconnetti' : 'Connetti account Google'}
                      </Button>
                    </div>
                  </div>
                  <Alert className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
                    <AlertDescription className="text-xs text-blue-800 dark:text-blue-300">
                      URI di reindirizzamento da aggiungere in Google Cloud Console → Credentials → OAuth 2.0:{' '}
                      <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                        {window.location.origin}/api/google/oauth/callback
                      </code>
                    </AlertDescription>
                  </Alert>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Prodotti */}
          <SectionCard title="Prodotti" description="Abilita le integrazioni specifiche per prodotto Google.">
            <FormField
              control={form.control}
              name="calendarSyncEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Sincronizzazione Google Calendar</FormLabel>
                    <FormDescription>
                      Push-only (Luke → Google): 1 calendar per brand × stagione × sezione planning.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canUpdate} />
                  </FormControl>
                </FormItem>
              )}
            />
          </SectionCard>

          {/* Test */}
          <div className="flex justify-end space-x-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTestStatus('idle');
                setTestMessage('');
                testMutation.mutate();
              }}
              disabled={testMutation.isPending || !canUpdate}
              aria-busy={testMutation.isPending}
            >
              {testMutation.isPending ? 'Test in corso...' : 'Test Connessione'}
            </Button>
          </div>
          <TestStatusBanner status={testStatus} message={testMessage} />

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => form.reset()} disabled={saveMutation.isPending || !canUpdate}>
              Reset
            </Button>
            <Button type="submit" disabled={saveMutation.isPending || !canUpdate}>
              {saveMutation.isPending ? 'Salvataggio...' : 'Salva Configurazione'}
            </Button>
          </div>
        </form>
      </Form>
    </SettingsFormShell>
  );
}
