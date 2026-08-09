'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { Button } from '../ui/button';

interface RetryButtonProps {
  onRetry?: () => void;
  autoFocus?: boolean;
}

/**
 * Button that triggers a retry action or falls back to `router.refresh()` if no callback is provided.
 *
 * @param onRetry - Optional callback; when omitted, the Next.js router is refreshed instead.
 */
export function RetryButton({ onRetry, autoFocus }: RetryButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    try {
      setIsLoading(true);
      if (onRetry) {
        onRetry();
      } else {
        router.refresh();
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      aria-label="Riprova"
      disabled={isLoading}
      autoFocus={autoFocus}
    >
      {isLoading ? 'Riprovo…' : 'Riprova'}
    </Button>
  );
}
