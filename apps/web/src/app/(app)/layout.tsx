'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import React, { useEffect } from 'react';

import AppSidebar from '../../components/AppSidebar';
import BreadcrumbNav from '../../components/BreadcrumbNav';
import { ContextGate } from '../../components/context/ContextGate';
import { ContextSelector } from '../../components/context/ContextSelector';
import { HeartbeatTicker } from '../../components/HeartbeatTicker';
import LoadingLogo from '../../components/LoadingLogo';
import { SidebarProvider, SidebarTrigger } from '../../components/ui/sidebar';
import { AppContextProvider } from '../../contexts/AppContextProvider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Redirect a login se non autenticato (evita setState durante render)
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto aspect-square w-24 max-w-full text-primary mb-4">
            <LoadingLogo size="xl" className="w-full h-full object-contain" />
          </div>
          <p>Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null; // Mostra nulla mentre useEffect fa il redirect
  }

  return (
    <AppContextProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Header comune */}
            <header className="sticky top-0 z-10 shrink-0 border-b bg-card">
              <div className="flex items-center gap-4 justify-between px-4 py-2">
                <div className="flex items-center gap-4">
                  <SidebarTrigger />
                  <BreadcrumbNav />
                </div>
                <ContextSelector />
              </div>
            </header>

            {/* Contenuto principale */}
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>

        {/* Modale bloccante per setup context */}
        <ContextGate />

        {/* Heartbeat silenzioso per presenza online */}
        <HeartbeatTicker />
      </SidebarProvider>
    </AppContextProvider>
  );
}
