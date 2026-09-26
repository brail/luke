import React, { useMemo } from 'react';

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
 * Avatar component that displays a brand logo.
 *
 * Shows the brand logo if available, otherwise shows
 * the first 2 letters of the code as a fallback.
 */
export function BrandAvatar({
  brand,
  size = 'sm',
  className,
}: BrandAvatarProps) {
  // Determine the dimensions from the size prop
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  };

  // Build the initials from the code (first 2 characters)
  const initials = brand.code.substring(0, 2).toUpperCase();

  // Stable cache-busting based on the brand ID instead of Date.now()
  const logoUrlWithCacheBust = useMemo(() => {
    if (!brand.logoUrl) return null;
    return `${brand.logoUrl}?v=${brand.id}`;
  }, [brand.logoUrl, brand.id]);

  return (
    <Avatar className={`${sizeClasses[size]} ${className || ''}`}>
      {logoUrlWithCacheBust && (
        <AvatarImage
          src={logoUrlWithCacheBust}
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
