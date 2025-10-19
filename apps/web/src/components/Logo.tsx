import React from 'react';

import { cn } from '../lib/utils';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
  xl: 'w-24 h-24',
};

export default function Logo({
  className,
  size = 'md',
  animated = false,
}: LogoProps) {
  return (
    <div className={cn(sizeClasses[size], className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 629.54 628.34"
        className={cn('w-full h-full', animated && 'animate-pulse')}
        fill="currentColor"
      >
        <circle cx="379.54" cy="50.00" r="14.49" />
        <circle cx="250.60" cy="51.45" r="15.10" />
        <circle cx="378.42" cy="121.64" r="28.65" />
        <circle cx="250.62" cy="121.80" r="28.65" />
        <circle cx="122.32" cy="121.83" r="28.65" />
        <circle cx="506.56" cy="122.38" r="28.65" />
        <circle cx="385.80" cy="242.42" r="50.26" />
        <circle cx="244.16" cy="242.67" r="50.26" />
        <circle cx="579.54" cy="250.00" r="14.49" />
        <circle cx="507.19" cy="250.41" r="29.60" />
        <circle cx="51.09" cy="250.50" r="14.49" />
        <circle cx="122.98" cy="250.83" r="29.60" />
        <circle cx="506.63" cy="377.52" r="29.60" />
        <circle cx="578.37" cy="377.78" r="14.49" />
        <circle cx="122.54" cy="377.89" r="29.60" />
        <circle cx="50.00" cy="378.34" r="14.49" />
        <circle cx="385.78" cy="385.72" r="50.26" />
        <circle cx="244.22" cy="385.89" r="50.26" />
        <circle cx="123.16" cy="506.26" r="28.65" />
        <circle cx="379.04" cy="506.85" r="28.65" />
        <circle cx="507.31" cy="506.91" r="28.65" />
        <circle cx="251.27" cy="507.02" r="28.65" />
        <circle cx="378.90" cy="576.86" r="15.10" />
        <circle cx="250.00" cy="578.34" r="14.49" />
      </svg>
    </div>
  );
}

