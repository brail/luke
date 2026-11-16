'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { LDAP_STRATEGIES, type LdapStrategy } from '@luke/core';

import { SectionCard } from '../../../../../components/SectionCard';
import { SettingsActions } from '../../../../../components/settings/SettingsActions';
import { Label } from '../../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { usePermission } from '../../../../../hooks/usePermission';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

const STRATEGY_LABELS: Record<LdapStrategy, string> = {
  'local-first': 'Locale prima, poi LDAP',
  'ldap-first': 'LDAP prima, poi locale',
  'local-only': 'Solo autenticazione locale',
  'ldap-only': 'Solo LDAP (admin locali come accesso di emergenza)',
};

/**
 * The sign-in strategy (`auth.strategy`), saved on its own (#246): the connection settings never
 * change it, and saving one leaves the other's unsaved edits alone. The server refuses `ldap-only`
 * without LDAP on or without an administrator who can sign in locally.
 *
 * @param stored - The strategy as the page last read it.
 * @param readAt - When the page read it (`dataUpdatedAt`): a new read, even of the same value, wins.
 */
export function LdapStrategyCard({ stored, readAt }: { stored: LdapStrategy; readAt: number }) {
  const { can } = usePermission();
  const canUpdate = can('config:update');

  // Not refetched after a save: the page would reset the connection form, and its unsaved edits, to
  // what it reads. What this card saved holds until the page reads a stored value again.
  const [saved, setSaved] = useState<{ readAt: number; value: LdapStrategy } | null>(null);
  const current = saved?.readAt === readAt ? saved.value : stored;
  const [draft, setDraft] = useState<LdapStrategy | null>(null);
  const strategy = draft ?? current;

  const saveMutation = trpc.integrations.auth.saveStrategy.useMutation({
    onSuccess: (_data, input) => {
      toast.success('Strategia di autenticazione salvata');
      setSaved({ readAt, value: input.strategy });
      setDraft(null);
    },
    onError: err => toast.error('Errore durante il salvataggio', { description: getTrpcErrorMessage(err) }),
  });

  return (
    <SectionCard title="Strategia di autenticazione" description="L'ordine in cui si provano l'accesso locale e LDAP">
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="ldap-strategy">Strategia</Label>
        <Select
          value={strategy}
          // Only the four items below can be chosen.
          onValueChange={value => setDraft(value as LdapStrategy)}
          disabled={!canUpdate}
        >
          <SelectTrigger id="ldap-strategy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LDAP_STRATEGIES.map(value => (
              <SelectItem key={value} value={value}>
                {STRATEGY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Si salva da sola: le modifiche ai parametri LDAP non la cambiano.
        </p>
      </div>
      {/* Its own name: the connection settings have their own save on the same page. */}
      <SettingsActions
        onSave={() => saveMutation.mutate({ strategy })}
        isSaving={saveMutation.isPending}
        disabled={!canUpdate || strategy === current}
        saveLabel="Salva strategia"
      />
    </SectionCard>
  );
}
