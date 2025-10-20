'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useState, useEffect, Suspense } from 'react';

import Logo from '../../../../components/Logo';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
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

/**
 * Componente interno con useSearchParams
 */
function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // tRPC mutations
  const requestResetMutation = trpc.auth.requestPasswordReset.useMutation();
  const confirmResetMutation = trpc.auth.confirmPasswordReset.useMutation();

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  /**
   * Handler per richiesta reset password
   */
  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      const result = await requestResetMutation.mutateAsync({ email });
      setSuccess(
        result.message ||
          "Se l'email esiste, riceverai un link per reimpostare la password."
      );
      setEmail(''); // Clear form
    } catch (err: any) {
      setError(
        err?.message ||
          'Errore durante la richiesta di reset. Riprova più tardi.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handler per conferma reset password con token
   */
  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validazione password match
    if (newPassword !== confirmPassword) {
      setError('Le password non corrispondono');
      return;
    }

    // Validazione lunghezza minima
    if (newPassword.length < 12) {
      setError('La password deve essere di almeno 12 caratteri');
      return;
    }

    setIsLoading(true);

    try {
      const result = await confirmResetMutation.mutateAsync({
        token: token!,
        newPassword,
      });

      setSuccess(
        result.message ||
          'Password reimpostata con successo! Reindirizzamento...'
      );

      // Redirect to login dopo 2 secondi
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: any) {
      setError(
        err?.message ||
          'Errore durante il reset della password. Il token potrebbe essere scaduto.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <Logo size="xl" className="text-primary" />
          </div>
          <CardTitle className="text-2xl text-center">
            {token ? 'Reimposta Password' : 'Reset Password'}
          </CardTitle>
          <CardDescription className="text-center">
            {token
              ? 'Inserisci la tua nuova password'
              : 'Inserisci la tua email per ricevere il link di reset'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Form richiesta reset (senza token) */}
          {!token && (
            <form onSubmit={handleRequestReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tua@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert>
                  <AlertDescription className="text-green-600">
                    {success}
                  </AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Invio in corso...' : 'Invia link di reset'}
              </Button>

              <div className="text-center text-sm">
                <Link href="/login" className="text-primary hover:underline">
                  Torna al login
                </Link>
              </div>
            </form>
          )}

          {/* Form conferma reset (con token) */}
          {token && (
            <form onSubmit={handleConfirmReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nuova Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Nuova password (min 12 caratteri)"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="new-password"
                  minLength={12}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Conferma Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Conferma nuova password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="new-password"
                  minLength={12}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert>
                  <AlertDescription className="text-green-600">
                    {success}
                  </AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Aggiornamento...' : 'Reimposta Password'}
              </Button>

              <div className="text-center text-sm">
                <Link href="/login" className="text-primary hover:underline">
                  Torna al login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Pagina Reset Password con Suspense boundary
 * - Senza token: form per richiedere reset via email
 * - Con token: form per impostare nuova password
 */
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-muted/50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
