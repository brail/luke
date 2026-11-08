'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  LDAP_TEST_FIELDS,
  isUndeletableConfigKey,
  ldapConfigSchema,
  ldapSearchTestSchema,
  type LdapConfigInput,
  type LdapStoredField,
} from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { SectionCard } from '../../../../components/SectionCard';
import { KeyValueGrid } from '../../../../components/settings/KeyValueGrid';
import { SensitiveField } from '../../../../components/settings/SensitiveField';
import { SettingsFormShell } from '../../../../components/settings/SettingsFormShell';
import { TestStatusBanner } from '../../../../components/settings/TestStatusBanner';
import {
  UNREADABLE_VALUE_MESSAGE,
  UnreadableValueNotice,
  type UnreadableValueNoticeProps,
} from '../../../../components/settings/UnreadableValueNotice';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Switch } from '../../../../components/ui/switch';
import { Textarea } from '../../../../components/ui/textarea';
import { usePermission } from '../../../../hooks/usePermission';
import { debugLog, debugWarn } from '../../../../lib/debug';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

const UNREADABLE_SIGN_IN_MESSAGE = 'Un valore salvato non è leggibile e blocca l\'accesso LDAP: inseriscilo di nuovo e salva.';
const UNREADABLE_REMOVABLE_MESSAGE = 'Un valore salvato non è leggibile e blocca l\'accesso LDAP: inseriscilo di nuovo o rimuovilo.';

/** Under a stored role mapping the registry refuses (#112), which the form shows for correction. */
const INVALID_ROLE_MAPPING_MESSAGE =
  "La mappatura salvata non è valida e all'accesso viene ignorata: i nuovi utenti LDAP ricevono il ruolo viewer. Correggila e salva.";

/** What a bind DN without its password leads to: on the field, and in the confirmation that removes one. */
const BIND_ALONE_WARNING =
  'senza, un guasto della directory viene mostrato come credenziali errate e la protezione dai guasti non interviene.';
const BIND_WARNING = ` Bind DN e password vanno configurati insieme: ${BIND_ALONE_WARNING}`;

/** What removing a field changes beyond the field itself, said in the confirmation (#193). */
const REMOVE_CONSEQUENCE: Partial<Record<LdapStoredField, string>> = {
  roleMapping: ' I nuovi utenti LDAP riceveranno il ruolo viewer; i ruoli degli utenti esistenti non cambiano.',
  bindDN: BIND_WARNING,
  bindPassword: BIND_WARNING,
};

