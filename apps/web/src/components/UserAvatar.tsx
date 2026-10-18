import React from 'react';

import { cn } from '../lib/utils';

interface UserAvatarProps {
  /** User first name */
  firstName: string;
  /** User last name */
  lastName: string;
  /** Avatar size */
  size?: 'sm' | 'md' | 'lg';
  /** Extra CSS classes */
  className?: string;
}

/**
 * Generates a consistent colour from a string.
 * Uses a simple hash so the same name always gets the same colour.
 */
function generateColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Generate an HSL colour with fixed saturation and lightness
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Extracts the initials from first and last name.
 */
function getInitials(firstName: string, lastName: string): string {
  const firstInitial = firstName.charAt(0).toUpperCase();
  const lastInitial = lastName.charAt(0).toUpperCase();
  return `${firstInitial}${lastInitial}`;
}

/**
 * Ottiene le classi CSS per la dimensione
 */
function getSizeClasses(size: 'sm' | 'md' | 'lg'): string {
  switch (size) {
    case 'sm':
      return 'h-8 w-8 text-xs';
    case 'md':
      return 'h-12 w-12 text-sm';
    case 'lg':
      return 'h-16 w-16 text-lg';
    default:
      return 'h-12 w-12 text-sm';
  }
}

/**
 * Circular avatar that renders the user's initials on a deterministic color background.
 *
 * The background color is derived from a simple hash of the full name so the same
 * user always gets the same color across sessions.
 *
 * @param size - Controls dimensions: `sm` 32 px, `md` 48 px, `lg` 64 px.
 */
export function UserAvatar({
  firstName,
  lastName,
  size = 'md',
  className,
}: UserAvatarProps) {
  // Genera le iniziali
  const initials = getInitials(firstName, lastName);

  // Generate the background colour from the full name
  const backgroundColor = generateColorFromName(`${firstName} ${lastName}`);

  // Ottieni le classi per la dimensione
  const sizeClasses = getSizeClasses(size);

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium text-white',
        sizeClasses,
        className
      )}
      style={{ backgroundColor }}
      role="img"
      aria-label={`Avatar di ${firstName} ${lastName}`}
    >
      {initials}
    </div>
  );
}
