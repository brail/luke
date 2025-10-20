'use client';

import { useEffect, useState } from 'react';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
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

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  baseUrl: string;
}

export default function MailPage() {
  const toast = useToast();
  const [config, setConfig] = useState<SmtpConfig>({
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
    baseUrl: 'http://localhost:3000',
  });
  const [isPasswordSet, setIsPasswordSet] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    sentTo?: string;
  } | null>(null);

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

      setConfig({
        host: smtpHost?.valuePreview || '',
        port: smtpPort?.valuePreview ? parseInt(smtpPort.valuePreview) : 587,
        secure: smtpSecure?.valuePreview === 'true',
        user: smtpUser?.valuePreview || '',
        pass: '', // Non mostrare mai la password
        from: smtpFrom?.valuePreview || '',
        baseUrl: appBaseUrl?.valuePreview || 'http://localhost:3000',
      });

      // Indica se la password è già configurata
      setIsPasswordSet(!!smtpPass);
    }
  }, [existingConfigs]);

  const saveConfigMutation = trpc.integrations.mail.saveConfig.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.message || 'Configurazione SMTP salvata con successo');
      setIsPasswordSet(true);
    },
    onError: (error: any) => {
      toast.error('Errore durante il salvataggio', {
        description: error.message,
      });
    },
  });

  const testMailMutation = trpc.integrations.mail.test.useMutation({
    onSuccess: (data: any) => {
      setTestResult(data);
      toast.success(data.message);
      setTestEmail(''); // Reset campo dopo successo
    },
    onError: (error: any) => {
      setTestResult({ success: false, message: error.message });
      toast.error('Test fallito', {
        description: error.message,
      });
    },
  });

  const handleSaveConfig = () => {
    // Validazione base
    if (!config.host || !config.user || !config.from) {
      toast.error('Campi mancanti', {
        description: 'Compila tutti i campi obbligatori (Host, User, From)',
      });
      return;
    }

    // Se la password è vuota e non era già configurata, mostra errore
    if (!config.pass && !isPasswordSet) {
      toast.error('Password richiesta', {
        description: 'Inserisci la password SMTP',
      });
      return;
    }

    saveConfigMutation.mutate(config);
  };

  const handleTestMail = () => {
    setTestResult(null);
    // Passa il campo solo se non è vuoto, altrimenti ometti
    const trimmedEmail = testEmail.trim();
    testMailMutation.mutate(
      trimmedEmail ? { testEmail: trimmedEmail } : { testEmail: undefined }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Configurazione Mail"
          description="Gestisci l'integrazione SMTP per l'invio delle email transazionali"
        />
        <div className="text-center py-8">Caricamento configurazione...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurazione Mail"
        description="Gestisci l'integrazione SMTP per l'invio delle email transazionali (reset password, verifica email)"
      />

      <SectionCard
        title="Parametri SMTP"
        description="Configura il server SMTP per l'invio delle email"
      >
        {/* Configurazione SMTP */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Host SMTP */}
            <div>
              <Label htmlFor="smtp-host">
                Host SMTP <span className="text-red-500">*</span>
              </Label>
              <Input
                id="smtp-host"
                value={config.host}
                onChange={(e: any) =>
                  setConfig({ ...config, host: e.target.value })
                }
                placeholder="es. smtp.gmail.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Server SMTP per l'invio email
              </p>
            </div>

            {/* Porta SMTP */}
            <div>
              <Label htmlFor="smtp-port">
                Porta <span className="text-red-500">*</span>
              </Label>
              <Input
                id="smtp-port"
                type="number"
                value={config.port}
                onChange={(e: any) =>
                  setConfig({
                    ...config,
                    port: parseInt(e.target.value) || 587,
                  })
                }
                placeholder="587"
              />
              <p className="text-xs text-muted-foreground mt-1">
                587 (STARTTLS) o 465 (SSL/TLS)
              </p>
            </div>

            {/* Tipo connessione */}
            <div>
              <Label htmlFor="smtp-secure">
                Tipo Connessione <span className="text-red-500">*</span>
              </Label>
              <Select
                value={config.secure ? 'true' : 'false'}
                onValueChange={value =>
                  setConfig({ ...config, secure: value === 'true' })
                }
              >
                <SelectTrigger id="smtp-secure">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">STARTTLS (porta 587)</SelectItem>
                  <SelectItem value="true">SSL/TLS (porta 465)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                STARTTLS è raccomandato per Gmail
              </p>
            </div>

            {/* User SMTP */}
            <div>
              <Label htmlFor="smtp-user">
                Email/User SMTP <span className="text-red-500">*</span>
              </Label>
              <Input
                id="smtp-user"
                type="email"
                value={config.user}
                onChange={(e: any) =>
                  setConfig({ ...config, user: e.target.value })
                }
                placeholder="noreply@example.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Account email per autenticazione SMTP
              </p>
            </div>

            {/* Password SMTP */}
            <div className="col-span-2">
              <Label htmlFor="smtp-pass">
                Password SMTP{' '}
                {!isPasswordSet && <span className="text-red-500">*</span>}
              </Label>
              <Input
                id="smtp-pass"
                type="password"
                value={config.pass}
                onChange={(e: any) =>
                  setConfig({ ...config, pass: e.target.value })
                }
                placeholder={
                  isPasswordSet
                    ? '•••••• (già configurata, lascia vuoto per non modificare)'
                    : 'App Password o password account'
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                {isPasswordSet ? (
                  <>
                    ✅ Password già salvata e cifrata. Lascia vuoto per
                    mantenerla invariata.
                  </>
                ) : (
                  <>
                    Per Gmail: usa <strong>App Password</strong> (non la
                    password normale)
                  </>
                )}
              </p>
            </div>

            {/* From Email */}
            <div className="col-span-2">
              <Label htmlFor="smtp-from">
                Indirizzo Mittente (From){' '}
                <span className="text-red-500">*</span>
              </Label>
              <Input
                id="smtp-from"
                type="email"
                value={config.from}
                onChange={(e: any) =>
                  setConfig({ ...config, from: e.target.value })
                }
                placeholder='es. "Luke" <noreply@example.com>'
              />
              <p className="text-xs text-muted-foreground mt-1">
                Indirizzo email che apparirà come mittente delle email
                transazionali
              </p>
            </div>

            {/* Base URL */}
            <div className="col-span-2">
              <Label htmlFor="app-baseurl">
                URL Base Applicazione <span className="text-red-500">*</span>
              </Label>
              <Input
                id="app-baseurl"
                type="url"
                value={config.baseUrl}
                onChange={(e: any) =>
                  setConfig({ ...config, baseUrl: e.target.value })
                }
                placeholder="https://luke.example.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                URL base per i link nelle email (reset password, verifica
                email). In sviluppo: http://localhost:3000
              </p>
            </div>
          </div>
        </div>

        {/* Note per provider comuni */}
        <Alert className="mt-6">
          <AlertDescription>
            <h4 className="font-medium mb-2">
              📧 Configurazione provider comuni:
            </h4>
            <ul className="text-sm space-y-1">
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
                <strong>SendGrid:</strong> Host: smtp.sendgrid.net, Porta: 587,
                STARTTLS. User: "apikey", Pass: tua_api_key
              </li>
              <li>
                <strong>Amazon SES:</strong> Host:
                email-smtp.[region].amazonaws.com, Porta: 587, STARTTLS. Usa
                SMTP credentials di IAM
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Pulsanti Azione */}
        <div className="flex gap-4 mt-6">
          <Button
            onClick={handleSaveConfig}
            disabled={saveConfigMutation.isPending}
            className="flex-1"
          >
            {saveConfigMutation.isPending
              ? 'Salvataggio...'
              : 'Salva Configurazione'}
          </Button>
        </div>

        {/* Test Email */}
        <div className="border-t pt-4 space-y-3">
          <Label htmlFor="test-email">Email Test (opzionale)</Label>
          <div className="flex gap-2">
            <Input
              id="test-email"
              type="email"
              value={testEmail}
              onChange={(e: any) => setTestEmail(e.target.value)}
              placeholder={config.from || 'Destinatario email di test'}
              className="flex-1"
            />
            <Button
              onClick={handleTestMail}
              disabled={testMailMutation.isPending || !config.host}
              variant="outline"
            >
              {testMailMutation.isPending ? 'Invio...' : 'Invia Test'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Se lasciato vuoto, l&apos;email di test verrà inviata
            all&apos;indirizzo mittente configurato (
            <code>{config.from || '(non configurato)'}</code>)
          </p>
        </div>

        {/* Risultato Test */}
        {testResult && (
          <Alert variant={testResult.success ? 'default' : 'destructive'}>
            <AlertDescription>
              <p className="font-medium">
                {testResult.success ? '✅ Successo' : '❌ Errore'}
              </p>
              <p className="text-sm mt-1">{testResult.message}</p>
              {testResult.success && testResult.sentTo && (
                <p className="text-sm mt-2">
                  L&apos;email di test è stata inviata a{' '}
                  <strong>{testResult.sentTo}</strong>. Controlla la casella di
                  posta per verificare la ricezione.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
      </SectionCard>
    </div>
  );
}