export default function LdapSettingsPage() {
  const { can } = usePermission();
  const canUpdate = can('config:update');

  // Form with react-hook-form and Zod validation
  const form = useForm<LdapConfigInput>({
    resolver: zodResolver(ldapConfigSchema),
    defaultValues: {
      enabled: false,
      url: '',
      bindDN: '',
      bindPassword: '',
      searchBase: '',
      searchFilter: '',
      groupSearchBase: '',
      groupSearchFilter: '',
      roleMapping: '',
      strategy: 'local-first',
    },
  });

  const [testConnectionStatus, setTestConnectionStatus] = React.useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [testConnectionMessage, setTestConnectionMessage] =
    React.useState<string>('');

  // Search test dialog
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const searchForm = useForm<z.infer<typeof ldapSearchTestSchema>>({
    resolver: zodResolver(ldapSearchTestSchema),
    defaultValues: { username: '' },
  });

  // Load the existing configuration (admin only)
  const {
    data: existingConfig,
    isPending: isConfigPending,
    error: configError,
    refetch: refetchConfig,
  } = trpc.integrations.auth.getLdapConfig.useQuery(undefined);

  // Removed here with `Rimuovi` (#193): no longer stored, though the query, not refetched so that the
  // admin's other unsaved edits survive, still names them — until it is read again, which resets it.
  const [removed, setRemoved] = useState<{ from: typeof existingConfig; fields: LdapStoredField[] }>({ from: undefined, fields: [] });
  const [removing, setRemoving] = useState<LdapStoredField | null>(null);
  const storedUnreadable = existingConfig?.unreadable ?? [];
  const removedFields = removed.from === existingConfig ? removed.fields : [];
  const unreadable = storedUnreadable.filter(f => !removedFields.includes(f));
  const roleMappingInvalid = existingConfig?.roleMappingInvalid ?? false;
  // With LDAP off the fields are locked, but one that has to be entered again must stay editable,
  // and stays so after a removal until the page is read again.
  const enabled = useWatch({ control: form.control, name: 'enabled' });
  const fieldsLocked = !canUpdate || (!enabled && storedUnreadable.length === 0 && !roleMappingInvalid);

  // Update form when existing configuration arrives
  useEffect(() => {
    if (existingConfig) {
      form.reset({
        enabled: existingConfig.enabled,
        url: existingConfig.url,
        bindDN: '',
        bindPassword: '',
        searchBase: existingConfig.searchBase,
        searchFilter: existingConfig.searchFilter,
        groupSearchBase: existingConfig.groupSearchBase,
        groupSearchFilter: existingConfig.groupSearchFilter,
        roleMapping: existingConfig.roleMapping,
        strategy: existingConfig.strategy,
      });
      // Names the group with the wrong role at once, not only after a refused save.
      if (existingConfig.roleMappingInvalid) void form.trigger('roleMapping');
    }
  }, [existingConfig, form]);

  // Mutations (admin only)
  const saveConfigMutation = trpc.integrations.auth.saveLdapConfig.useMutation({
    onSuccess: () => {
      toast.success('Configurazione LDAP salvata con successo');
      setTestConnectionStatus('idle');
      setTestConnectionMessage('');
      // What is stored changed: credentials just entered, unreadable values replaced.
      void refetchConfig();
    },
    onError: err => {
      toast.error('Errore durante il salvataggio', {
        description: getTrpcErrorMessage(err),
      });
      debugWarn('LDAP save error:', err);
    },
  });

  const removeMutation = trpc.config.delete.useMutation({
    onError: err => toast.error('Rimozione non riuscita', { description: getTrpcErrorMessage(err) }),
    onSettled: () => setRemoving(null),
  });

  const remove = (field: LdapStoredField) =>
    removeMutation.mutate({ key: `auth.ldap.${field}` }, {
      onSuccess: () => {
        setRemoved({ from: existingConfig, fields: [...removedFields, field] });
        form.setValue(field, '');
        toast.success('Valore rimosso');
      },
    });

  /**
   * `Rimuovi` for an unreadable field, or none for the three LDAP needs, which `config.delete`
   * refuses and the admin enters again anyway.
   */
  const removeAction = (field: LdapStoredField): UnreadableValueNoticeProps => {
    const removable = !isUndeletableConfigKey(`auth.ldap.${field}`);
    return {
      // Any unreadable value stops LDAP sign-in, though only a test's own fields stop that test.
      message: removable ? UNREADABLE_REMOVABLE_MESSAGE : UNREADABLE_SIGN_IN_MESSAGE,
      onRemove: removable ? () => setRemoving(field) : undefined,
      canRemove: canUpdate,
    };
  };

  const testConnectionMutation =
    trpc.integrations.auth.testLdapConnection.useMutation({
      onSuccess: () => {
        toast.success('Test connessione LDAP riuscito');
        setTestConnectionStatus('success');
        setTestConnectionMessage(
          'Connessione al server LDAP stabilita con successo'
        );
      },
      onError: err => {
        const message = getTrpcErrorMessage(err);
        toast.error('Test connessione fallito', {
          description: message,
        });
        setTestConnectionStatus('error');
        setTestConnectionMessage(message);
        debugWarn('LDAP connection test error:', err);
      },
    });

  const testSearchMutation = trpc.integrations.auth.testLdapSearch.useMutation({
    onSuccess: data => {
      toast.success(`Test ricerca LDAP: ${data.message}`);
      debugLog('LDAP Search Results:', data);
      setShowSearchDialog(false);
      searchForm.reset();
    },
    onError: err => {
      toast.error('Test ricerca fallito', {
        description: getTrpcErrorMessage(err),
      });
      debugWarn('LDAP search test error:', err);
    },
  });

  const onSubmit = (data: LdapConfigInput) => {
    // Prepare the payload, leaving out bindPassword if empty
    const { bindPassword, ...payloadWithoutPassword } = data;
    const payload =
      !bindPassword || bindPassword.trim() === ''
        ? payloadWithoutPassword
        : data;

    saveConfigMutation.mutate(payload);
  };

  const handleTestConnection = () => {
    const formData = form.getValues();
    // Answered here: the server would say the same, and spend the small `ldapTest` budget that the
    // test after the repair needs. Only the fields this test reads count (#193).
    if (LDAP_TEST_FIELDS.connection.some(f => unreadable.includes(f))) {
      setTestConnectionStatus('error');
      setTestConnectionMessage(UNREADABLE_VALUE_MESSAGE);
      return;
    }
    if (!formData.enabled) {
      toast.error('Abilita LDAP prima di testare la connessione');
      return;
    }

    setTestConnectionStatus('idle');
    setTestConnectionMessage('');
    testConnectionMutation.mutate();
  };

  const handleTestSearch = () => {
    const formData = form.getValues();
    if (LDAP_TEST_FIELDS.search.some(f => unreadable.includes(f))) {
      toast.error('Test ricerca fallito', { description: UNREADABLE_VALUE_MESSAGE });
      return;
    }
    if (!formData.enabled) {
      toast.error('Abilita LDAP prima di testare la ricerca');
      return;
    }
    setShowSearchDialog(true);
  };

  const handleSearchDialogSubmit = (data: z.infer<typeof ldapSearchTestSchema>) => {
    testSearchMutation.mutate({ username: data.username.trim() });
  };

  return (
    <SettingsFormShell
      title="Configurazione LDAP"
      description="Configura l'autenticazione enterprise via LDAP con mapping dei ruoli"
      isPending={isConfigPending}
      error={configError}
      hasData={!!existingConfig}
      onRetry={() => void refetchConfig()}
    >
      <SectionCard
        title="Parametri LDAP"
        description="Configurazione completa per l'autenticazione LDAP"
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      Abilita autenticazione LDAP
                    </FormLabel>
                    <FormDescription>
                      Attiva l&apos;autenticazione via server LDAP
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

            <FormField
              control={form.control}
              name="strategy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Strategia Autenticazione</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!canUpdate}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona strategia" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="local-first">
                        Locale prima, poi LDAP
                      </SelectItem>
                      <SelectItem value="ldap-first">
                        LDAP prima, poi locale
                      </SelectItem>
                      <SelectItem value="local-only">
                        Solo autenticazione locale
                      </SelectItem>
                      <SelectItem value="ldap-only">
                        Solo LDAP (admin locali come accesso di emergenza)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Determina l&apos;ordine di tentativo per
                    l&apos;autenticazione
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <KeyValueGrid cols={2}>
              {/* URL LDAP */}
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      URL LDAP <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="ldap://server.example.com:389"
                        disabled={fieldsLocked}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      URL del server LDAP (es. ldap://server.example.com:389)
                    </FormDescription>
                    {unreadable.includes('url') && <UnreadableValueNotice {...removeAction('url')} />}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Search Base */}
              <FormField
                control={form.control}
                name="searchBase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Search Base <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="dc=example,dc=com"
                        disabled={fieldsLocked}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Base DN dove cercare gli utenti
                    </FormDescription>
                    {unreadable.includes('searchBase') && <UnreadableValueNotice {...removeAction('searchBase')} />}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Search Filter */}
              <FormField
                control={form.control}
                name="searchFilter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Search Filter <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(uid=${username})"
                        disabled={fieldsLocked}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Filtro LDAP per cercare utenti (usa ${'{username}'} come
                      placeholder)
                    </FormDescription>
                    {unreadable.includes('searchFilter') && <UnreadableValueNotice {...removeAction('searchFilter')} />}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Group Search Base */}
              <FormField
                control={form.control}
                name="groupSearchBase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Search Base</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="ou=groups,dc=example,dc=com"
                        disabled={fieldsLocked}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Base DN dove cercare i gruppi dell&apos;utente
                    </FormDescription>
                    {unreadable.includes('groupSearchBase') && <UnreadableValueNotice {...removeAction('groupSearchBase')} />}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Group Search Filter */}
              <FormField
                control={form.control}
                name="groupSearchFilter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Search Filter</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(member=${userDN})"
                        disabled={fieldsLocked}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Filtro LDAP per cercare gruppi (usa ${'{userDN}'} come
                      placeholder)
                    </FormDescription>
                    {unreadable.includes('groupSearchFilter') && <UnreadableValueNotice {...removeAction('groupSearchFilter')} />}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </KeyValueGrid>

            {/* Bind DN */}
            <FormField
              control={form.control}
              name="bindDN"
              render={({ field }) => (
                <SensitiveField
                  label="Bind DN"
                  description={`DN dell'account di servizio con cui cercare gli utenti. Va sempre configurato insieme alla password: ${BIND_ALONE_WARNING}`}
                  hasValue={existingConfig?.hasBindDN ?? false}
                  unreadable={unreadable.includes('bindDN')}
                  unreadableNotice={removeAction('bindDN')}
                  placeholder="cn=admin,dc=example,dc=com"
                  disabled={fieldsLocked}
                  field={field}
                />
              )}
            />

            {/* Bind Password */}
            <FormField
              control={form.control}
              name="bindPassword"
              render={({ field }) => (
                <SensitiveField
                  label="Bind Password"
                  description="Password dell'account amministrativo"
                  hasValue={existingConfig?.hasBindPassword ?? false}
                  unreadable={unreadable.includes('bindPassword')}
                  unreadableNotice={removeAction('bindPassword')}
                  placeholder="Inserisci password"
                  disabled={fieldsLocked}
                  field={field}
                />
              )}
            />

            {/* Role Mapping */}
            <FormField
              control={form.control}
              name="roleMapping"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role Mapping (JSON)</FormLabel>
                  <FormControl>
                    <Textarea
                      // A short placeholder: the JSON example used to read as a stored value (#193).
                      placeholder="Nessuna mappatura"
                      disabled={fieldsLocked}
                      // 120px: room for a few mapping lines without scrolling; no exact scale match
                      className="min-h-[120px] font-mono"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Mappa i gruppi LDAP ai ruoli dell&apos;applicazione (admin, editor, viewer). Esempio:{' '}
                    <code>{'{"CN=Admins,DC=example,DC=com": "admin"}'}</code>
                  </FormDescription>
                  {unreadable.includes('roleMapping') && <UnreadableValueNotice {...removeAction('roleMapping')} />}
                  {roleMappingInvalid && <p className="text-sm text-status-critical">{INVALID_ROLE_MAPPING_MESSAGE}</p>}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Test buttons */}
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={
                  !canUpdate ||
                  saveConfigMutation.isPending ||
                  testConnectionMutation.isPending
                }
                aria-busy={testConnectionMutation.isPending}
              >
                {testConnectionMutation.isPending
                  ? 'Test in corso...'
                  : 'Test Connessione'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleTestSearch}
                disabled={
                  !canUpdate ||
                  saveConfigMutation.isPending ||
                  testSearchMutation.isPending
                }
                aria-busy={testSearchMutation.isPending}
              >
                {testSearchMutation.isPending
                  ? 'Ricerca in corso...'
                  : 'Test Ricerca'}
              </Button>
            </div>

            {/* Banner Test Status */}
            <TestStatusBanner
              status={testConnectionStatus}
              message={testConnectionMessage}
            />

            {/* Action buttons */}
            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset()}
                disabled={
                  !canUpdate ||
                  saveConfigMutation.isPending ||
                  testConnectionMutation.isPending ||
                  testSearchMutation.isPending
                }
              >
                Reset
              </Button>
              <Button
                type="submit"
                disabled={
                  !canUpdate ||
                  saveConfigMutation.isPending ||
                  testConnectionMutation.isPending ||
                  testSearchMutation.isPending
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

      {/* Search test dialog */}
      <Dialog
        open={showSearchDialog}
        onOpenChange={open => { if (!open && !testSearchMutation.isPending) setShowSearchDialog(false); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Ricerca LDAP</DialogTitle>
            <DialogDescription>
              Inserisci un username per testare la ricerca nel server LDAP
            </DialogDescription>
          </DialogHeader>
          <Form {...searchForm}>
            <form onSubmit={searchForm.handleSubmit(handleSearchDialogSubmit)} className="grid gap-4">
              <div className="py-4">
                <FormField
                  control={searchForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="Username da cercare"
                          disabled={testSearchMutation.isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSearchDialog(false)}
                  disabled={testSearchMutation.isPending}
                >
                  Annulla
                </Button>
                <Button type="submit" disabled={testSearchMutation.isPending}>
                  {testSearchMutation.isPending ? 'Ricerca...' : 'Cerca'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={v => { if (!v) setRemoving(null); }}
        title="Rimuovi valore salvato"
        description={`Rimuove il valore salvato di questo campo, qualunque sia.${removing ? REMOVE_CONSEQUENCE[removing] ?? '' : ''}`}
        confirmText="Rimuovi"
        actionType="delete"
        onConfirm={() => { if (removing) remove(removing); }}
        isLoading={removeMutation.isPending}
      />
    </SettingsFormShell>
  );
}
