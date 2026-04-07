'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';
import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
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
import { usePermission } from '../../../../hooks/usePermission';
import { useRefresh } from '../../../../lib/refresh';
import { trpc } from '../../../../lib/trpc';
import { useStandardMutation } from '../../../../lib/useStandardMutation';

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

export default function StoragePage() {
  const { status } = useSession();
  const refresh = useRefresh();
  const { can } = usePermission();
  const canUpdate = can('config:update');

  const form = useForm<StorageConfigForm>({
    resolver: zodResolver(storageConfigFormSchema),
    defaultValues: {
      basePath: '',
      maxFileSizeMB: 50,
      buckets: ['uploads', 'exports', 'assets'],
    },
  });

  const { data: existingConfig, isLoading: isLoadingConfig } =
    trpc.storage.getConfig.useQuery(undefined);

  const saveConfigMutation = trpc.storage.saveConfig.useMutation();

  const { mutate: saveStorageConfig, isPending: isSavingConfig } =
    useStandardMutation({
      mutateFn: saveConfigMutation.mutateAsync,
      invalidate: refresh.storageConfig,
      onSuccessMessage: 'Configurazione storage salvata con successo',
      onErrorMessage: 'Errore durante il salvataggio',
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

  const onSubmit = (data: StorageConfigForm) => {
    saveStorageConfig(data);
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Caricamento...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurazione Storage"
        description="Gestisci il provider di storage locale per il salvataggio dei file"
      />

      <SectionCard
        title="Impostazioni Storage Locale"
        description="Configura il provider di storage locale per il salvataggio dei file sul filesystem"
      >
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
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
                      disabled={!canUpdate || isLoadingConfig || isSavingConfig}
                    />
                  </FormControl>
                  <FormDescription>
                    Directory base dove verranno salvati i file. La
                    directory verrà creata automaticamente con permessi
                    0700.
                    <br />
                    <strong>Sviluppo:</strong> ~/.luke/storage
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
                      disabled={!canUpdate || isLoadingConfig || isSavingConfig}
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
                  <div className="space-y-3">
                    {([
                      { value: 'uploads', label: 'uploads', description: 'File caricati dagli utenti' },
                      { value: 'exports', label: 'exports', description: 'File esportati dal sistema' },
                      { value: 'assets',  label: 'assets',  description: 'Asset statici e risorse' },
                    ] as const).map(({ value, label, description }) => (
                      <div key={value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`bucket-${value}`}
                          checked={field.value?.includes(value)}
                          onCheckedChange={checked => {
                            const current = field.value || [];
                            field.onChange(
                              checked
                                ? [...current, value]
                                : current.filter(b => b !== value)
                            );
                          }}
                          disabled={!canUpdate || isLoadingConfig || isSavingConfig}
                        />
                        <Label
                          htmlFor={`bucket-${value}`}
                          className="cursor-pointer font-normal"
                        >
                          <span className="font-medium">{label}</span>
                          <span className="ml-2 text-muted-foreground">{description}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Info aggiuntive */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
              <h4 className="mb-2 font-semibold">Informazioni</h4>
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
                disabled={!canUpdate || isLoadingConfig || isSavingConfig}
              >
                Reset
              </Button>
              <Button
                type="submit"
                disabled={!canUpdate || isLoadingConfig || isSavingConfig}
              >
                {isSavingConfig ? 'Salvataggio...' : 'Salva Configurazione'}
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
            <strong>Nota:</strong> Dopo aver modificato il path base, il
            server applica la nuova configurazione automaticamente per i
            nuovi upload. I file esistenti restano nel path precedente.
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
