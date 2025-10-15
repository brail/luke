/**
 * Badge per visualizzare la categoria di una configurazione
 * Mostra icona e colore appropriati per ogni categoria
 */

import { Badge } from '../ui/badge';
import { getCategoryIcon, getCategoryColor } from '../../lib/config-helpers';
import {
  Shield,
  Settings,
  Lock,
  Mail,
  HardDrive,
  DollarSign,
  Palette,
} from 'lucide-react';

interface ConfigKeyBadgeProps {
  category: string;
  className?: string;
}

const iconComponents = {
  Shield,
  Settings,
  Lock,
  Mail,
  HardDrive,
  DollarSign,
  Palette,
};

export function ConfigKeyBadge({
  category,
  className = '',
}: ConfigKeyBadgeProps) {
  const iconName = getCategoryIcon(category);
  const colorClass = getCategoryColor(category);
  const IconComponent =
    iconComponents[iconName as keyof typeof iconComponents] || Settings;

  return (
    <Badge variant="outline" className={`${colorClass} ${className}`}>
      <IconComponent className="w-3 h-3 mr-1" />
      {category}
    </Badge>
  );
}

