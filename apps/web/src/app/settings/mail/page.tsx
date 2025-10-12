'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { trpc } from '../../../lib/trpc';

interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
}

export default function MailPage() {
  const [config, setConfig] = useState<SmtpConfig>({
    host: '',
    port: 587,
    username: '',
    password: '',
    from: '',
  });
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const saveConfigMutation = (
    trpc as any
  ).integrations.mail.saveConfig.useMutation({
    onSuccess: (data: any) => {
      alert(data.message);
    },
    onError: (error: any) => {
      alert(`Errore: ${error.message}`);
    },
  });

  const testMailMutation = (trpc as any).integrations.mail.test.useMutation({
    onSuccess: (data: any) => {
      setTestResult(data);
    },
    onError: (error: any) => {
      setTestResult({ success: false, message: error.message });
    },
  });

  const handleSaveConfig = () => {
    saveConfigMutation.mutate(config);
  };

  const handleTestMail = () => {
    setTestResult(null);
    testMailMutation.mutate();
  };

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Configurazione Mail</CardTitle>
            <CardDescription>
              Configura il server SMTP per l&apos;invio delle email
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Configurazione SMTP */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Configurazione SMTP</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="smtp-host">Host SMTP</Label>
                  <Input
                    id="smtp-host"
                    value={config.host}
                    onChange={(e: any) =>
                      setConfig({ ...config, host: e.target.value })
                    }
                    placeholder="es. smtp.gmail.com"
                  />
                </div>
                <div>
                  <Label htmlFor="smtp-port">Porta</Label>
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
                </div>
                <div>
                  <Label htmlFor="smtp-username">Username</Label>
                  <Input
                    id="smtp-username"
                    value={config.username}
                    onChange={(e: any) =>
                      setConfig({ ...config, username: e.target.value })
                    }
                    placeholder="Email o username"
                  />
                </div>
                <div>
                  <Label htmlFor="smtp-password">Password</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    value={config.password}
                    onChange={(e: any) =>
                      setConfig({ ...config, password: e.target.value })
                    }
                    placeholder="Password o App Password"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="smtp-from">Email Mittente</Label>
                  <Input
                    id="smtp-from"
                    type="email"
                    value={config.from}
                    onChange={(e: any) =>
                      setConfig({ ...config, from: e.target.value })
                    }
                    placeholder="es. noreply@example.com"
                  />
                </div>
              </div>
            </div>

            {/* Note per provider comuni */}
            <div className="bg-blue-50 p-4 rounded-md border border-blue-200">
              <h4 className="font-medium text-blue-900 mb-2">
                Note per provider comuni:
              </h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>
                  <strong>Gmail:</strong> Usa App Password invece della password
                  normale
                </li>
                <li>
                  <strong>Outlook/Hotmail:</strong> Porta 587, SSL/TLS
                </li>
                <li>
                  <strong>Yahoo:</strong> Porta 587, richiede App Password
                </li>
                <li>
                  <strong>Server aziendali:</strong> Verifica porta e
                  autenticazione con IT
                </li>
              </ul>
            </div>

            {/* Pulsanti Azione */}
            <div className="flex space-x-4">
              <Button
                onClick={handleSaveConfig}
                disabled={saveConfigMutation.isPending}
                className="flex-1"
              >
                {saveConfigMutation.isPending
                  ? 'Salvataggio...'
                  : 'Salva Configurazione'}
              </Button>
              <Button
                onClick={handleTestMail}
                disabled={testMailMutation.isPending}
                variant="outline"
                className="flex-1"
              >
                {testMailMutation.isPending ? 'Invio...' : 'Invia Email Test'}
              </Button>
            </div>

            {/* Risultato Test */}
            {testResult && (
              <div
                className={`p-4 rounded-md ${
                  testResult.success
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                <p className="font-medium">
                  {testResult.success ? '✅' : '❌'} {testResult.message}
                </p>
                {testResult.success && (
                  <p className="text-sm mt-1">
                    Controlla la casella di posta per l&apos;email di test.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
