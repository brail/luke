'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
import { Label } from '../../../../components/ui/label';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';
import { useToast } from '../../../../hooks/use-toast';
import { trpc } from '../../../../lib/trpc';

/**
 * Schema per form storage locale
 */
const storageConfigFormSchema = z.object({
  basePath: z
    .string()
    .min(1, 'Path richiesto')
    .regex(
      /^\/[a-zA-Z0-9_\-/]*$/,
      'Path deve iniziare con / e contenere solo caratteri validi'
    ),
  maxFileSizeMB: z.coerce
    .number()
    .int()
    .min(1, 'Minimo 1 MB')
    .max(1000, 'Massimo 1000 MB'),
  buckets: z.array(z.enum(['uploads', 'exports', 'assets'])),
});

type StorageConfigForm = z.infer<typeof storageConfigFormSchema>;

/**
 * Tipi per provider esterni
 */
type Provider = 'smb' | 'drive';

interface SmbConfig {
  host: string;
  path: string;
  username: string;
  password: string;
}

interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export default function StoragePage() {
  const { data: session, status } = useSession();
  const toast = useToast();

  // ========== TAB STORAGE LOCALE ==========

  const form = useForm<StorageConfigForm>({
    resolver: zodResolver(storageConfigFormSchema),
    defaultValues: {
      basePath: '/tmp/luke-storage',
      maxFileSizeMB: 50,
      buckets: ['uploads', 'exports', 'assets'],
    },
  });

  const {
    data: existingConfig,
    isLoading: isLoadingConfig,
    refetch: refetchConfig,
  } = trpc.storage.getConfig.useQuery(undefined, {
    enabled: session?.user?.role === 'admin',
  });

  const saveConfigMutation = trpc.storage.saveConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione storage salvata con successo');
      refetchConfig();
    },
    onError: error => {
      toast.error('Errore durante il salvataggio', {
        description: error.message,
      });
    },
  });

  useEffect(() => {
    if (existingConfig) {
      form.reset({
        basePath: existingConfig.basePath,
        maxFileSizeMB: existingConfig.maxFileSizeMB,
        buckets: existingConfig.buckets as Array<
          'uploads' | 'exports' | 'assets'
        >,
      });
    }
  }, [existingConfig, form]);

  const onSubmitLocal = (data: StorageConfigForm) => {
    saveConfigMutation.mutate(data);
  };

  // ========== TAB PROVIDER ESTERNI ==========

  const [provider, setProvider] = useState<Provider>('smb');
  const [smbConfig, setSmbConfig] = useState<SmbConfig>({
    host: '',
    path: '',
    username: '',
    password: '',
  });
  const [driveConfig, setDriveConfig] = useState<DriveConfig>({
    clientId: '',
    clientSecret: '',
    refreshToken: '',
  });
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const saveExternalConfigMutation =
    trpc.integrations.storage.saveConfig.useMutation({
      onSuccess: (data: any) => {
        toast.success(data.message || 'Configurazione salvata con successo');
      },
      onError: (error: any) => {
        toast.error('Errore durante il salvataggio', {
          description: error.message,
        });
      },
    });

  const testConnectionQuery = trpc.integrations.storage.testConnection.useQuery(
    { provider },
    {
      enabled: false,
    }
  );

  useEffect(() => {
    if (testConnectionQuery.data) {
      setTestResult(testConnectionQuery.data);
    }
    if (testConnectionQuery.error) {
      setTestResult({
        success: false,
        message: testConnectionQuery.error.message,
      });
    }
  }, [testConnectionQuery.data, testConnectionQuery.error]);

  const handleSaveExternalConfig = () => {
    const config = provider === 'smb' ? smbConfig : driveConfig;
    saveExternalConfigMutation.mutate({ provider, config });
  };

  const handleTestConnection = () => {
    setTestResult(null);
    testConnectionQuery.refetch();
  };

  // ========== RENDER ==========

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Caricamento...</div>
      </div>
    );
  }

  if (session?.user?.role !== 'admin') {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          ⚠️ Solo gli amministratori possono accedere a questa pagina.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurazione Storage"
        description="Gestisci lo storage locale e le integrazioni con provider esterni"
      />

      <Tabs defaultValue="local" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="local">Storage Locale</TabsTrigger>
          <TabsTrigger value="external">Provider Esterni</TabsTrigger>
        </TabsList>

        {/* TAB 1: Storage Locale */}
        <TabsContent value="local" className="space-y-6">
          <SectionCard
            title="Impostazioni Storage Locale"
            description="Configura il provider di storage locale per il salvataggio dei file sul filesystem"
          >
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmitLocal)}
                className="space-y-6"
              >
                {/* Base Path */}
                <FormField
                  control={form.control}
                  name="basePath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Path Base</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="/var/lib/luke/storage"
                          disabled={
                            isLoadingConfig || saveConfigMutation.isPending
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Directory base dove verranno salvati i file. La
                        directory verrà creata automaticamente con permessi
                        0700.
                        <br />
                        <strong>Sviluppo:</strong> /tmp/luke-storage
                        <br />
                        <strong>Produzione:</strong> /var/lib/luke/storage
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Max File Size */}
                <FormField
                  control={form.control}
                  name="maxFileSizeMB"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dimensione Massima File (MB)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={1}
                          max={1000}
                          disabled={
                            isLoadingConfig || saveConfigMutation.isPending
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Dimensione massima per ogni file caricato (1-1000 MB).
                        Default: 50 MB
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Buckets */}
                <FormField
                  control={form.control}
                  name="buckets"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bucket Abilitati</FormLabel>
                      <div className="space-y-2">
                        {(['uploads', 'exports', 'assets'] as const).map(
                          bucket => (
                            <label
                              key={bucket}
                              className="flex items-center space-x-2"
                            >
                              <input
                                type="checkbox"
                                checked={field.value?.includes(bucket)}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  const current = field.value || [];
                                  field.onChange(
                                    checked
                                      ? [...current, bucket]
                                      : current.filter(b => b !== bucket)
                                  );
                                }}
                                disabled={
                                  isLoadingConfig ||
                                  saveConfigMutation.isPending
                                }
                                className="rounded border-gray-300"
                              />
                              <span className="capitalize">{bucket}</span>
                            </label>
                          )
                        )}
                      </div>
                      <FormDescription>
                        Seleziona i bucket logici da abilitare:
                        <br />- <strong>uploads</strong>: File caricati dagli
                        utenti
                        <br />- <strong>exports</strong>: File esportati dal
                        sistema
                        <br />- <strong>assets</strong>: Asset statici e risorse
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Info aggiuntive */}
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                  <h4 className="mb-2 font-semibold">ℹ️ Informazioni</h4>
                  <ul className="list-inside list-disc space-y-1">
                    <li>
                      I file verranno organizzati per data: YYYY/MM/DD/
                      {'<uuid>'}
                    </li>
                    <li>
                      Le chiavi sono generate server-side (nessun path
                      traversal)
                    </li>
                    <li>Checksum SHA-256 calcolato automaticamente</li>
                    <li>
                      Download tramite token firmati HMAC (validi 5 minuti)
                    </li>
                    <li>Atomic writes con protezione contro errori</li>
                  </ul>
                </div>

                {/* Pulsanti */}
                <div className="flex justify-end space-x-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => form.reset()}
                    disabled={isLoadingConfig || saveConfigMutation.isPending}
                  >
                    Reset
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoadingConfig || saveConfigMutation.isPending}
                  >
                    {saveConfigMutation.isPending
                      ? 'Salvataggio...'
                      : 'Salva Configurazione'}
                  </Button>
                </div>
              </form>
            </Form>
          </SectionCard>

          {/* Statistiche Storage Locale */}
          <SectionCard
            title="Statistiche Storage"
            description="Informazioni sull'utilizzo dello storage locale"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border bg-card p-4">
                  <div className="text-sm text-muted-foreground">Path</div>
                  <div className="mt-1 font-mono text-sm">
                    {existingConfig?.basePath || '-'}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <div className="text-sm text-muted-foreground">
                    Limite Size
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {existingConfig?.maxFileSizeMB || 0} MB
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <div className="text-sm text-muted-foreground">
                    Bucket Attivi
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {existingConfig?.buckets?.length || 0}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-300">
                <strong>⚠️ Nota:</strong> Dopo aver modificato la
                configurazione, riavvia l&apos;applicazione per applicare le
                modifiche.
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* TAB 2: Provider Esterni */}
        <TabsContent value="external" className="space-y-6">
          <SectionCard
            title={
              provider === 'smb'
                ? 'Configurazione SMB/Samba'
                : 'Configurazione Google Drive'
            }
            description={
              provider === 'smb'
                ? 'Imposta la connessione SMB/Samba per storage remoto'
                : "Configura l'integrazione OAuth con Google Drive"
            }
          >
            <div className="space-y-6">
              {/* Selezione Provider */}
              <div className="space-y-3">
                <Label>Provider Storage</Label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="radio"
                      value="smb"
                      checked={provider === 'smb'}
                      onChange={(e: any) =>
                        setProvider(e.target.value as Provider)
                      }
                      className="rounded"
                    />
                    <span>SMB/Samba</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="radio"
                      value="drive"
                      checked={provider === 'drive'}
                      onChange={(e: any) =>
                        setProvider(e.target.value as Provider)
                      }
                      className="rounded"
                    />
                    <span>Google Drive</span>
                  </label>
                </div>
              </div>

              {/* Configurazione SMB */}
              {provider === 'smb' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="smb-host">Host</Label>
                      <Input
                        id="smb-host"
                        value={smbConfig.host}
                        onChange={(e: any) =>
                          setSmbConfig({ ...smbConfig, host: e.target.value })
                        }
                        placeholder="es. 192.168.1.100"
                      />
                    </div>
                    <div>
                      <Label htmlFor="smb-path">Share Path</Label>
                      <Input
                        id="smb-path"
                        value={smbConfig.path}
                        onChange={(e: any) =>
                          setSmbConfig({ ...smbConfig, path: e.target.value })
                        }
                        placeholder="es. /shared/folder"
                      />
                    </div>
                    <div>
                      <Label htmlFor="smb-username">Username</Label>
                      <Input
                        id="smb-username"
                        value={smbConfig.username}
                        onChange={(e: any) =>
                          setSmbConfig({
                            ...smbConfig,
                            username: e.target.value,
                          })
                        }
                        placeholder="Username SMB"
                      />
                    </div>
                    <div>
                      <Label htmlFor="smb-password">Password</Label>
                      <Input
                        id="smb-password"
                        type="password"
                        value={smbConfig.password}
                        onChange={(e: any) =>
                          setSmbConfig({
                            ...smbConfig,
                            password: e.target.value,
                          })
                        }
                        placeholder="Password SMB"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Configurazione Google Drive */}
              {provider === 'drive' && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="drive-client-id">Client ID</Label>
                    <Input
                      id="drive-client-id"
                      value={driveConfig.clientId}
                      onChange={(e: any) =>
                        setDriveConfig({
                          ...driveConfig,
                          clientId: e.target.value,
                        })
                      }
                      placeholder="Google OAuth Client ID"
                    />
                  </div>
                  <div>
                    <Label htmlFor="drive-client-secret">Client Secret</Label>
                    <Input
                      id="drive-client-secret"
                      type="password"
                      value={driveConfig.clientSecret}
                      onChange={(e: any) =>
                        setDriveConfig({
                          ...driveConfig,
                          clientSecret: e.target.value,
                        })
                      }
                      placeholder="Google OAuth Client Secret"
                    />
                  </div>
                  <div>
                    <Label htmlFor="drive-refresh-token">Refresh Token</Label>
                    <Input
                      id="drive-refresh-token"
                      type="password"
                      value={driveConfig.refreshToken}
                      onChange={(e: any) =>
                        setDriveConfig({
                          ...driveConfig,
                          refreshToken: e.target.value,
                        })
                      }
                      placeholder="Google OAuth Refresh Token"
                    />
                  </div>
                </div>
              )}

              {/* Pulsanti Azione */}
              <div className="flex space-x-4">
                <Button
                  onClick={handleSaveExternalConfig}
                  disabled={saveExternalConfigMutation.isPending}
                  className="flex-1"
                >
                  {saveExternalConfigMutation.isPending
                    ? 'Salvataggio...'
                    : 'Salva Configurazione'}
                </Button>
                <Button
                  onClick={handleTestConnection}
                  disabled={testConnectionQuery.isFetching}
                  variant="outline"
                  className="flex-1"
                >
                  {testConnectionQuery.isFetching
                    ? 'Test...'
                    : 'Test Connessione'}
                </Button>
              </div>

              {/* Risultato Test */}
              {testResult && (
                <div
                  className={`p-4 rounded-md ${
                    testResult.success
                      ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900'
                      : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900'
                  }`}
                >
                  <p className="font-medium">
                    {testResult.success ? '✅' : '❌'} {testResult.message}
                  </p>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Info Provider Esterni */}
          <SectionCard
            title="Informazioni Provider Esterni"
            description="Note sulle integrazioni con storage remoti"
          >
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
              <h4 className="mb-2 font-semibold">ℹ️ Provider Disponibili</h4>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <strong>SMB/Samba</strong>: Connessione a share di rete
                  Windows o Samba
                </li>
                <li>
                  <strong>Google Drive</strong>: Salvataggio su Google Drive
                  tramite API OAuth
                </li>
                <li>
                  I provider esterni sono in fase di sviluppo e potrebbero
                  richiedere configurazioni aggiuntive
                </li>
              </ul>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
