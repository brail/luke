'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import React, { useEffect, useState, Suspense } from 'react';

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
import { trpc } from '../../../../lib/trpc';

/**
 * Componente interno con useSearchParams
 */
function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading'
  );
  const [message, setMessage] = useState('');

  // tRPC mutation
  const verifyEmailMutation = trpc.auth.confirmEmailVerification.useMutation();

  useEffect(() => {
    // Se non c'è token, mostra errore
    if (!token) {
      setStatus('error');
      setMessage("Token di verifica mancante. Controlla il link nell'email.");
      return;
    }

    // Auto-trigger della verifica (solo al mount)
    const verifyEmail = async () => {
      try {
        const result = await verifyEmailMutation.mutateAsync({ token });
        setStatus('success');
        setMessage(result.message || 'Email verificata con successo!');
      } catch (err: any) {
        setStatus('error');
        setMessage(
          err?.message ||
            'Errore durante la verifica. Il token potrebbe essere scaduto o non valido.'
        );
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-4">
            <Logo size="xl" className="text-primary" />
          </div>
          <CardTitle className="text-2xl text-center">Verifica Email</CardTitle>
          <CardDescription className="text-center">
            {status === 'loading' && 'Verifica in corso...'}
            {status === 'success' && 'Verifica completata'}
            {status === 'error' && 'Verifica fallita'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Loading state */}
            {status === 'loading' && (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div>
            )}

            {/* Success state */}
            {status === 'success' && (
              <>
                <Alert>
                  <AlertDescription className="text-green-600 flex items-center gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{message}</span>
                  </AlertDescription>
                </Alert>

                <div className="text-center text-sm text-muted-foreground">
                  <p className="mb-4">
                    La tua email è stata verificata con successo. Ora puoi
                    accedere alla tua dashboard.
                  </p>
                </div>

                <Button asChild className="w-full">
                  <Link href="/login">Vai al Login</Link>
                </Button>
              </>
            )}

            {/* Error state */}
            {status === 'error' && (
              <>
                <Alert variant="destructive">
                  <AlertDescription className="flex items-center gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{message}</span>
                  </AlertDescription>
                </Alert>

                <div className="text-center text-sm text-muted-foreground">
                  <p className="mb-4">
                    Il link di verifica potrebbe essere scaduto o già
                    utilizzato. Puoi richiedere un nuovo link di verifica.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Button asChild className="w-full">
                    <Link href="/login">Vai al Login</Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Pagina Verifica Email con Suspense boundary
 * Richiede token come query parameter
 * Auto-trigger della verifica in useEffect
 */
export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-muted/50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
