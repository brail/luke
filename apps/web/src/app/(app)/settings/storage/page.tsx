'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
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
import { RadioGroup, RadioGroupItem } from '../../../../components/ui/radio-group';
import { Switch } from '../../../../components/ui/switch';
import { usePermission } from '../../../../hooks/usePermission';
import { useRefresh } from '../../../../lib/refresh';
import { trpc } from '../../../../lib/trpc';
import { useStandardMutation } from '../../../../lib/useStandardMutation';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_BUCKETS = [
  { value: 'uploads',                        description: 'File caricati dagli utenti' },
  { value: 'exports',                        description: 'File esportati dal sistema' },
  { value: 'assets',                         description: 'Asset statici e risorse' },
  { value: 'brand-logos',                    description: 'Logo brand' },
  { value: 'collection-row-pictures',        description: 'Foto righe collection layout' },
  { value: 'merchandising-specsheet-images', description: 'Immagini specsheet merchandising' },
] as const;

type BucketValue = typeof ALL_BUCKETS[number]['value'];

// ─── Schema ───────────────────────────────────────────────────────────────────

const localSchema = z.object({
  type: z.literal('local'),
  basePath: z
    .string()
    .min(1, 'Path richiesto')
    .regex(
      /^(\/|~\/)[a-zA-Z0-9_./-]*$/,
      'Path deve iniziare con / oppure ~/'
    ),
  maxFileSizeMB: z.coerce.number().int().min(1).max(1000),
  buckets: z.array(z.string()).min(1, 'Almeno un bucket richiesto'),
  enableProxy: z.boolean(),
});

const minioSchema = z.object({
  type: z.literal('minio'),
  endpoint: z.string().min(1, 'Endpoint richiesto'),
  port: z.coerce.number().int().min(1).max(65535),
  useSSL: z.boolean(),
  accessKey: z.string().min(1, 'Access key richiesta'),
  secretKey: z.string().min(1, 'Secret key richiesta'),
  region: z.string().min(1, 'Region richiesta'),
  publicBaseUrl: z.string().url('URL non valido').or(z.literal('')).optional(),
  presignedPutTtl: z.coerce.number().int().min(60).max(86400),
  presignedGetTtl: z.coerce.number().int().min(60).max(86400),
});

