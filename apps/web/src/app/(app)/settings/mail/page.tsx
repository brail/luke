'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { mailSmtpConfigSchema, type MailSmtpConfigInput } from '@luke/core';

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
import { Label } from '../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { useToast } from '../../../../hooks/use-toast';
import { trpc } from '../../../../lib/trpc';

export default function MailPage() {
  const toast = useToast();
  const [hasPassword, setHasPassword] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>(
    'idle'
  );
  const [testMessage, setTestMessage] = useState<string>('');
  const [testEmail, setTestEmail] = useState('');

  // Form con react-hook-form e validazione Zod
  const form = useForm<MailSmtpConfigInput>({
    resolver: zodResolver(mailSmtpConfigSchema),
    defaultValues: {
      host: '',
      port: 587,
      secure: false,
      user: '',
      pass: '',
      from: '',
      baseUrl: 'http://localhost:3000',
    },
  });

  // Carica configurazione esistente
  const { data: existingConfigs, isLoading } = trpc.config.list.useQuery({
    page: 1,
    pageSize: 100,
  });

  useEffect(() => {
    if (existingConfigs) {
      const configs = existingConfigs.items;
      const smtpHost = configs.find((c: any) => c.key === 'smtp.host');
      const smtpPort = configs.find((c: any) => c.key === 'smtp.port');
      const smtpSecure = configs.find((c: any) => c.key === 'smtp.secure');
      const smtpUser = configs.find((c: any) => c.key === 'smtp.user');
      const smtpPass = configs.find((c: any) => c.key === 'smtp.pass');
      const smtpFrom = configs.find((c: any) => c.key === 'smtp.from');
      const appBaseUrl = configs.find((c: any) => c.key === 'app.baseUrl');

      form.reset({
        host: smtpHost?.valuePreview || '',
        port: smtpPort?.valuePreview ? parseInt(smtpPort.valuePreview) : 587,
        secure: smtpSecure?.valuePreview === 'true',
        user: smtpUser?.valuePreview || '',
        pass: '',
        from: smtpFrom?.valuePreview || '',
        baseUrl: appBaseUrl?.valuePreview || 'http://localhost:3000',
      });

      // Indica se la password è già configurata
      setHasPassword(!!smtpPass);
    }
  }, [existingConfigs, form]);

  const saveConfigMutation = trpc.integrations.mail.saveConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione SMTP salvata con successo');
      setHasPassword(true);
      setTestStatus('idle');
      setTestMessage('');
    },
    onError: (error: any) => {
      toast.error('Errore durante il salvataggio', {
        description: error.message,
      });
    },
  });

  const testMailMutation = trpc.integrations.mail.test.useMutation({
    onSuccess: (data: any) => {
      setTestStatus('success');
      setTestMessage(
        data.sentTo
          ? `Email di test inviata a ${data.sentTo}. Controlla la casella di posta.`
          : data.message
      );
      toast.success('Test riuscito');
      setTestEmail('');
    },
    onError: (error: any) => {
      setTestStatus('error');
      setTestMessage(error.message);
      toast.error('Test fallito', {
        description: error.message,
      });
    },
  });

  const onSubmit = (data: MailSmtpConfigInput) => {
    // Se la password è vuota e già configurata, omettila dal payload
    const { pass, ...payloadWithoutPassword } = data;
    const payload = !pass || pass.trim() === '' ? payloadWithoutPassword : data;

    saveConfigMutation.mutate(payload as any);
  };

  const handleTestMail = () => {
    setTestStatus('idle');
    setTestMessage('');

    const trimmedEmail = testEmail.trim();
    testMailMutation.mutate(
      trimmedEmail ? { testEmail: trimmedEmail } : { testEmail: undefined }
    );
  };

  return (
    <SettingsFormShell
      title="Configurazione Mail"
      description="Gestisci l'integrazione SMTP per l'invio delle email transazionali (reset password, verifica email)"
      isLoading={isLoading}
    >
      <SectionCard
        title="Parametri SMTP"
        description="Configura il server SMTP per l'invio delle email"
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <KeyValueGrid cols={2}>
              {/* Host SMTP */}
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Host SMTP <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="es. smtp.gmail.com" {...field} />
                    </FormControl>
                    <FormDescription>
                      Server SMTP per l&apos;invio email
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Porta SMTP */}
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
                        placeholder="587"
                        {...field}
                        onChange={e =>
                          field.onChange(parseInt(e.target.value) || 587)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      587 (STARTTLS) o 465 (SSL/TLS)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Tipo connessione */}
              <FormField
                control={form.control}
                name="secure"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Tipo Connessione <span className="text-red-500">*</span>
                    </FormLabel>
                    <Select
                      value={field.value ? 'true' : 'false'}
                      onValueChange={value => field.onChange(value === 'true')}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="false">
                          STARTTLS (porta 587)
                        </SelectItem>
                        <SelectItem value="true">
                          SSL/TLS (porta 465)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      STARTTLS è raccomandato per Gmail
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* User SMTP */}
              <FormField
                control={form.control}
                name="user"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Email/User SMTP <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="noreply@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Account email per autenticazione SMTP
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </KeyValueGrid>

            {/* Password SMTP */}
            <FormField
              control={form.control}
              name="pass"
              render={({ field }) => (
                <SensitiveField
                  label={
                    <>
                      Password SMTP{' '}
                      {!hasPassword && <span className="text-red-500">*</span>}
                    </>
                  }
                  description={
                    hasPassword
                      ? undefined
                      : 'Per Gmail: usa App Password (non la password normale)'
                  }
                  hasValue={hasPassword}
                  placeholder={
                    hasPassword ? undefined : 'App Password o password account'
                  }
                  field={field}
                />
              )}
            />

            {/* From Email */}
            <FormField
              control={form.control}
              name="from"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Indirizzo Mittente (From){' '}
                    <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder='es. "Luke" <noreply@example.com>'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Indirizzo email che apparirà come mittente delle email
                    transazionali
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Base URL */}
            <FormField
              control={form.control}
              name="baseUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    URL Base Applicazione{' '}
                    <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      placeholder="https://luke.example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    URL base per i link nelle email (reset password, verifica
                    email). In sviluppo: http://localhost:3000
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Note per provider comuni */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
              <h4 className="mb-2 font-semibold">
                ℹ️ Configurazione provider comuni
              </h4>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <strong>Google Workspace/Gmail:</strong> Host: smtp.gmail.com,
                  Porta: 587, STARTTLS. Usa <strong>App Password</strong>{' '}
                  (richiede 2FA attiva)
                </li>
                <li>
                  <strong>Microsoft 365/Outlook:</strong> Host:
                  smtp.office365.com, Porta: 587, STARTTLS
                </li>
                <li>
                  <strong>SendGrid:</strong> Host: smtp.sendgrid.net, Porta:
                  587, STARTTLS. User: &quot;apikey&quot;, Pass: tua_api_key
                </li>
                <li>
                  <strong>Amazon SES:</strong> Host:
                  email-smtp.[region].amazonaws.com, Porta: 587, STARTTLS. Usa
                  SMTP credentials di IAM
                </li>
              </ul>
            </div>

            {/* Pulsanti Azione */}
            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset()}
                disabled={
                  saveConfigMutation.isPending || testMailMutation.isPending
                }
              >
                Reset
              </Button>
              <Button
                type="submit"
                disabled={
                  saveConfigMutation.isPending || testMailMutation.isPending
                }
              >
                {saveConfigMutation.isPending
                  ? 'Salvataggio...'
                  : 'Salva Configurazione'}
              </Button>
            </div>
          </form>
        </Form>
      </SectionCard>

      {/* Test Email */}
      <SectionCard
        title="Test Connessione SMTP"
        description="Invia un'email di test per verificare la configurazione"
      >
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="test-email">Email Destinatario (opzionale)</Label>
              <Input
                id="test-email"
                type="email"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder={form.watch('from') || 'Destinatario email di test'}
                disabled={testMailMutation.isPending || !form.watch('host')}
              />
            </div>
            <SettingsActions
              onTest={handleTestMail}
              isTesting={testMailMutation.isPending}
              disabled={testMailMutation.isPending || !form.watch('host')}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Se lasciato vuoto, l&apos;email di test verrà inviata
            all&apos;indirizzo mittente configurato (
            <code className="rounded bg-muted px-1 py-0.5">
              {form.watch('from') || '(non configurato)'}
            </code>
            )
          </p>

          {/* Risultato Test */}
          <TestStatusBanner status={testStatus} message={testMessage} />
        </div>
      </SectionCard>
    </SettingsFormShell>
  );
}
