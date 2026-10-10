'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { BackupScheduleConfigSchema, type BackupScheduleConfig } from '@luke/core';

import { usePermission } from '../../hooks/usePermission';
import { trpc } from '../../lib/trpc';
import { getTrpcErrorMessage } from '../../lib/trpcErrorMessages';
import { SectionCard } from '../SectionCard';
import { KeyValueGrid } from '../settings/KeyValueGrid';
import { SettingsActions } from '../settings/SettingsActions';
import { RetryButton } from '../system/RetryButton';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { Switch } from '../ui/switch';

// The scheduler tick is hourly (see apps/api/src/lib/backupScheduler.ts) — offering minute
// precision here would silently lie about what the backend actually honors.
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => `${h.toString().padStart(2, '0')}:00`);

/** Admin card to configure automatic backup scheduling, retention and failure notices (`backup.schedule.*`, `backup.retention*`, `backup.notifyOnFailure`). */
export function BackupScheduleCard() {
  // `isPending`, not `isLoading`: a query paused offline has neither data nor an error yet.
  const { data, isPending, error, refetch } = trpc.maintenance.backup.getScheduleConfig.useQuery();

  return (
    <SectionCard
      title="Backup automatici"
      description="Pianifica un backup giornaliero e configura per quanto tempo mantenere i backup completati"
    >
      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : data ? (
        <BackupScheduleForm stored={data} />
      ) : (
        // No form without the stored schedule: saving placeholders would overwrite it.
        <Alert variant="destructive" className="space-y-3">
          <AlertTitle>Impossibile caricare la pianificazione dei backup</AlertTitle>
          <AlertDescription>{getTrpcErrorMessage(error)}</AlertDescription>
          <RetryButton onRetry={() => void refetch()} />
        </Alert>
      )}
    </SectionCard>
  );
}

/** The schedule form, filled from the stored settings and kept in step with them after a save. */
function BackupScheduleForm({ stored }: { stored: BackupScheduleConfig }) {
  const { can } = usePermission();
  const canUpdate = can('maintenance:update');
  const utils = trpc.useUtils();

  const form = useForm<BackupScheduleConfig>({
    resolver: zodResolver(BackupScheduleConfigSchema),
    values: stored,
    // A refetch (the one after a save) must not discard what the admin is still editing.
    resetOptions: { keepDirtyValues: true },
  });
  // A time written through the API on a minute the list does not offer stays visible as stored.
  const hourOptions = HOUR_OPTIONS.includes(stored.dailyTime) ? HOUR_OPTIONS : [...HOUR_OPTIONS, stored.dailyTime].sort();

  const saveMutation = trpc.maintenance.backup.updateScheduleConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione backup automatici salvata');
      void utils.maintenance.backup.getScheduleConfig.invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const onSubmit = (values: BackupScheduleConfig) => saveMutation.mutate(values);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <FormLabel>Backup automatici attivi</FormLabel>
                <FormDescription>
                  Se disattivo, i backup vanno creati manualmente dalla tabella sopra
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canUpdate} />
              </FormControl>
            </FormItem>
          )}
        />

        <KeyValueGrid cols={2}>
          <FormField
            control={form.control}
            name="dailyTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Orario giornaliero</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!canUpdate}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {hourOptions.map(hour => (
                      <SelectItem key={hour} value={hour}>{hour}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Ora a cui parte il backup pianificato, nel fuso orario aziendale (Impostazioni → Azienda)</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="scope"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contenuto</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!canUpdate}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="DB">Solo DB</SelectItem>
                    <SelectItem value="DB_AND_FILES">DB + file</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="retentionDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Retention (giorni)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    {...field}
                    onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)}
                    disabled={!canUpdate}
                  />
                </FormControl>
                <FormDescription>Dopo quanti giorni un backup completato diventa eliminabile</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="retentionMinCount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Minimo da conservare</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    {...field}
                    onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)}
                    disabled={!canUpdate}
                  />
                </FormControl>
                <FormDescription>Numero minimo di backup completati mai eliminati, anche se scaduti</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </KeyValueGrid>

        <FormField
          control={form.control}
          name="notifyOnFailure"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <FormLabel>Notifica admin su fallimento</FormLabel>
                <FormDescription>
                  Invia una notifica in-app a tutti gli admin se il backup pianificato fallisce
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canUpdate} />
              </FormControl>
            </FormItem>
          )}
        />

        <SettingsActions
          onSave={form.handleSubmit(onSubmit)}
          isSaving={saveMutation.isPending}
          disabled={!canUpdate}
        />
      </form>
    </Form>
  );
}
