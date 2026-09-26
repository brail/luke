import { HardDrive, Lock, Plug, Settings, Shield, type LucideIcon } from 'lucide-react';

import type { ConfigRouterPrefix } from '@luke/core';

import { Badge } from '../ui/badge';

interface ConfigKeyBadgeProps {
  category: string;
  className?: string;
}

// Keyed by the router's prefixes: a new prefix without an icon and a color does not compile.
const CATEGORY_STYLES: Record<ConfigRouterPrefix, { icon: LucideIcon; className: string }> = {
  app: { icon: Settings, className: 'bg-gray-100 text-gray-800' },
  auth: { icon: Shield, className: 'bg-blue-100 text-blue-800' },
  storage: { icon: HardDrive, className: 'bg-purple-100 text-purple-800' },
  security: { icon: Lock, className: 'bg-red-100 text-red-800' },
  integrations: { icon: Plug, className: 'bg-orange-100 text-orange-800' },
};

const FALLBACK_STYLE = { icon: Settings, className: 'bg-gray-100 text-gray-800' };

/**
 * Badge displaying the category of an AppConfig key with a matching icon and color.
 *
 * An unknown category (a key outside the router's prefixes) gets the neutral `app` look.
 */
export function ConfigKeyBadge({
  category,
  className = '',
}: ConfigKeyBadgeProps) {
  const styles: Partial<Record<string, { icon: LucideIcon; className: string }>> = CATEGORY_STYLES;
  const { icon: IconComponent, className: colorClass } = styles[category] ?? FALLBACK_STYLE;

  return (
    <Badge variant="outline" className={`${colorClass} ${className}`}>
      <IconComponent className="w-3 h-3 mr-1" />
      {category}
    </Badge>
  );
}