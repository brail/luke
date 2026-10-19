'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, Info } from 'lucide-react';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { UserProfileSchema, type UserProfileInput } from '@luke/core';

import { TimeZoneSelect } from '../../../../components/TimeZoneSelect';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { useRefresh } from '../../../../lib/refresh';
import { trpc } from '../../../../lib/trpc';
import { useStandardMutation } from '../../../../lib/useStandardMutation';

interface UserProfileFormProps {
  /** Current authenticated user data used to pre-populate the form. */
  user: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    locale: string;
    timezone: string;
    provider: string;
    emailVerifiedAt: string | null;
  };
}

/**
 * Profile edit form covering display name, timezone, and email change.
 * Fields for first name and last name are read-only when the account is managed
 * by an external provider (LDAP or SSO); a tooltip indicates the sync source.
 * @param user - Current user data; `provider` determines which fields are editable.
 */
export function UserProfileForm({ user }: UserProfileFormProps) {
  const refresh = useRefresh();

  // State for the email change: the new address and the account's password, which the server asks for
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  // Form setup with Zod validation
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<UserProfileInput>({
    resolver: zodResolver(UserProfileSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      // No field until the i18n cycle (dates use one locale, ADR-035): the saved value is resubmitted.
      locale: user.locale,
      timezone: user.timezone,
    },
  });

  // Mutation tRPC
  const updateProfileMutation = trpc.me.updateProfile.useMutation();
  const changeEmailMutation = trpc.me.changeEmail.useMutation();

  // Standard mutations
  const { mutate: updateProfile } = useStandardMutation({
    mutateFn: updateProfileMutation.mutateAsync,
    // The profile carries the time zone, which some server reads depend on (`refresh.timeZone`).
    invalidate: refresh.timeZone,
    onSuccessMessage: 'Profilo aggiornato con successo',
    onErrorMessage: "Errore durante l'aggiornamento del profilo",
  });

  const { mutate: changeEmail, isPending: isChangingEmail } =
    useStandardMutation({
      mutateFn: changeEmailMutation.mutateAsync,
      invalidate: refresh.me,
      onSuccess: data => {
        toast.success(data.message);
        // Reload the page to refresh the session
        window.location.reload();
      },
      onErrorMessage: 'Errore cambio email',
      // The password is proven as a login proves it: UNAUTHORIZED is a wrong password (or an expired
      // session), each with its own server text; SERVICE_UNAVAILABLE is the directory, its text masked.
      entityMessages: {
        UNAUTHORIZED: true,
        SERVICE_UNAVAILABLE: 'Servizio di autenticazione non disponibile. Riprova più tardi.',
      },
    });

  // Form submit handler
  const onSubmit = (data: UserProfileInput) => {
    updateProfile(data);
  };

  // Whether the fields are read-only because an external provider owns them
  const isExternalProvider = user.provider !== 'LOCAL';
  const readonlyFields = isExternalProvider ? ['firstName', 'lastName'] : [];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Email (read-only) */}
      <div className="space-y-2">
        <Label htmlFor="email">Email Attuale</Label>
        <Input
          id="email"
          type="email"
          value={user.email}
          disabled
          className="bg-muted"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="newEmail">Cambia Email</Label>
        <div className="flex gap-2">
          <Input
            id="newEmail"
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="nuova@email.com"
            disabled={isChangingEmail}
          />
          <Input
            id="emailCurrentPassword"
            type="password"
            autoComplete="current-password"
            aria-label="Password attuale"
            value={emailPassword}
            onChange={e => setEmailPassword(e.target.value)}
            placeholder="Password attuale"
            disabled={isChangingEmail}
          />
          <Button
            type="button"
            onClick={() => {
              if (!newEmail || !emailPassword) return;
              // The hook has toasted a refusal by the time it re-throws it; nothing else handles it.
              changeEmail({ newEmail, currentPassword: emailPassword }).catch(() => undefined);
            }}
            disabled={isChangingEmail || !newEmail || !emailPassword}
          >
            {isChangingEmail ? (
              <>
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                Aggiorno...
              </>
            ) : (
              'Aggiorna'
            )}
          </Button>
        </div>
        {user.emailVerifiedAt === null && (
          <p className="text-xs text-amber-600">
            ⚠️ Email attuale non verificata. Controlla la casella di posta.
          </p>
        )}
      </div>

      {/* Username (always read-only) */}
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

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="firstName">Nome</Label>
          {readonlyFields.includes('firstName') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Campo sincronizzato da {user.provider}</p>
              </TooltipContent>
            </Tooltip>
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

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="lastName">Cognome</Label>
          {readonlyFields.includes('lastName') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Campo sincronizzato da {user.provider}</p>
              </TooltipContent>
            </Tooltip>
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

      {/* Timezone */}
      <div className="space-y-2">
        <Label htmlFor="timezone">Fuso Orario</Label>
        <Controller
          name="timezone"
          control={control}
          render={({ field }) => (
            <TimeZoneSelect
              id="timezone"
              ref={field.ref}
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              stored={user.timezone}
              invalid={!!errors.timezone}
              describedBy={errors.timezone ? 'timezone-error' : undefined}
            />
          )}
        />
        {errors.timezone && (
          <p id="timezone-error" className="text-sm text-destructive">
            {errors.timezone.message}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!isDirty || isSubmitting}
          // 120px: keeps button width stable while its label changes during submit; no exact scale match
          className="min-w-[120px]"
        >
          {isSubmitting ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
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
