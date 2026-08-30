 
'use client';

import React, { useState } from 'react';
import { z } from 'zod';

import { CreateUserInputSchema } from '@luke/core';

import { PasswordValidationIndicators } from './PasswordValidationIndicators';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

/**
 * Validation for the user form, in both modes.
 *
 * The identity fields come from `users.core.create`'s own input, so the form and the endpoint
 * cannot end up with different ideas of what a username or an email is. Only what the endpoint has
 * no opinion about is declared here: `confirmPassword`, which never leaves the browser, and
 * `isActive`, which belongs to the update input rather than the create one.
 *
 * The password rules are the exception, and knowingly so: create requires 12 characters, edit adds
 * four complexity checks, and the server applies neither — it has a configurable policy
 * (`security.password.*`) that only the reset flow consults. Unifying that is a decision about
 * behaviour, not a schema move; it is filed as its own batch and left alone here.
 */
const CreateUserSchema = CreateUserInputSchema.extend({
  confirmPassword: z.string().min(1, 'Conferma password richiesta'),
  isActive: z.boolean(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Le password non coincidono',
  path: ['confirmPassword'],
});

const EditUserSchema = CreateUserInputSchema
  .extend({
    password: z
      .string()
      .min(12, 'Password deve essere di almeno 12 caratteri')
      .regex(/[A-Z]/, 'Password deve contenere almeno una lettera maiuscola')
      .regex(/[a-z]/, 'Password deve contenere almeno una lettera minuscola')
      .regex(/[0-9]/, 'Password deve contenere almeno un numero')
      .regex(
        /[^A-Za-z0-9]/,
        'Password deve contenere almeno un carattere speciale'
      )
      .optional()
      .or(z.literal('')), // empty string retains the existing password
    confirmPassword: z.string().optional().or(z.literal('')), // empty string allowed
    isActive: z.boolean(),
  })
  .refine(
    data => {
      // No new password means no confirmation either.
      if (!data.password || data.password.trim() === '') {
        return !data.confirmPassword || data.confirmPassword.trim() === '';
      }
      return data.password === data.confirmPassword;
    },
    {
      message: 'Le password non coincidono',
      path: ['confirmPassword'],
    }
  );

type CreateUserData = z.infer<typeof CreateUserSchema>;
type EditUserData = z.infer<typeof EditUserSchema>;
type UserFormData = CreateUserData | EditUserData;

interface UserFormProps {
  mode: 'create' | 'edit';
  // firstName/lastName accept `null` here (not just `undefined`) because initialData is prefilled
  // from a DB-backed user record where those columns are nullable; the submitted UserFormData stays plain string.
  initialData?: Partial<Omit<UserFormData, 'firstName' | 'lastName'>> & {
    firstName?: string | null;
    lastName?: string | null;
    provider?: string;
  };
  onSubmit: (data: UserFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
  syncedFields?: (
    | 'email'
    | 'username'
    | 'firstName'
    | 'lastName'
    | 'role'
    | 'password'
  )[];
  isSelfEdit?: boolean;
  /** Whether the current user may reset this user's password in edit mode (requires `*:*`). */
  canResetPassword?: boolean;
}

/**
 * Form for creating or editing a user with client-side Zod validation.
 *
 * In `edit` mode the password field is optional; leaving it blank retains the
 * existing password. Fields listed in `syncedFields` (e.g. from LDAP) are
 * rendered as read-only and excluded from the submitted payload.
 *
 * @param syncedFields - Field names managed by an external provider; rendered disabled and omitted from `onSubmit`.
 * @param isSelfEdit - Prevents the current user from modifying their own role or active status.
 * @param canResetPassword - When false in edit mode, disables the password field (only `*:*` may reset another user's password).
 */
export function UserForm({
  mode,
  initialData,
  onSubmit,
  onCancel,
  isLoading = false,
  syncedFields = [],
  isSelfEdit = false,
  canResetPassword = true,
}: UserFormProps) {
  // Determine if user is LDAP
  const isLdapUser = initialData?.provider === 'LDAP';
  const [formData, setFormData] = useState<UserFormData>({
    email: initialData?.email || '',
    username: initialData?.username || '',
    firstName: initialData?.firstName || '',
    lastName: initialData?.lastName || '',
    password: '',
    confirmPassword: '',
    role: initialData?.role || 'viewer',
    isActive: initialData?.isActive ?? true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleInputChange = (
    field: keyof UserFormData,
    value: string | boolean
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }

    // Real-time password validation (simplified)
    if (field === 'password') {
      const passwordValue = value as string;
      // Advanced validation is handled by PasswordValidationIndicators component
      // Here we only handle basic validation for the form
      if (
        passwordValue &&
        passwordValue.length > 0 &&
        passwordValue.length < 12
      ) {
        setErrors(prev => ({
          ...prev,
          password: 'Password deve essere di almeno 12 caratteri',
        }));
      } else {
        setErrors(prev => ({ ...prev, password: '' }));
      }
    }

    // Real-time confirmation password validation
    if (field === 'confirmPassword') {
      const confirmPasswordValue = value as string;
      const passwordValue = formData.password;

      if (mode === 'edit') {
        // In edit mode, if password is empty, confirmPassword must be empty
        if (!passwordValue || passwordValue.trim() === '') {
          if (confirmPasswordValue && confirmPasswordValue.trim() !== '') {
            setErrors(prev => ({
              ...prev,
              confirmPassword:
                'Confirm password not needed if password is empty',
            }));
          } else {
            setErrors(prev => ({ ...prev, confirmPassword: '' }));
          }
        } else {
          // If password is present, must match
          if (confirmPasswordValue && confirmPasswordValue !== passwordValue) {
            setErrors(prev => ({
              ...prev,
              confirmPassword: 'Le password non coincidono',
            }));
          } else if (
            confirmPasswordValue &&
            confirmPasswordValue === passwordValue
          ) {
            setErrors(prev => ({ ...prev, confirmPassword: '' }));
          }
        }
      } else {
        // Create mode: password must match
        if (confirmPasswordValue && confirmPasswordValue !== passwordValue) {
          setErrors(prev => ({
            ...prev,
            confirmPassword: 'Le password non coincidono',
          }));
        } else if (
          confirmPasswordValue &&
          confirmPasswordValue === passwordValue
        ) {
          setErrors(prev => ({ ...prev, confirmPassword: '' }));
        }
      }
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Use correct schema based on mode
    const schema = mode === 'create' ? CreateUserSchema : EditUserSchema;
    const result = schema.safeParse(formData);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach(issue => {
        if (issue.path[0]) {
          fieldErrors[issue.path[0] as string] = issue.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    // Remove confirmPassword from data before sending
    const { confirmPassword: _confirmPassword, ...dataToSubmit } = result.data;

    // In edit mode, if password is empty, remove it from data
    if (
      mode === 'edit' &&
      (!formData.password || formData.password.trim() === '')
    ) {
      const { password: _password, ...dataWithoutPassword } = dataToSubmit;

      // Remove synced fields from data to send
      const filteredData = { ...dataWithoutPassword };
      syncedFields?.forEach(field => {
        delete filteredData[field as keyof typeof filteredData];
      });

      onSubmit(filteredData as UserFormData);
    } else {
      // Remove synced fields from data to send
      const filteredData = { ...dataToSubmit };
      syncedFields?.forEach(field => {
        delete filteredData[field as keyof typeof filteredData];
      });

      onSubmit(filteredData as UserFormData);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {/* Prima riga: Email e Username */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={e => handleInputChange('email', e.target.value)}
                placeholder="utente@esempio.com"
                className={errors.email ? 'border-destructive' : ''}
                disabled={syncedFields?.includes('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
              {syncedFields?.includes('email') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Campo sincronizzato esternamente
                </p>
              )}
            </div>

            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                type="text"
                value={formData.username}
                onChange={e => handleInputChange('username', e.target.value)}
                placeholder="username"
                className={errors.username ? 'border-destructive' : ''}
                disabled={
                  syncedFields?.includes('username') ||
                  (mode === 'edit' && isLdapUser)
                }
              />
              {errors.username && (
                <p className="text-sm text-destructive">{errors.username}</p>
              )}
              {syncedFields?.includes('username') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Campo sincronizzato esternamente
                </p>
              )}
              {mode === 'edit' &&
                isLdapUser &&
                !syncedFields?.includes('username') && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Campo sincronizzato esternamente
                  </p>
                )}
            </div>
          </div>

          {/* Seconda riga: Nome e Cognome */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="firstName">Nome</Label>
              <Input
                id="firstName"
                type="text"
                value={formData.firstName}
                onChange={e => handleInputChange('firstName', e.target.value)}
                placeholder="Nome"
                className={errors.firstName ? 'border-destructive' : ''}
                disabled={syncedFields?.includes('firstName')}
              />
              {errors.firstName && (
                <p className="text-sm text-destructive">{errors.firstName}</p>
              )}
              {syncedFields?.includes('firstName') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Campo sincronizzato esternamente
                </p>
              )}
            </div>

            {/* Cognome */}
            <div className="space-y-2">
              <Label htmlFor="lastName">Cognome</Label>
              <Input
                id="lastName"
                type="text"
                value={formData.lastName}
                onChange={e => handleInputChange('lastName', e.target.value)}
                placeholder="Cognome"
                className={errors.lastName ? 'border-destructive' : ''}
                disabled={syncedFields?.includes('lastName')}
              />
              {errors.lastName && (
                <p className="text-sm text-destructive">{errors.lastName}</p>
              )}
              {syncedFields?.includes('lastName') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Campo sincronizzato esternamente
                </p>
              )}
            </div>
          </div>

          {/* Terza riga: Ruolo e Password */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Ruolo */}
            <div className="space-y-2">
              <Label htmlFor="role">Ruolo *</Label>
              <select
                id="role"
                value={formData.role}
                onChange={e => handleInputChange('role', e.target.value)}
                disabled={syncedFields?.includes('role') || isSelfEdit}
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  errors.role ? 'border-destructive' : ''
                }`}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              {errors.role && (
                <p className="text-sm text-destructive">{errors.role}</p>
              )}
              {syncedFields?.includes('role') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Campo sincronizzato esternamente
                </p>
              )}
              {isSelfEdit && !syncedFields?.includes('role') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Non puoi modificare il tuo stesso ruolo
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password">
                Password {mode === 'create' ? '*' : '(opzionale)'}
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={e => handleInputChange('password', e.target.value)}
                placeholder={
                  mode === 'create'
                    ? 'Inserisci una password sicura'
                    : 'Lascia vuoto per non modificare la password'
                }
                className={errors.password ? 'border-destructive' : ''}
                disabled={
                  syncedFields?.includes('password') ||
                  (mode === 'edit' && !canResetPassword)
                }
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
              {syncedFields?.includes('password') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Campo sincronizzato esternamente
                </p>
              )}
              {mode === 'edit' &&
                !syncedFields?.includes('password') &&
                !canResetPassword && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Solo un amministratore può reimpostare la password di un utente
                  </p>
                )}
              {mode === 'edit' &&
                !syncedFields?.includes('password') &&
                canResetPassword && (
                  <p className="text-xs text-muted-foreground">
                    Lascia vuoto se non vuoi modificare la password attuale
                  </p>
                )}

              {/* Indicatori validazione password */}
              <PasswordValidationIndicators
                password={formData.password || ''}
                confirmPassword={formData.confirmPassword || ''}
                showConfirmPassword={
                  mode === 'create' ||
                  (mode === 'edit' &&
                    !!formData.password &&
                    formData.password.trim() !== '')
                }
              />
            </div>
          </div>

          {/* Conferma Password - Solo se necessario */}
          {(mode === 'create' ||
            (mode === 'edit' &&
              formData.password &&
              formData.password.trim() !== '')) &&
            !syncedFields?.includes('password') && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">
                  Conferma Password {mode === 'create' ? '*' : ''}
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={e =>
                    handleInputChange('confirmPassword', e.target.value)
                  }
                  placeholder="Ripeti la password"
                  className={errors.confirmPassword ? 'border-destructive' : ''}
                />
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">
                    {errors.confirmPassword}
                  </p>
                )}
                {mode === 'create' && (
                  <p className="text-xs text-muted-foreground">
                    Inserisci nuovamente la password per confermare
                  </p>
                )}
              </div>
            )}

          {/* Attivo */}
          <div className="flex items-center space-x-2">
            <input
              id="isActive"
              type="checkbox"
              checked={formData.isActive}
              onChange={e => handleInputChange('isActive', e.target.checked)}
              disabled={isSelfEdit}
              className="h-4 w-4 rounded border border-input bg-background disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <Label
              htmlFor="isActive"
              className={isSelfEdit ? 'text-muted-foreground' : ''}
            >
              Utente attivo
              {isSelfEdit && (
                <span className="text-xs text-muted-foreground ml-1">
                  (non puoi disattivare il tuo stesso account)
                </span>
              )}
            </Label>
          </div>
      </div>

      {/* Pulsanti */}
      <div className="flex justify-end space-x-2 px-6 py-4 border-t shrink-0">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
        >
          Annulla
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading
            ? 'Salvataggio...'
            : mode === 'create'
              ? 'Crea Utente'
              : 'Salva Modifiche'}
        </Button>
      </div>
    </form>
  );
}
