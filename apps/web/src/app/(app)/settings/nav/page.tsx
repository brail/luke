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
      readOnly: true,
      syncEnabled: false,
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
      const readOnly = find('integrations.nav.readOnly');
      const syncEnabled = find('integrations.nav.syncEnabled');

      form.reset({
        host: host?.valuePreview || '',
        port: port?.valuePreview ? parseInt(port.valuePreview) : 1433,
        database: database?.valuePreview || '',
        user: user?.valuePreview || '',
        password: '',
        company: company?.valuePreview || '',
        readOnly: readOnly?.valuePreview !== 'false',
        syncEnabled: syncEnabled?.valuePreview === 'true',
      });

      setHasPassword(!!password);
    }
  }, [existingConfigs, form]);

  const saveConfigMutation = trpc.integrations.nav.saveConfig.useMutation({
    onSuccess: (data: any) => {
      setHasPassword(true);
      setTestStatus('idle');
      setTestMessage('');
      if (data.connectionChanged) {
        toast.warning('Configurazione salvata — connessione cambiata', {
          description:
            'I parametri di connessione sono cambiati. Verifica i filtri di sync in Admin › Sincronizzazione NAV.',
        });
      } else {
        toast.success('Configurazione NAV salvata con successo');
      }
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

            {/* Sola lettura */}
            <FormField
              control={form.control}
              name="readOnly"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>Modalità sola lettura</FormLabel>
                    <FormDescription>
                      Se attivo, la connessione SQL Server usa <code className="rounded bg-muted px-1 py-0.5 text-xs">ApplicationIntent=ReadOnly</code> (ottimale con SQL Server AG).
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

            {/* Sync abilitato */}
            <FormField
              control={form.control}
              name="syncEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>Sincronizzazione abilitata</FormLabel>
                    <FormDescription>
                      Abilita globalmente la replica NAV → database locale. Disabilita per mettere in pausa tutti i sync senza modificare gli altri parametri.
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
        description="Verifica autenticazione SQL Server, accesso al database e nome Company"
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
            Il test apre una connessione reale a SQL Server e verifica: credenziali, database{' '}
            <code className="rounded bg-muted px-1 py-0.5">{form.watch('database') || '…'}</code>{' '}
            e tabella{' '}
            <code className="rounded bg-muted px-1 py-0.5">
              {form.watch('company') ? `[${form.watch('company')}$Vendor]` : '[COMPANY$Vendor]'}
            </code>
            . Salva la configurazione prima di testare.
          </p>
          <TestStatusBanner status={testStatus} message={testMessage} />
        </div>
      </SectionCard>
    </SettingsFormShell>
  );
}
