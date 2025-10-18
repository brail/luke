'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserProfileSchema, type UserProfileInput } from '@luke/core';
import { trpc } from '../../../../lib/trpc';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { toast } from 'sonner';
import { Loader2, Info } from 'lucide-react';
import { LOCALES } from '../../../../lib/i18n/locales';
import { TIMEZONES } from '../../../../lib/i18n/timezones';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';

interface UserProfileFormProps {
  /** Dati utente correnti */
  user: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    locale: string;
    timezone: string;
    provider: string;
  };
}

export function UserProfileForm({ user }: UserProfileFormProps) {
  const utils = trpc.useUtils();

  // Form setup con validazione Zod
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<UserProfileInput>({
    resolver: zodResolver(UserProfileSchema),
    defaultValues: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      timezone: user.timezone,
    },
  });

  // Mutation per aggiornamento profilo
  const updateProfileMutation = trpc.me.updateProfile.useMutation({
    onSuccess: async () => {
      toast.success('Profilo aggiornato con successo');
      utils.me.get.invalidate();
      // I dati si aggiornano automaticamente tramite tRPC invalidation
    },
    onError: error => {
      toast.error(`Errore nell'aggiornamento: ${error.message}`);
    },
  });

  // Handler per submit form
  const onSubmit = (data: UserProfileInput) => {
    updateProfileMutation.mutate(data);
  };

  // Determina se i campi sono read-only per provider esterni
  const isExternalProvider = user.provider !== 'LOCAL';
  const readonlyFields = isExternalProvider ? ['firstName', 'lastName'] : [];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          {...register('email')}
          className={errors.email ? 'border-destructive' : ''}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Username (sempre read-only) */}
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={user.username}
          disabled
          className="bg-muted"
        />
        <p className="text-sm text-muted-foreground">
          Username non modificabile
        </p>
      </div>

      {/* Nome */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="firstName">Nome</Label>
          {readonlyFields.includes('firstName') && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Campo sincronizzato da {user.provider}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <Input
          id="firstName"
          {...register('firstName')}
          disabled={readonlyFields.includes('firstName')}
          className={`${errors.firstName ? 'border-destructive' : ''} ${
            readonlyFields.includes('firstName') ? 'bg-muted' : ''
          }`}
          aria-invalid={!!errors.firstName}
          aria-describedby={errors.firstName ? 'firstName-error' : undefined}
        />
        {errors.firstName && (
          <p id="firstName-error" className="text-sm text-destructive">
            {errors.firstName.message}
          </p>
        )}
      </div>

      {/* Cognome */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="lastName">Cognome</Label>
          {readonlyFields.includes('lastName') && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Campo sincronizzato da {user.provider}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <Input
          id="lastName"
          {...register('lastName')}
          disabled={readonlyFields.includes('lastName')}
          className={`${errors.lastName ? 'border-destructive' : ''} ${
            readonlyFields.includes('lastName') ? 'bg-muted' : ''
          }`}
          aria-invalid={!!errors.lastName}
          aria-describedby={errors.lastName ? 'lastName-error' : undefined}
        />
        {errors.lastName && (
          <p id="lastName-error" className="text-sm text-destructive">
            {errors.lastName.message}
          </p>
        )}
      </div>

      {/* Locale */}
      <div className="space-y-2">
        <Label htmlFor="locale">Lingua</Label>
        <select
          id="locale"
          {...register('locale')}
          className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            errors.locale ? 'border-destructive' : ''
          }`}
          aria-invalid={!!errors.locale}
          aria-describedby={errors.locale ? 'locale-error' : undefined}
        >
          {LOCALES.map(locale => (
            <option key={locale.value} value={locale.value}>
              {locale.label}
            </option>
          ))}
        </select>
        {errors.locale && (
          <p id="locale-error" className="text-sm text-destructive">
            {errors.locale.message}
          </p>
        )}
      </div>

      {/* Timezone */}
      <div className="space-y-2">
        <Label htmlFor="timezone">Fuso Orario</Label>
        <select
          id="timezone"
          {...register('timezone')}
          className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            errors.timezone ? 'border-destructive' : ''
          }`}
          aria-invalid={!!errors.timezone}
          aria-describedby={errors.timezone ? 'timezone-error' : undefined}
        >
          {TIMEZONES.map(timezone => (
            <option key={timezone.value} value={timezone.value}>
              {timezone.label}
            </option>
          ))}
        </select>
        {errors.timezone && (
          <p id="timezone-error" className="text-sm text-destructive">
            {errors.timezone.message}
          </p>
        )}
      </div>

      {/* Pulsante Salva */}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!isDirty || isSubmitting}
          className="min-w-[120px]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvataggio...
            </>
          ) : (
            'Salva Modifiche'
          )}
        </Button>
      </div>
    </form>
  );
}
