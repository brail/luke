'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import React, { useEffect } from 'react';

import AppSidebar from '../../components/AppSidebar';
import BreadcrumbNav from '../../components/BreadcrumbNav';
import LoadingLogo from '../../components/LoadingLogo';
import { SidebarProvider, SidebarTrigger } from '../../components/ui/sidebar';

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
          <LoadingLogo size="lg" className="text-primary mx-auto mb-4" />
          <p>Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null; // Mostra nulla mentre useEffect fa il redirect
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          {/* Header comune */}
          <header className="border-b bg-card">
            <div className="flex items-center gap-4 px-4 py-4">
              <SidebarTrigger />
              <BreadcrumbNav />
            </div>
          </header>

          {/* Contenuto principale */}
          <main className="flex-1 p-6 overflow-y-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
