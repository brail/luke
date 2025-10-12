'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { trpc } from '../../../lib/trpc';

interface LdapConfig {
  enabled: boolean;
  url: string;
  bindDN: string;
  hasBindPassword: boolean;
  searchBase: string;
  searchFilter: string;
  groupSearchBase: string;
  groupSearchFilter: string;
  roleMapping: string;
  strategy: 'local-first' | 'ldap-first' | 'local-only' | 'ldap-only';
}

export default function LdapSettingsPage() {
  const [formData, setFormData] = useState<LdapConfig>({
    enabled: false,
    url: '',
    bindDN: '',
    hasBindPassword: false,
    searchBase: '',
    searchFilter: '',
    groupSearchBase: '',
    groupSearchFilter: '',
    roleMapping: '',
    strategy: 'local-first',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Carica configurazione esistente
  const { data: existingConfig, isLoading: isLoadingConfig } =
    trpc.integrations.auth.getLdapConfig.useQuery();

  useEffect(() => {
    if (existingConfig) {
      setFormData({
        enabled: existingConfig.enabled,
        url: existingConfig.url,
        bindDN: existingConfig.bindDN,
        hasBindPassword: existingConfig.hasBindPassword,
        searchBase: existingConfig.searchBase,
        searchFilter: existingConfig.searchFilter,
        groupSearchBase: existingConfig.groupSearchBase,
        groupSearchFilter: existingConfig.groupSearchFilter,
        roleMapping: existingConfig.roleMapping,
        strategy: existingConfig.strategy,
      });
    }
  }, [existingConfig]);

  // Mutations
  const saveConfigMutation = trpc.integrations.auth.saveLdapConfig.useMutation({
    onSuccess: () => {
      setMessage({
        type: 'success',
        text: 'Configurazione LDAP salvata con successo!',
      });
      setErrors({});
    },
    onError: err => {
      setMessage({ type: 'error', text: err.message });
    },
    onSettled: () => {
      setIsLoading(false);
    },
  });

  const testConnectionMutation =
    trpc.integrations.auth.testLdapConnection.useMutation({
      onSuccess: () => {
        setMessage({
          type: 'success',
          text: 'Test connessione LDAP riuscito!',
        });
      },
      onError: err => {
        setMessage({
          type: 'error',
          text: `Test connessione fallito: ${err.message}`,
        });
      },
    });

  const testSearchMutation = trpc.integrations.auth.testLdapSearch.useMutation({
    onSuccess: data => {
      setMessage({
        type: 'success',
        text: `Test ricerca LDAP: ${data.message}`,
      });
      console.log('LDAP Search Results:', data);
    },
    onError: err => {
      setMessage({
        type: 'error',
        text: `Test ricerca fallito: ${err.message}`,
      });
    },
  });

  const handleInputChange = (
    field: keyof LdapConfig,
    value: string | boolean
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Rimuovi errore quando l'utente inizia a digitare
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }

    // Validazione JSON per roleMapping
    if (field === 'roleMapping') {
      const roleMappingValue = value as string;
      if (roleMappingValue.trim()) {
        try {
          JSON.parse(roleMappingValue);
          setErrors(prev => ({ ...prev, roleMapping: '' }));
        } catch {
          setErrors(prev => ({ ...prev, roleMapping: 'JSON non valido' }));
        }
      }
    }
  };

  const handleSaveConfig = async () => {
    setIsLoading(true);
    setMessage(null);

    // Validazione finale
    const newErrors: Record<string, string> = {};

    if (formData.enabled) {
      if (!formData.url) newErrors.url = 'URL LDAP è obbligatorio';
      if (!formData.searchBase)
        newErrors.searchBase = 'Search Base è obbligatorio';
      if (!formData.searchFilter)
        newErrors.searchFilter = 'Search Filter è obbligatorio';

      if (formData.roleMapping.trim()) {
        try {
          JSON.parse(formData.roleMapping);
        } catch {
          newErrors.roleMapping = 'Role Mapping deve essere un JSON valido';
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    saveConfigMutation.mutate(formData);
  };

  const handleTestConnection = () => {
    if (!formData.enabled) {
      setMessage({
        type: 'error',
        text: 'Abilita LDAP prima di testare la connessione',
      });
      return;
    }

    testConnectionMutation.mutate();
  };

  const handleTestSearch = () => {
    if (!formData.enabled) {
      setMessage({
        type: 'error',
        text: 'Abilita LDAP prima di testare la ricerca',
      });
      return;
    }
    const username = prompt('Inserisci username da cercare:');
    if (username) {
      testSearchMutation.mutate({ username });
    }
  };

  if (isLoadingConfig) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">Caricamento configurazione...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Configurazione LDAP</h1>
        <p className="text-muted-foreground mt-2">
          Configura l&apos;autenticazione enterprise via LDAP con mapping dei
          ruoli
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-md ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Parametri LDAP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Abilita LDAP */}
          <div className="flex items-center space-x-2">
            <input
              id="enabled"
              type="checkbox"
              checked={formData.enabled}
              onChange={e => handleInputChange('enabled', e.target.checked)}
              className="h-4 w-4 rounded border border-input bg-background"
            />
            <Label htmlFor="enabled">Abilita autenticazione LDAP</Label>
          </div>

          {/* Strategia Autenticazione */}
          <div className="space-y-2">
            <Label htmlFor="strategy">Strategia Autenticazione</Label>
            <select
              id="strategy"
              value={formData.strategy}
              onChange={e => handleInputChange('strategy', e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="local-first">Locale prima, poi LDAP</option>
              <option value="ldap-first">LDAP prima, poi locale</option>
              <option value="local-only">Solo autenticazione locale</option>
              <option value="ldap-only">Solo autenticazione LDAP</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Determina l&apos;ordine di tentativo per l&apos;autenticazione
            </p>
          </div>

          {/* URL LDAP */}
          <div className="space-y-2">
            <Label htmlFor="url">URL LDAP *</Label>
            <Input
              id="url"
              type="text"
              value={formData.url}
              onChange={e => handleInputChange('url', e.target.value)}
              placeholder="ldap://server.example.com:389"
              className={errors.url ? 'border-destructive' : ''}
              disabled={!formData.enabled}
            />
            {errors.url && (
              <p className="text-sm text-destructive">{errors.url}</p>
            )}
            <p className="text-xs text-muted-foreground">
              URL del server LDAP (es. ldap://server.example.com:389)
            </p>
          </div>

          {/* Bind DN */}
          <div className="space-y-2">
            <Label htmlFor="bindDN">Bind DN</Label>
            <Input
              id="bindDN"
              type="text"
              value={formData.bindDN}
              onChange={e => handleInputChange('bindDN', e.target.value)}
              placeholder="cn=admin,dc=example,dc=com"
              disabled={!formData.enabled}
            />
            <p className="text-xs text-muted-foreground">
              DN dell&apos;account amministrativo per cercare gli utenti
            </p>
          </div>

          {/* Bind Password */}
          <div className="space-y-2">
            <Label htmlFor="bindPassword">Bind Password</Label>
            <Input
              id="bindPassword"
              type="password"
              onChange={e => handleInputChange('bindPassword', e.target.value)}
              placeholder={
                formData.hasBindPassword ? '••••••••' : 'Inserisci password'
              }
              disabled={!formData.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Password dell&apos;account amministrativo
            </p>
          </div>

          {/* Search Base */}
          <div className="space-y-2">
            <Label htmlFor="searchBase">Search Base *</Label>
            <Input
              id="searchBase"
              type="text"
              value={formData.searchBase}
              onChange={e => handleInputChange('searchBase', e.target.value)}
              placeholder="dc=example,dc=com"
              className={errors.searchBase ? 'border-destructive' : ''}
              disabled={!formData.enabled}
            />
            {errors.searchBase && (
              <p className="text-sm text-destructive">{errors.searchBase}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Base DN dove cercare gli utenti
            </p>
          </div>

          {/* Search Filter */}
          <div className="space-y-2">
            <Label htmlFor="searchFilter">Search Filter *</Label>
            <Input
              id="searchFilter"
              type="text"
              value={formData.searchFilter}
              onChange={e => handleInputChange('searchFilter', e.target.value)}
              placeholder="(uid=$&#123;username&#125;)"
              className={errors.searchFilter ? 'border-destructive' : ''}
              disabled={!formData.enabled}
            />
            {errors.searchFilter && (
              <p className="text-sm text-destructive">{errors.searchFilter}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Filtro LDAP per cercare utenti (usa $&#123;username&#125; come
              placeholder)
            </p>
          </div>

          {/* Group Search Base */}
          <div className="space-y-2">
            <Label htmlFor="groupSearchBase">Group Search Base</Label>
            <Input
              id="groupSearchBase"
              type="text"
              value={formData.groupSearchBase}
              onChange={e =>
                handleInputChange('groupSearchBase', e.target.value)
              }
              placeholder="ou=groups,dc=example,dc=com"
              disabled={!formData.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Base DN dove cercare i gruppi dell&apos;utente
            </p>
          </div>

          {/* Group Search Filter */}
          <div className="space-y-2">
            <Label htmlFor="groupSearchFilter">Group Search Filter</Label>
            <Input
              id="groupSearchFilter"
              type="text"
              value={formData.groupSearchFilter}
              onChange={e =>
                handleInputChange('groupSearchFilter', e.target.value)
              }
              placeholder="(member=${userDN})"
              disabled={!formData.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Filtro LDAP per cercare gruppi (usa $&#123;userDN&#125; come
              placeholder)
            </p>
          </div>

          {/* Role Mapping */}
          <div className="space-y-2">
            <Label htmlFor="roleMapping">Role Mapping (JSON)</Label>
            <textarea
              id="roleMapping"
              value={formData.roleMapping}
              onChange={e => handleInputChange('roleMapping', e.target.value)}
              placeholder={`{
  "CN=Admins,DC=example,DC=com": "admin",
  "CN=Editors,DC=example,DC=com": "editor",
  "CN=Users,DC=example,DC=com": "viewer"
}`}
              className={`flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                errors.roleMapping ? 'border-destructive' : ''
              }`}
              disabled={!formData.enabled}
            />
            {errors.roleMapping && (
              <p className="text-sm text-destructive">{errors.roleMapping}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Mappa i gruppi LDAP ai ruoli dell&apos;applicazione (admin,
              editor, viewer)
            </p>
          </div>

          {/* Bottoni */}
          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={isLoading || testConnectionMutation.isPending}
            >
              {testConnectionMutation.isPending
                ? 'Test in corso...'
                : 'Test Connessione'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestSearch}
              disabled={isLoading || testSearchMutation.isPending}
            >
              {testSearchMutation.isPending
                ? 'Ricerca in corso...'
                : 'Test Ricerca'}
            </Button>
            <Button
              type="button"
              onClick={handleSaveConfig}
              disabled={isLoading || saveConfigMutation.isPending}
            >
              {isLoading || saveConfigMutation.isPending
                ? 'Salvataggio...'
                : 'Salva Configurazione'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
