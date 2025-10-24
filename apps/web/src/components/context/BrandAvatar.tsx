import React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

/**
 * Props per BrandAvatar
 */
interface BrandAvatarProps {
  /** URL del logo del brand */
  logoUrl: string | null;
  /** Codice del brand per fallback */
  code: string;
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
  logoUrl,
  code,
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
  const initials = code.substring(0, 2).toUpperCase();

  return (
    <Avatar className={`${sizeClasses[size]} ${className || ''}`}>
      {logoUrl && (
        <AvatarImage
          src={logoUrl}
          alt={`Logo ${code}`}
          className="object-cover"
        />
      )}
      <AvatarFallback className="text-xs font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
