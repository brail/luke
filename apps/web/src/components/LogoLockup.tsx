import React from 'react';

import { cn } from '../lib/utils';

import Logo from './Logo';

/**
 * Icon size and wordmark size per lockup; the wordmark's other side follows its ≈ 4.1:1 ratio. The
 * icon's viewBox pads its dots by about 5 % on each side, which the gaps below account for.
 */
const variants = {
  // Navigation: the wordmark's cap height is half the icon's box.
  horizontal: { root: 'flex-row gap-3', icon: 'h-8 w-8', wordmark: 'h-4 w-auto' },
  // Full-page screens: the wordmark a little wider than the dots, as in the artwork, and about 0.6×
  // its own height below them (8 px gap + the icon's 5 px padding, for a 23.5 px wordmark).
  stacked: { root: 'flex-col gap-2', icon: 'h-24 w-24', wordmark: 'h-auto w-24' },
} as const;

interface LogoLockupProps {
  variant: keyof typeof variants;
}

/**
 * The Luke icon with the LUKE wordmark, announced once as "Luke": `role="img"` makes both SVGs
 * presentational. The icon takes `primary`, the wordmark the surrounding text colour.
 */
export default function LogoLockup({ variant }: LogoLockupProps) {
  const { root, icon, wordmark } = variants[variant];
  return (
    <span role="img" aria-label="Luke" className={cn('flex items-center', root)}>
      <Logo className={cn(icon, 'text-primary')} />
      {/* width/height give the ratio to the auto side in every engine; the class sets the size. */}
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 421 103" width="421" height="103" fill="currentColor" className={wordmark}>
        <path d="M0 0H18V84H86V101H0Z" />
        <path d="M99 0H117V54C117 75 129 86 150 86C171 86 184 75 184 54V0H202V55C202 86 182 103 150 103C118 103 99 86 99 55Z" />
        <path d="M221 0H239V52L296 0H321L270 47L321 101H297L257 58L239 75V101H221Z" />
        <path d="M334 0H421V17H352V42H409V59H352V84H421V101H334Z" />
      </svg>
    </span>
  );
}
