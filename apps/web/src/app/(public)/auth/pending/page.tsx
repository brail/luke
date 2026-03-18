'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useState } from 'react';

import Logo from '../../../../components/Logo';
import { Button } from '../../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { trpc } from '../../../../lib/trpc';
import { useStandardMutation } from '../../../../lib/useStandardMutation';

/**
 * Pagina mostrata agli utenti LDAP dopo il primo login.
 * L'account è stato creato ma deve essere approvato da un admin.
 * Se l'email non è disponibile da LDAP, l'utente può fornirla qui.
 */
export default function PendingApprovalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const username = searchParams.get('u') || '';
  const needsEmail = searchParams.get('se') === '1';

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submitEmailMutation = trpc.auth.submitPendingEmail.useMutation();

  const { mutate: submitEmail, isPending } = useStandardMutation({
    mutateFn: submitEmailMutation.mutateAsync,
    onSuccessMessage: 'Email salvata con successo',
    onErrorMessage: "Errore nel salvataggio dell'email",
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !username) return;
    submitEmail({ username, email });
  };

  return (
    <div className="flex h-screen items-center justify-center bg-muted/50">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <Logo size="xl" className="text-primary" />
          </div>
          <CardTitle className="text-2xl text-center">
            Richiesta ricevuta
          </CardTitle>
          <CardDescription className="text-center">
            Il tuo accesso è in attesa di approvazione
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p>
              La tua richiesta di accesso è andata a buon fine. Un
              amministratore deve abilitare il tuo account prima che tu possa
              accedere al sistema.
            </p>
            <p className="mt-2">
              Riceverai una comunicazione quando il tuo account sarà attivato.
            </p>
          </div>

          {needsEmail && !submitted && (
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                Non abbiamo trovato un indirizzo email associato al tuo account.
                Inseriscilo qui per essere contattato quando il tuo account
                sarà attivato.
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Indirizzo email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="nome@esempio.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={isPending}
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Salvataggio...' : 'Salva email'}
              </Button>
            </form>
          )}

          {submitted && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
              Email salvata. Sarai contattato all&apos;indirizzo fornito
              quando il tuo account sarà attivato.
            </div>
          )}

          <div className="pt-2 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/login')}
            >
              Torna al login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
