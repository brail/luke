'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { Button } from '../ui/button';

interface RetryButtonProps {
  onRetry?: () => void;
  autoFocus?: boolean;
}

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
