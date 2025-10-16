'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, type ChangePasswordInput } from '@luke/core';
import { trpc } from '../../../../lib/trpc';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { toast } from 'sonner';
import { Loader2, Check, X, Eye, EyeOff } from 'lucide-react';
import { SectionCard } from '../../../../components/SectionCard';

interface ChangePasswordCardProps {
  /** Se il componente deve essere visibile */
  visible: boolean;
}

/**
 * Componente per il cambio password con validazione policy in tempo reale
 */
export function ChangePasswordCard({ visible }: ChangePasswordCardProps) {
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  // Form setup con validazione Zod
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
  });

  // Watch per validazione policy in tempo reale
  const newPassword = watch('newPassword', '');
  const confirmPassword = watch('confirmNewPassword', '');

  // Mutation per cambio password
  const changePasswordMutation = trpc.me.changePassword.useMutation({
    onSuccess: () => {
      toast.success('Password cambiata con successo');
      reset(); // Reset form
      setShowPasswords({ current: false, new: false, confirm: false });
    },
    onError: error => {
      toast.error(`Errore nel cambio password: ${error.message}`);
    },
  });

  // Handler per submit form
  const onSubmit = (data: ChangePasswordInput) => {
    changePasswordMutation.mutate(data);
  };

  // Validazione policy password in tempo reale
  const passwordChecks = {
    length: newPassword.length >= 12,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    symbol: /[^A-Za-z0-9]/.test(newPassword),
    match: newPassword === confirmPassword && confirmPassword.length > 0,
  };

  // Toggle visibilità password
  const togglePasswordVisibility = (field: 'current' | 'new' | 'confirm') => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  if (!visible) {
    return null;
  }

  return (
    <SectionCard
      title="Sicurezza"
      description="Cambia la tua password per mantenere l'account sicuro"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Password Corrente */}
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Password Corrente</Label>
          <div className="relative">
            <Input
              id="currentPassword"
              type={showPasswords.current ? 'text' : 'password'}
              {...register('currentPassword')}
              className={`pr-10 ${errors.currentPassword ? 'border-destructive' : ''}`}
              aria-invalid={!!errors.currentPassword}
              aria-describedby={
                errors.currentPassword ? 'currentPassword-error' : undefined
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={() => togglePasswordVisibility('current')}
            >
              {showPasswords.current ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
          {errors.currentPassword && (
            <p id="currentPassword-error" className="text-sm text-destructive">
              {errors.currentPassword.message}
            </p>
          )}
        </div>

        {/* Nuova Password */}
        <div className="space-y-2">
          <Label htmlFor="newPassword">Nuova Password</Label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showPasswords.new ? 'text' : 'password'}
              {...register('newPassword')}
              className={`pr-10 ${errors.newPassword ? 'border-destructive' : ''}`}
              aria-invalid={!!errors.newPassword}
              aria-describedby={
                errors.newPassword ? 'newPassword-error' : undefined
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={() => togglePasswordVisibility('new')}
            >
              {showPasswords.new ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
          {errors.newPassword && (
            <p id="newPassword-error" className="text-sm text-destructive">
              {errors.newPassword.message}
            </p>
          )}
        </div>

        {/* Conferma Nuova Password */}
        <div className="space-y-2">
          <Label htmlFor="confirmNewPassword">Conferma Nuova Password</Label>
          <div className="relative">
            <Input
              id="confirmNewPassword"
              type={showPasswords.confirm ? 'text' : 'password'}
              {...register('confirmNewPassword')}
              className={`pr-10 ${errors.confirmNewPassword ? 'border-destructive' : ''}`}
              aria-invalid={!!errors.confirmNewPassword}
              aria-describedby={
                errors.confirmNewPassword
                  ? 'confirmNewPassword-error'
                  : undefined
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={() => togglePasswordVisibility('confirm')}
            >
              {showPasswords.confirm ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
          {errors.confirmNewPassword && (
            <p
              id="confirmNewPassword-error"
              className="text-sm text-destructive"
            >
              {errors.confirmNewPassword.message}
            </p>
          )}
        </div>

        {/* Policy Password */}
        {newPassword && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Requisiti Password</Label>
            <div className="space-y-1 text-sm">
              <div
                className={`flex items-center gap-2 ${passwordChecks.length ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {passwordChecks.length ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Almeno 12 caratteri
              </div>
              <div
                className={`flex items-center gap-2 ${passwordChecks.uppercase ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {passwordChecks.uppercase ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Almeno una lettera maiuscola
              </div>
              <div
                className={`flex items-center gap-2 ${passwordChecks.lowercase ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {passwordChecks.lowercase ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Almeno una lettera minuscola
              </div>
              <div
                className={`flex items-center gap-2 ${passwordChecks.number ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {passwordChecks.number ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Almeno una cifra
              </div>
              <div
                className={`flex items-center gap-2 ${passwordChecks.symbol ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {passwordChecks.symbol ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Almeno un simbolo speciale
              </div>
              <div
                className={`flex items-center gap-2 ${passwordChecks.match ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {passwordChecks.match ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Le password coincidono
              </div>
            </div>
          </div>
        )}

        {/* Pulsante Cambia Password */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="min-w-[140px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cambio...
              </>
            ) : (
              'Cambia Password'
            )}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
