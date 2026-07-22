'use client';

import { ShieldAlert } from 'lucide-react';

import Logo from '../Logo';

interface MaintenanceLockScreenProps {
  message: string | null;
}

/**
 * Full-screen block shown to non-admin users while maintenance mode is `ACTIVE`.
 * Covers the app (fixed overlay, high z-index) rather than unmounting it, so the app tree
 * stays intact and simply reappears once the state flips back to `INACTIVE`.
 */
export function MaintenanceLockScreen({ message }: MaintenanceLockScreenProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="mx-4 flex max-w-md flex-col items-center gap-4 text-center">
        <Logo size="xl" className="text-primary" />
        <ShieldAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">Sistema in manutenzione</h1>
        <p className="text-sm text-muted-foreground">
          {message || 'Il sistema è temporaneamente non disponibile per manutenzione. Riprova tra qualche minuto.'}
        </p>
      </div>
    </div>
  );
}
