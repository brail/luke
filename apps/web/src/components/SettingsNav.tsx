'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/utils';

const settingsItems = [
  { href: '/settings/config', label: 'Config', icon: '⚙️' },
  { href: '/settings/users', label: 'Utenti', icon: '👥' },
  { href: '/settings/storage', label: 'Storage', icon: '💾' },
  { href: '/settings/mail', label: 'Mail', icon: '📧' },
  { href: '/settings/ldap', label: 'Auth (LDAP)', icon: '🔐' },
  { href: '/settings/import-export', label: 'Import/Export', icon: '📁' },
] as const;

export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <aside className="w-48 bg-card border-r border-border p-4 space-y-2">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-foreground">Impostazioni</h3>
      </div>

      {settingsItems.map(item => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <span className="text-sm">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
