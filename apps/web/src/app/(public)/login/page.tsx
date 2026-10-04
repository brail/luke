'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import React, { useState } from 'react';

import { AppVersionLabel } from '../../../components/AppVersionLabel';
import { BackendStatus } from '../../../components/BackendStatus';
import Logo from '../../../components/Logo';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { trpc } from '../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../lib/trpcErrorMessages';

import { PendingApproval } from './_components/PendingApproval';

/**
 * Login page with the form and Auth.js integration.
 * Uses shadcn/ui components for a consistent UI.
 */
export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pending, setPending] = useState<{ needsEmail: boolean } | null>(null);
  /** The login was refused for an unverified email: the page offers a new link. */
  const [unverified, setUnverified] = useState<'offered' | 'sending' | 'sent' | null>(null);
  const router = useRouter();
  const { client } = trpc.useUtils();

  const leavePending = () => {
    setPending(null);
    setPassword('');
  };

  // Through the vanilla client, not a mutation hook, which would keep the password in its cache.
  const resendVerification = async () => {
    setUnverified('sending');
    try {
      await client.auth.resendVerification.mutate({ username, password });
      setError('');
      setUnverified('sent');
    } catch (err) {
      setError(getTrpcErrorMessage(err, { UNAUTHORIZED: true, PRECONDITION_FAILED: true }));
      setUnverified('offered');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setUnverified(null);
    setIsLoading(true);

    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        // Auth.js v5 flattens every authorize() error to "CredentialsSignin"; `code` is the one
        // thing that tells them apart.
        if (result.code === 'unavailable') {
          setError('Servizio di autenticazione non disponibile. Riprova più tardi.');
          return;
        }
        if (result.code === 'throttled') {
          setError('Troppi tentativi. Riprova tra qualche minuto.');
          return;
        }

        // Sent only for a proven password (`LoginPending`). The password is kept for the email
        // form alone, and only until the flow ends.
        if (result.code === 'pending' || result.code === 'pending_email') {
          const needsEmail = result.code === 'pending_email';
          if (!needsEmail) setPassword('');
          setPending({ needsEmail });
          return;
        }

        // Like the pending codes, sent only for a proven password (`LoginEmailUnverified`).
        if (result.code === 'email_unverified') {
          setError(
            'Email non verificata. Controlla la tua casella di posta per il link di verifica.'
          );
          setUnverified('offered');
        } else {
          setError('Credenziali non valide');
        }
      } else {
        // Redirect to dashboard after successful login
        router.push('/dashboard');
      }
    } catch {
      setError('Errore durante il login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-muted/50">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <Logo size="xl" className="text-primary" />
          </div>
          <CardTitle className="text-2xl text-center">
            {pending ? 'Richiesta ricevuta' : 'Accedi'}
          </CardTitle>
          <CardDescription className="text-center">
            {pending
              ? 'Il tuo accesso è in attesa di approvazione'
              : 'Inserisci le tue credenziali per accedere'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending ? (
            <PendingApproval
              username={username}
              password={password}
              needsEmail={pending.needsEmail}
              onSaved={() => setPassword('')}
              onBack={leavePending}
            />
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Inserisci username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    disabled={isLoading}
                    autoComplete="username"
                    suppressHydrationWarning
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Inserisci password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    autoComplete="current-password"
                    suppressHydrationWarning
                  />
                </div>
                {error && (
                  <div className="text-sm text-destructive text-center">
                    {error}
                  </div>
                )}
                {unverified === 'sent' && (
                  <div className="text-sm text-muted-foreground text-center">
                    Ti abbiamo inviato un nuovo link di verifica.
                  </div>
                )}
                {(unverified === 'offered' || unverified === 'sending') && (
                  <Button
                    type="button"
                    variant="link"
                    className="w-full"
                    onClick={resendVerification}
                    disabled={unverified === 'sending'}
                  >
                    {unverified === 'sending' ? 'Invio...' : 'Invia di nuovo il link di verifica'}
                  </Button>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Accesso...' : 'Accedi'}
                </Button>
              </form>
              <div className="text-center text-sm mt-2">
                <Link
                  href="/auth/reset"
                  className="text-primary hover:underline"
                >
                  Password dimenticata?
                </Link>
              </div>
            </>
          )}
          <div className="mt-4">
            <BackendStatus />
          </div>
          {/* 10px: below Tailwind's text-xs (12px) floor; unobtrusive footer version tag */}
          <AppVersionLabel className="mt-3 text-center text-[10px] text-muted-foreground/50 select-none" />
        </CardContent>
      </Card>
    </div>
  );
}
