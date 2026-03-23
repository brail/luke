'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { navConfigSchema, type NavConfigInput } from '@luke/core';

import { SectionCard } from '../../../../components/SectionCard';
import { KeyValueGrid } from '../../../../components/settings/KeyValueGrid';
import { SensitiveField } from '../../../../components/settings/SensitiveField';
import { SettingsActions } from '../../../../components/settings/SettingsActions';
import { SettingsFormShell } from '../../../../components/settings/SettingsFormShell';
import { TestStatusBanner } from '../../../../components/settings/TestStatusBanner';
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
import { Switch } from '../../../../components/ui/switch';
import { useToast } from '../../../../hooks/use-toast';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';

export default function NavSettingsPage() {
  const toast = useToast();
  const { can } = usePermission();
  const canUpdate = can('config:update');
  const [hasPassword, setHasPassword] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const form = useForm<NavConfigInput>({
    resolver: zodResolver(navConfigSchema),
    defaultValues: {
      host: '',
      port: 1433,
      database: '',
      user: '',
      password: '',
      company: '',
      syncIntervalMinutes: 30,
      readOnly: true,
    },
  });

  const { data: existingConfigs, isLoading } = trpc.config.list.useQuery({
    page: 1,
    pageSize: 100,
  });

  useEffect(() => {
    if (existingConfigs) {
      const configs = existingConfigs.items;
      const find = (key: string) => configs.find((c: any) => c.key === key);

      const host = find('integrations.nav.host');
      const port = find('integrations.nav.port');
      const database = find('integrations.nav.database');
      const user = find('integrations.nav.user');
      const password = find('integrations.nav.password');
      const company = find('integrations.nav.company');
      const syncIntervalMinutes = find('integrations.nav.syncIntervalMinutes');
      const readOnly = find('integrations.nav.readOnly');

      form.reset({
        host: host?.valuePreview || '',
        port: port?.valuePreview ? parseInt(port.valuePreview) : 1433,
        database: database?.valuePreview || '',
        user: user?.valuePreview || '',
        password: '',
        company: company?.valuePreview || '',
        syncIntervalMinutes: syncIntervalMinutes?.valuePreview
          ? parseInt(syncIntervalMinutes.valuePreview)
          : 30,
        readOnly: readOnly?.valuePreview !== 'false',
      });

      setHasPassword(!!password);
    }
  }, [existingConfigs, form]);

  const saveConfigMutation = trpc.integrations.nav.saveConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione NAV salvata con successo');
      setHasPassword(true);
      setTestStatus('idle');
      setTestMessage('');
    },
    onError: (error: any) => {
      toast.error('Errore durante il salvataggio', { description: error.message });
    },
  });

  const testConnectionMutation = trpc.integrations.nav.testConnection.useMutation({
    onSuccess: (data: any) => {
      setTestStatus('success');
      setTestMessage(data.message);
      toast.success('Connessione riuscita');
    },
    onError: (error: any) => {
      setTestStatus('error');
      setTestMessage(error.message);
      toast.error('Test fallito', { description: error.message });
    },
  });

  const onSubmit = (data: NavConfigInput) => {
    const { password, ...rest } = data;
    const payload = !password || password.trim() === '' ? rest : data;
    saveConfigMutation.mutate(payload as NavConfigInput);
  };

  const handleTestConnection = () => {
    setTestStatus('idle');
    setTestMessage('');
    testConnectionMutation.mutate();
  };

  return (
    <SettingsFormShell
      title="Configurazione Microsoft NAV"
      description="Gestisci la connessione a Microsoft Dynamics NAV tramite SQL Server"
      isLoading={isLoading}
    >
      <SectionCard
        title="Connessione SQL Server"
        description="Parametri di accesso al database NAV"
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <KeyValueGrid cols={2}>
              {/* Host */}
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Host <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="es. 192.168.1.32" {...field} />
                    </FormControl>
                    <FormDescription>Indirizzo IP o hostname del server SQL</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Porta */}
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Porta <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="1433"
                        {...field}
                        onChange={e => field.onChange(parseInt(e.target.value) || 1433)}
                      />
                    </FormControl>
                    <FormDescription>Porta SQL Server (default: 1433)</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Database */}
              <FormField
                control={form.control}
                name="database"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Database <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="es. NAV_DATABASE" {...field} />
                    </FormControl>
                    <FormDescription>Nome del database NAV su SQL Server</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Utente */}
              <FormField
                control={form.control}
                name="user"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Utente SQL <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="es. nav_user" {...field} />
                    </FormControl>
                    <FormDescription>Utente per l&apos;autenticazione SQL Server</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </KeyValueGrid>

            {/* Password */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <SensitiveField
                  label={
                    <>
                      Password SQL{' '}
                      {!hasPassword && <span className="text-red-500">*</span>}
                    </>
                  }
                  hasValue={hasPassword}
                  placeholder={hasPassword ? undefined : 'Password utente SQL Server'}
                  field={field}
                />
              )}
            />

            <KeyValueGrid cols={2}>
              {/* Company */}
              <FormField
                control={form.control}
                name="company"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Company NAV <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="es. MYCOMPANY" {...field} />
                    </FormControl>
                    <FormDescription>Prefisso tabelle NAV (es. MYCOMPANY$Item)</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Intervallo sync */}
              <FormField
                control={form.control}
                name="syncIntervalMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Intervallo Sync (minuti) <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="30"
                        {...field}
                        onChange={e => field.onChange(parseInt(e.target.value) || 30)}
                      />
                    </FormControl>
                    <FormDescription>Frequenza di sincronizzazione dati da NAV</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </KeyValueGrid>

            {/* Sola lettura */}
            <FormField
              control={form.control}
              name="readOnly"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>Modalità sola lettura</FormLabel>
                    <FormDescription>
                      Se attivo, le query verso NAV sono limitate a operazioni SELECT. Raccomandato finché l&apos;integrazione non è verificata.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!canUpdate}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset()}
                disabled={saveConfigMutation.isPending || !canUpdate}
              >
                Reset
              </Button>
              <Button
                type="submit"
                disabled={saveConfigMutation.isPending || !canUpdate}
              >
                {saveConfigMutation.isPending ? 'Salvataggio...' : 'Salva Configurazione'}
              </Button>
            </div>
          </form>
        </Form>
      </SectionCard>

      {/* Test connessione */}
      <SectionCard
        title="Test Connessione"
        description="Verifica che il server SQL Server sia raggiungibile sulla porta configurata"
      >
        <div className="space-y-4">
          <SettingsActions
            onTest={handleTestConnection}
            isTesting={testConnectionMutation.isPending}
            disabled={
              testConnectionMutation.isPending || !form.watch('host') || !canUpdate
            }
          />
          <p className="text-sm text-muted-foreground">
            Il test verifica la raggiungibilità TCP di{' '}
            <code className="rounded bg-muted px-1 py-0.5">
              {form.watch('host') || '(host non configurato)'}:{form.watch('port') || 1433}
            </code>
            . Salva la configurazione prima di testare.
          </p>
          <TestStatusBanner status={testStatus} message={testMessage} />
        </div>
      </SectionCard>
    </SettingsFormShell>
  );
}
