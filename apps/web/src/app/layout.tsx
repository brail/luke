import React from 'react';
import { Toaster } from 'sonner';

import Providers from '../components/Providers';

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LUKE',
  description: 'Piattaforma Luke',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className="bg-background text-foreground">
        <Providers>{children}</Providers>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