const formSchema = z.discriminatedUnion('type', [localSchema, minioSchema]);
type StorageForm = z.infer<typeof formSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoragePage() {
  const { status } = useSession();
  const refresh = useRefresh();
  const { can } = usePermission();
  const canUpdate = can('config:update');

  const { data: config, isLoading } = trpc.storage.getConfig.useQuery(undefined);

  const saveConfigMutation = trpc.storage.saveConfig.useMutation();
  const { mutate: saveConfig, isPending: isSaving } = useStandardMutation({
    mutateFn: saveConfigMutation.mutateAsync,
    invalidate: refresh.storageConfig,
    onSuccessMessage: 'Configurazione storage salvata',
    onErrorMessage: 'Errore durante il salvataggio',
  });

  const [testResult, setTestResult] = useState<{ success: boolean; message: string; presignedUrlBase?: string } | null>(null);
  const testMutation = trpc.storage.testMinioConnection.useMutation();
  const handleTestConnection = async () => {
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync();
      setTestResult({ success: true, message: result.message, presignedUrlBase: result.presignedUrlBase });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connessione fallita';
      setTestResult({ success: false, message: msg });
    }
  };

  const form = useForm<StorageForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: 'local',
      basePath: '',
      maxFileSizeMB: 50,
      buckets: ALL_BUCKETS.map(b => b.value),
      enableProxy: true,
    },
  });

  const storageType = form.watch('type');

  useEffect(() => {
    if (!config) return;
    if (config.type === 'minio') {
      form.reset({
        type: 'minio',
        endpoint: config.minio.endpoint,
        port: config.minio.port,
        useSSL: config.minio.useSSL,
        accessKey: config.minio.accessKey,
        secretKey: config.minio.secretKey,
        region: config.minio.region,
        publicBaseUrl: config.minio.publicBaseUrl || '',
        presignedPutTtl: config.minio.presignedPutTtl,
        presignedGetTtl: config.minio.presignedGetTtl,
      });
    } else {
      form.reset({
        type: 'local',
        basePath: config.local.basePath,
        maxFileSizeMB: config.local.maxFileSizeMB,
        buckets: config.local.buckets as BucketValue[],
        enableProxy: config.local.enableProxy,
      });
    }
  }, [config, form]);

  const disabled = !canUpdate || isLoading || isSaving;

  if (status === 'loading') {
    return <div className="flex items-center justify-center p-8 text-muted-foreground">Caricamento...</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurazione Storage"
        description="Gestisci il provider di storage per il salvataggio dei file"
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(data => saveConfig(data as any))} className="space-y-6">

          {/* ── Provider selector ─────────────────────────────────────────── */}
          <SectionCard title="Provider Storage" description="Seleziona il backend di storage da utilizzare">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={(val: string) => {
                        if (val === 'local' || val === 'minio') {
                          if (val === 'local') {
                            form.reset({
                              type: 'local',
                              basePath: config?.local.basePath || '',
                              maxFileSizeMB: config?.local.maxFileSizeMB ?? 50,
                              buckets: (config?.local.buckets as BucketValue[]) ?? ALL_BUCKETS.map(b => b.value),
                              enableProxy: config?.local.enableProxy ?? true,
                            });
                          } else {
                            form.reset({
                              type: 'minio',
                              endpoint: config?.minio.endpoint || 'minio',
                              port: config?.minio.port ?? 9000,
                              useSSL: config?.minio.useSSL ?? false,
                              accessKey: config?.minio.accessKey || '',
                              secretKey: config?.minio.secretKey || '',
                              region: config?.minio.region || 'us-east-1',
                              publicBaseUrl: config?.minio.publicBaseUrl || '',
                              presignedPutTtl: config?.minio.presignedPutTtl ?? 3600,
                              presignedGetTtl: config?.minio.presignedGetTtl ?? 3600,
                            });
                          }
                        }
                      }}
                      disabled={disabled}
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    >
                      <Label
                        htmlFor="type-local"
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                          storageType === 'local' ? 'border-primary bg-primary/5' : 'border-border'
                        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <RadioGroupItem value="local" id="type-local" className="mt-0.5" />
                        <div>
                          <div className="font-medium">Filesystem locale</div>
                          <div className="text-sm text-muted-foreground">
                            File salvati sul disco del server. Adatto a sviluppo o installazioni single-server.
                          </div>
                        </div>
                      </Label>
                      <Label
                        htmlFor="type-minio"
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                          storageType === 'minio' ? 'border-primary bg-primary/5' : 'border-border'
                        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <RadioGroupItem value="minio" id="type-minio" className="mt-0.5" />
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            MinIO (S3-compatible)
                            <Badge variant="secondary" className="text-xs">Raccomandato</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Object storage enterprise. Supporta upload presigned direttamente dal browser.
                          </div>
                        </div>
                      </Label>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SectionCard>

          {/* ── Local config ──────────────────────────────────────────────── */}
          {storageType === 'local' && (
            <SectionCard title="Filesystem locale" description="Configurazione del provider locale">
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="basePath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Path base</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="~/.luke/storage" disabled={disabled} />
                      </FormControl>
                      <FormDescription>
                        Directory radice dove vengono salvati i file. Viene creata automaticamente con permessi 0700.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxFileSizeMB"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dimensione massima file (MB)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={1} max={1000} disabled={disabled} className="w-32" />
                      </FormControl>
                      <FormDescription>Range: 1 – 1000 MB. Default: 50 MB.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enableProxy"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <FormLabel>Proxy Next.js</FormLabel>
                        <FormDescription>
                          Se attivo, le immagini vengono servite tramite <code>/api/uploads/…</code> (sviluppo).
                          Disabilitare in produzione quando l'API è accessibile direttamente.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} disabled={disabled} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="buckets"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bucket abilitati</FormLabel>
                      <div className="mt-2 space-y-2">
                        {ALL_BUCKETS.map(({ value, description }) => (
                          <div key={value} className="flex items-center space-x-2">
                            <Checkbox
                              id={`bucket-${value}`}
                              checked={field.value?.includes(value)}
                              onCheckedChange={checked => {
                                const current = field.value || [];
                                field.onChange(checked ? [...current, value] : current.filter(b => b !== value));
                              }}
                              disabled={disabled}
                            />
                            <Label htmlFor={`bucket-${value}`} className="cursor-pointer font-normal">
                              <span className="font-mono text-sm">{value}</span>
                              <span className="ml-2 text-muted-foreground">{description}</span>
                            </Label>
                          </div>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>
          )}

          {/* ── MinIO config ──────────────────────────────────────────────── */}
          {storageType === 'minio' && (
            <>
              <SectionCard title="Connessione MinIO" description="Parametri di connessione al server MinIO">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="endpoint"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Endpoint</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="minio" disabled={disabled} />
                          </FormControl>
                          <FormDescription>Hostname o IP del server MinIO (senza protocollo).</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="port"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Porta</FormLabel>
                          <FormControl>
                            <Input {...field} type="number" min={1} max={65535} disabled={disabled} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="region"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Region</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="us-east-1" disabled={disabled} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="useSSL"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-3">
                          <div>
                            <FormLabel>HTTPS / TLS</FormLabel>
                            <FormDescription>Attiva se MinIO usa SSL.</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} disabled={disabled} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Credenziali MinIO" description="Access key e secret key (cifrate in DB)">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="accessKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Access Key</FormLabel>
                        <FormControl>
                          <Input {...field} autoComplete="off" disabled={disabled} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="secretKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secret Key</FormLabel>
                        <FormControl>
                          <Input {...field} type="password" autoComplete="new-password" disabled={disabled} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </SectionCard>

              <SectionCard title="URL pubblici e presigned" description="Configurazione URL per file pubblici e upload diretti">
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="publicBaseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Public Base URL</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="https://minio.example.com"
                            disabled={disabled}
                          />
                        </FormControl>
                        <FormDescription>
                          URL base per i bucket pubblici (brand-logos, collection-row-pictures).
                          Se vuoto, viene costruito dall'endpoint e porta.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="presignedPutTtl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>TTL presigned PUT (secondi)</FormLabel>
                          <FormControl>
                            <Input {...field} type="number" min={60} max={86400} disabled={disabled} />
                          </FormControl>
                          <FormDescription>Validità URL per upload diretto. Default: 3600 (1h).</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="presignedGetTtl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>TTL presigned GET (secondi)</FormLabel>
                          <FormControl>
                            <Input {...field} type="number" min={60} max={86400} disabled={disabled} />
                          </FormControl>
                          <FormDescription>Validità URL per download firmati. Default: 3600 (1h).</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </SectionCard>
            </>
          )}

          {/* ── MinIO test connection ─────────────────────────────────────── */}
          {storageType === 'minio' && (
            <SectionCard title="Test connessione" description="Verifica la connettività con il server MinIO salvato">
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? 'Test in corso…' : 'Testa connessione MinIO'}
                </Button>
                {testResult && (
                  <div className={`rounded-lg border p-3 text-sm ${testResult.success ? 'border-green-500/30 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300' : 'border-red-500/30 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
                    <div className="font-medium">{testResult.success ? '✓' : '✗'} {testResult.message}</div>
                    {testResult.success && testResult.presignedUrlBase && (
                      <div className="mt-1 text-xs opacity-80">
                        URL presigned generati da: <code className="font-mono">{testResult.presignedUrlBase}</code>
                        {testResult.presignedUrlBase.includes('minio') && (
                          <span className="ml-2 text-amber-700 dark:text-amber-400">⚠ hostname Docker non raggiungibile dal browser — imposta Public Base URL</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => form.reset()}
              disabled={disabled}
            >
              Reset
            </Button>
            <Button type="submit" disabled={disabled}>
              {isSaving ? 'Salvataggio…' : 'Salva configurazione'}
            </Button>
          </div>
        </form>
      </Form>

      {/* ── Status card ─────────────────────────────────────────────────── */}
      {config && (
        <SectionCard title="Stato attuale" description="Riepilogo della configurazione in uso">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-card p-3">
              <div className="text-xs text-muted-foreground">Provider</div>
              <div className="mt-1 font-semibold capitalize">{config.type}</div>
            </div>
            {config.type === 'local' ? (
              <>
                <div className="rounded-lg border bg-card p-3 sm:col-span-2">
                  <div className="text-xs text-muted-foreground">Path</div>
                  <div className="mt-1 font-mono text-sm truncate">{config.local.basePath}</div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Max size</div>
                  <div className="mt-1 font-semibold">{config.local.maxFileSizeMB} MB</div>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Endpoint (interno)</div>
                  <div className="mt-1 font-mono text-sm">
                    {config.minio.useSSL ? 'https' : 'http'}://{config.minio.endpoint}:{config.minio.port}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Public Base URL (browser)</div>
                  <div className="mt-1 font-mono text-sm truncate">
                    {config.minio.publicBaseUrl || <span className="text-muted-foreground italic">non impostato</span>}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Region</div>
                  <div className="mt-1 font-semibold">{config.minio.region}</div>
                </div>
              </>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
