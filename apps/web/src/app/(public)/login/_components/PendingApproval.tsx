'use client';

import React, { useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

/**
 * What the login page shows, in place of its form, to an LDAP user whose account awaits approval.
 *
 * Reached only from a login the API refused after proving the password (`LoginPending`), which is
 * why it may use that password: `auth.submitPendingEmail` takes it as the proof of identity when
 * the directory had no address to give. The page holds the password; `onSaved` and `onBack` are
 * where it drops it.
 *
 * The call goes through the vanilla client, not a mutation hook: TanStack keeps a mutation's
 * variables — the password among them — in its cache after the call settles, for minutes after
 * this component is gone.
 */
export function PendingApproval({
  username,
  password,
  needsEmail,
  onSaved,
  onBack,
}: {
  username: string;
  password: string;
  needsEmail: boolean;
  onSaved: () => void;
  onBack: () => void;
}) {
  const { client } = trpc.useUtils();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    setError('');
    try {
      await client.auth.submitPendingEmail.mutate({ username, password, email });
      setStatus('saved');
      onSaved();
    } catch (err) {
      setError(getTrpcErrorMessage(err, { UNAUTHORIZED: true, CONFLICT: true, PRECONDITION_FAILED: true }));
      setStatus('idle');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
        <p>
          La tua richiesta di accesso è andata a buon fine. Un amministratore deve abilitare il tuo
          account prima che tu possa accedere al sistema.
        </p>
        {!needsEmail && (
          <p className="mt-2">
            Sarai contattato all&apos;indirizzo registrato quando il tuo account sarà attivato.
          </p>
        )}
      </div>

      {needsEmail && status !== 'saved' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm">
            Non abbiamo trovato un indirizzo email associato al tuo account. Inseriscilo qui per
            essere contattato quando il tuo account sarà attivato.
          </p>
          <div className="space-y-2">
            <Label htmlFor="pending-email">Indirizzo email</Label>
            <Input
              id="pending-email"
              type="email"
              placeholder="nome@esempio.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={status === 'saving'}
              autoComplete="email"
            />
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <Button type="submit" className="w-full" disabled={status === 'saving'}>
            {status === 'saving' ? 'Salvataggio...' : 'Salva email'}
          </Button>
        </form>
      )}

      {status === 'saved' && (
        <div className="rounded-lg border p-3 text-sm">
          Email salvata: sarai contattato a quell&apos;indirizzo quando il tuo account sarà
          attivato.
        </div>
      )}

      <div className="text-center">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Torna al login
        </Button>
      </div>
    </div>
  );
}
