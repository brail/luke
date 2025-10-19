'use client';

import React, { useState } from 'react';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { trpc } from '../../../../lib/trpc';

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

  const saveConfigMutation = trpc.integrations.storage.saveConfig.useMutation({
    onSuccess: (data: any) => {
      alert(data.message);
    },
    onError: (error: any) => {
      alert(`Errore: ${error.message}`);
    },
  });

  const testConnectionQuery = trpc.integrations.storage.testConnection.useQuery(
    { provider },
    {
      enabled: false,
    }
  );

  // Gestisci i risultati della query
  React.useEffect(() => {
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

  const handleSaveConfig = () => {
    const config = provider === 'smb' ? smbConfig : driveConfig;
    saveConfigMutation.mutate({ provider, config });
  };

  const handleTestConnection = () => {
    setTestResult(null);
    testConnectionQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurazione Storage"
        description="Gestisci le connessioni per SMB/Samba e Google Drive"
      />

      <SectionCard
        title={
          provider === 'smb'
            ? 'Configurazione SMB/Samba'
            : 'Configurazione Google Drive'
        }
        description={
          provider === 'smb'
            ? 'Imposta la connessione SMB/Samba'
            : "Configura l'integrazione OAuth con Google Drive"
        }
      >
        {/* Selezione Provider */}
        <div className="space-y-3">
          <Label>Provider Storage</Label>
          <div className="flex space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                value="smb"
                checked={provider === 'smb'}
                onChange={(e: any) => setProvider(e.target.value as Provider)}
                className="rounded"
              />
              <span>SMB/Samba</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                value="drive"
                checked={provider === 'drive'}
                onChange={(e: any) => setProvider(e.target.value as Provider)}
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
                    setSmbConfig({ ...smbConfig, username: e.target.value })
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
                    setSmbConfig({ ...smbConfig, password: e.target.value })
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
          </div>
        )}

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
            onClick={handleTestConnection}
            disabled={testConnectionQuery.isFetching}
            variant="outline"
            className="flex-1"
          >
            {testConnectionQuery.isFetching ? 'Test...' : 'Test Connessione'}
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
          </div>
        )}
      </SectionCard>
    </div>
  );
}
