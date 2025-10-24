import React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

/**
 * Props per BrandAvatar
 */
interface BrandAvatarProps {
  /** Oggetto brand completo */
  brand: {
    id: string;
    code: string;
    name: string;
    logoUrl: string | null;
    isActive: boolean;
  };
  /** Dimensione dell'avatar */
  size?: 'sm' | 'md' | 'lg';
  /** Classi CSS aggiuntive */
  className?: string;
}

/**
 * Componente Avatar per visualizzare il logo di un brand
 *
 * Mostra il logo del brand se disponibile, altrimenti mostra
 * le prime 2 lettere del codice come fallback.
 */
export function BrandAvatar({
  brand,
  size = 'sm',
  className,
}: BrandAvatarProps) {
  // Determina le dimensioni in base alla prop size
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  };

  // Genera le iniziali dal codice (prime 2 caratteri)
  const initials = brand.code.substring(0, 2).toUpperCase();

  return (
    <Avatar className={`${sizeClasses[size]} ${className || ''}`}>
      {brand.logoUrl && (
        <AvatarImage
          src={brand.logoUrl}
          alt={`Logo ${brand.code}`}
          className="object-cover"
        />
      )}
      <AvatarFallback className="text-xs font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
