'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';

/**
 * Pagina di login con form e integrazione Auth.js
 * Usa componenti shadcn/ui per UI consistente
 */
export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Credenziali non valide');
      } else {
        // Redirect a dashboard dopo login riuscito
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
          <CardTitle className="text-2xl text-center">Accedi</CardTitle>
          <CardDescription className="text-center">
            Inserisci le tue credenziali per accedere
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              />
            </div>
            {error && (
              <div className="text-sm text-destructive text-center">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Accesso...' : 'Accedi'}
            </Button>
          </form>
          <div className="mt-4 text-xs text-muted-foreground text-center">
            <p>Demo: inserisci qualsiasi username e password</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
