'use client';

import React from 'react';
import { Check, X } from 'lucide-react';
import { usePasswordValidation } from '../hooks/use-password-validation';

interface PasswordValidationIndicatorsProps {
  password: string;
  confirmPassword?: string;
  showConfirmPassword?: boolean;
  className?: string;
}

/**
 * Componente per mostrare gli indicatori di validazione password
 * Riutilizzabile in diversi form
 */
export function PasswordValidationIndicators({
  password,
  confirmPassword = '',
  showConfirmPassword = false,
  className = '',
}: PasswordValidationIndicatorsProps) {
  const { passwordChecks } = usePasswordValidation(password, confirmPassword);

  if (!password || password.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Indicatori validazione password */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          {passwordChecks.length ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-red-500" />
          )}
          <span
            className={
              passwordChecks.length ? 'text-green-700' : 'text-red-700'
            }
          >
            Almeno 12 caratteri
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          {passwordChecks.uppercase ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-red-500" />
          )}
          <span
            className={
              passwordChecks.uppercase ? 'text-green-700' : 'text-red-700'
            }
          >
            Una lettera maiuscola
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          {passwordChecks.lowercase ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-red-500" />
          )}
          <span
            className={
              passwordChecks.lowercase ? 'text-green-700' : 'text-red-700'
            }
          >
            Una lettera minuscola
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          {passwordChecks.number ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-red-500" />
          )}
          <span
            className={
              passwordChecks.number ? 'text-green-700' : 'text-red-700'
            }
          >
            Un numero
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          {passwordChecks.symbol ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-red-500" />
          )}
          <span
            className={
              passwordChecks.symbol ? 'text-green-700' : 'text-red-700'
            }
          >
            Un carattere speciale
          </span>
        </div>
      </div>

      {/* Indicatore conferma password */}
      {showConfirmPassword && confirmPassword && (
        <div className="flex items-center gap-2 text-sm">
          {passwordChecks.match ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-red-500" />
          )}
          <span
            className={passwordChecks.match ? 'text-green-700' : 'text-red-700'}
          >
            Le password coincidono
          </span>
        </div>
      )}
    </div>
  );
}
