'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/settings/config', label: 'Impostazioni', icon: '⚙️' },
] as const;

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-56 bg-card border-r border-border p-4 space-y-2">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Luke</h2>
        <p className="text-sm text-muted-foreground">Console Amministrativa</p>
      </div>

      {navItems.map(item => {
        // Per "Impostazioni", evidenzia se siamo in qualsiasi sezione delle impostazioni
        const isActive =
          item.href === '/settings/config'
            ? pathname.startsWith('/settings/')
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
