'use client';

import { Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';

// Mappa dei percorsi per le etichette in italiano
const pathLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/settings': 'Impostazioni',
  '/settings/users': 'Utenti',
  '/settings/storage': 'Storage',
  '/settings/mail': 'Mail',
  '/settings/ldap': 'Auth LDAP',
  '/settings/access': 'Accesso',
  '/maintenance': 'Manutenzione',
  '/maintenance/config': 'Configurazioni',
  '/maintenance/import-export': 'Import/Export',
};

// Mappa dei percorsi per i link di navigazione
const pathLinks: Record<string, string> = {
  '/dashboard': '/dashboard',
  '/settings': '/settings',
  '/settings/users': '/settings/users',
  '/settings/storage': '/settings/storage',
  '/settings/mail': '/settings/mail',
  '/settings/ldap': '/settings/ldap',
  '/settings/access': '/settings/access',
  '/maintenance': '/maintenance',
  '/maintenance/config': '/maintenance/config',
  '/maintenance/import-export': '/maintenance/import-export',
};

// Tipo per gli elementi del breadcrumb
interface BreadcrumbNavItem {
  label: string;
  href: string;
  isLast: boolean;
  icon: React.ReactNode;
  isClickable: boolean;
}

export default function BreadcrumbNav() {
  const pathname = usePathname();

  // Genera il breadcrumb basato sul pathname corrente
  const generateBreadcrumb = (): BreadcrumbNavItem[] => {
    const segments = pathname.split('/').filter(Boolean);
    const breadcrumbItems: BreadcrumbNavItem[] = [];

    // Aggiungi sempre Home come primo elemento
    breadcrumbItems.push({
      label: 'Home',
      href: '/dashboard',
      isLast: false,
      icon: <Home size={16} />,
      isClickable: true,
    });

    // Costruisci il percorso progressivo
    let currentPath = '';
    segments.forEach((segment, index) => {
      currentPath += `/${segment}`;
      const isLast = index === segments.length - 1;

      // "Impostazioni" non è cliccabile
      const isClickable = currentPath !== '/settings' && !isLast;

      breadcrumbItems.push({
        label: pathLabels[currentPath] || segment,
        href: pathLinks[currentPath] || currentPath,
        isLast,
        icon: null,
        isClickable,
      });
    });

    return breadcrumbItems;
  };

  const breadcrumbItems = generateBreadcrumb();

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbItems.map((item, index) => (
          <React.Fragment key={`${item.href}-${index}`}>
            <BreadcrumbItem>
              {item.isLast || !item.isClickable ? (
                <BreadcrumbPage className="flex items-center gap-1">
                  {item.icon}
                  {item.label}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link
                    href={item.href as any}
                    className="flex items-center gap-1"
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {!item.isLast && <BreadcrumbSeparator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
