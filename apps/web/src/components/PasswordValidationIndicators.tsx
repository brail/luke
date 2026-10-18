'use client';

import { Check, X } from 'lucide-react';
import React from 'react';

import { usePasswordValidation } from '../hooks/usePasswordValidation';

interface PasswordValidationIndicatorsProps {
  password: string;
  confirmPassword?: string;
  showConfirmPassword?: boolean;
  className?: string;
}

/**
 * Real-time password checklist rendered below a password input.
 *
 * The requirements come from the policy the server applies, not from a list written here: a
 * requirement the installation switched off is absent rather than shown as a tick that will never
 * turn green, and the minimum length is the configured one. The checklist used to be five
 * hardcoded rows saying 12 characters and "a symbol" whatever was configured — and "a symbol"
 * covered `~` and a space, which the server refuses.
 *
 * Renders nothing while the field is empty.
 *
 * @param showConfirmPassword - When true, also shows the "passwords match" indicator.
 * @param confirmPassword - Required only when `showConfirmPassword` is true.
 */
export function PasswordValidationIndicators({
  password,
  confirmPassword = '',
  showConfirmPassword = false,
  className = '',
}: PasswordValidationIndicatorsProps) {
  const { checks } = usePasswordValidation(
    password,
    showConfirmPassword ? confirmPassword : undefined
  );

  if (!password || password.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {checks.map(check => (
        <div key={check.key} className="flex items-center gap-2 text-sm">
          {check.met ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-red-500" />
          )}
          <span className={check.met ? 'text-green-700' : 'text-red-700'}>{check.label}</span>
        </div>
      ))}
    </div>
  );
}
