'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import React, { useEffect } from 'react';

import AppSidebar from '../../components/AppSidebar';
import { ContextGate } from '../../components/context/ContextGate';
import { ContextSelector } from '../../components/context/ContextSelector';
import { DailyGreetingModal } from '../../components/DailyGreetingModal';
import { HeartbeatTicker } from '../../components/HeartbeatTicker';
import LoadingLogo from '../../components/LoadingLogo';
import { NotificationDropdown } from '../../components/NotificationDropdown';
import { SidebarProvider, SidebarTrigger, useSidebar } from '../../components/ui/sidebar';
import { AppContextProvider } from '../../contexts/AppContextProvider';

function CollapsedSidebarTrigger() {
  const { state } = useSidebar();
  if (state !== 'collapsed') return null;
  return <SidebarTrigger />;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Redirect to login when not authenticated (avoids setState during render)
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
    return null; // Render nothing while useEffect redirects
  }

  return (
    <AppContextProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full bg-background">
          <AppSidebar />
          {/* min-w-0: the column shrinks to the space left by the sidebar, so wide content
              scrolls inside its own container instead of widening the page. */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Shared header */}
            <header className="shrink-0 border-b bg-card">
              <div className="flex items-center px-4 py-2">
                <CollapsedSidebarTrigger />
                <div className="ml-auto flex items-center gap-2">
                  <NotificationDropdown />
                  <ContextSelector />
                </div>
              </div>
            </header>

            {/* Main content: the only scroll container of the shell. `relative` makes it the
                containing block of absolutely positioned descendants too (the hidden form
                inputs of Radix's Switch and Select), so they cannot stretch the document. */}
            <main className="relative flex-1 overflow-y-auto p-6">
              {children}
            </main>
          </div>
        </div>

        {/* Blocking modal for context setup */}
        <ContextGate />

        {/* Silent heartbeat for online presence */}
        <HeartbeatTicker />

        {/* Daily greeting modal, once a day per browser */}
        <DailyGreetingModal />
      </SidebarProvider>
    </AppContextProvider>
  );
}
