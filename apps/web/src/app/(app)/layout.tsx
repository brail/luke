'use client';

import React from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '../../components/ui/button';
import Sidebar from '../../components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    router.push('/login');
    return null;
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header comune */}
      <header className="border-b bg-card">
        <div className="flex justify-between items-center px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground">Luke Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Benvenuto, {session.user?.name || session.user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Layout principale con sidebar */}
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
