 
'use client';

import React, { useState } from 'react';

import { usePasswordPolicy } from '../hooks/usePasswordValidation';
import { evaluatePassword } from '../lib/passwordChecks';
import {
  buildUserPayload,
  type SyncedField,
  type UserFormData,
  type UserSubmitPayload,
} from '../lib/userFormSchema';

import { PasswordValidationIndicators } from './PasswordValidationIndicators';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface UserFormProps {
  mode: 'create' | 'edit';
  // firstName/lastName accept `null` here (not just `undefined`) because initialData is prefilled
  // from a DB-backed user record where those columns are nullable; the submitted UserFormData stays plain string.
  initialData?: Partial<Omit<UserFormData, 'firstName' | 'lastName'>> & {
    firstName?: string | null;
    lastName?: string | null;
    provider?: string;
  };
  onSubmit: (data: UserSubmitPayload) => void;
  onCancel: () => void;
  isLoading?: boolean;
  syncedFields?: SyncedField[];
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
  const policy = usePasswordPolicy();

  const handleInputChange = (
    field: keyof UserFormData,
    value: string | boolean
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear the error the user is editing away. For the two password fields the confirmation goes
    // with it: a mismatch belongs to the pair, so fixing either half resolves it.
    //
    // No rule is re-implemented here any more. This block used to carry a third copy of the
    // twelve-character minimum and a second copy of the match rule — one of them announcing itself
    // in English in an otherwise Italian form — while the configured policy said something else
    // entirely. The checklist under the field shows the real requirements live, and
    // `buildUserPayload` decides on submit.
    const pairedWithConfirm = field === 'password' || field === 'confirmPassword';
    if (errors[field] || (pairedWithConfirm && errors.confirmPassword)) {
      setErrors(prev => ({
        ...prev,
        [field]: '',
        ...(pairedWithConfirm ? { confirmPassword: '' } : {}),
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const result = buildUserPayload(mode, formData, syncedFields);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    // The schema carries only the static prefilter; the complexity rules and the real minimum come
    // from the configured policy, which the bundle cannot know. Applied here so a password the
    // server would refuse fails on the field, next to the checklist already showing what is missing,
    // instead of returning as a toast. Skipped when blank in edit mode: there it means "keep the
    // existing one", and `buildUserPayload` has already dropped the key.
    if (result.payload.password) {
      const evaluation = evaluatePassword(result.payload.password, undefined, policy);
      if (!evaluation.isValid) {
        setErrors({ password: `Password non valida: ${evaluation.errors.join(', ')}` });
        return;
      }
    }

    onSubmit(result.payload);
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
