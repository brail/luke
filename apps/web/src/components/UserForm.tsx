/* eslint-disable no-unused-vars */
'use client';

import React, { useState } from 'react';
import { z } from 'zod';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

/**
 * Schema di validazione per il form utente
 */
const CreateUserSchema = z
  .object({
    email: z.string().email('Email non valida'),
    username: z.string().min(3, 'Username deve essere di almeno 3 caratteri'),
    firstName: z.string().optional().or(z.literal('')),
    lastName: z.string().optional().or(z.literal('')),
    password: z.string().min(8, 'Password deve essere di almeno 8 caratteri'),
    confirmPassword: z.string().min(8, 'Conferma password richiesta'),
    role: z.enum(['admin', 'editor', 'viewer']),
    isActive: z.boolean(),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Le password non coincidono',
    path: ['confirmPassword'],
  });

const EditUserSchema = z
  .object({
    email: z.string().email('Email non valida'),
    username: z.string().min(3, 'Username deve essere di almeno 3 caratteri'),
    firstName: z.string().optional().or(z.literal('')),
    lastName: z.string().optional().or(z.literal('')),
    password: z
      .string()
      .min(8, 'Password deve essere di almeno 8 caratteri')
      .optional()
      .or(z.literal('')), // Permette stringa vuota
    confirmPassword: z.string().optional().or(z.literal('')), // Permette stringa vuota
    role: z.enum(['admin', 'editor', 'viewer']),
    isActive: z.boolean(),
  })
  .refine(
    data => {
      // Se password è vuota, confirmPassword deve essere vuota
      if (!data.password || data.password.trim() === '') {
        return !data.confirmPassword || data.confirmPassword.trim() === '';
      }
      // Se password è presente, deve coincidere con confirmPassword
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
  initialData?: Partial<UserFormData> & { provider?: string };
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
}

/**
 * Componente form per creazione e modifica utenti
 * Gestisce validazione client-side e stato del form
 */
// eslint-disable-next-line no-unused-vars
export function UserForm({
  mode,
  initialData,
  onSubmit,
  onCancel,
  isLoading = false,
  syncedFields = [],
  isSelfEdit = false,
}: UserFormProps) {
  // Determina se l'utente è LDAP
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

    // Rimuovi errore quando l'utente inizia a digitare
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }

    // Validazione in tempo reale per password
    if (field === 'password') {
      const passwordValue = value as string;
      if (mode === 'edit') {
        if (
          passwordValue &&
          passwordValue.length > 0 &&
          passwordValue.length < 8
        ) {
          setErrors(prev => ({
            ...prev,
            password: 'Password deve essere di almeno 8 caratteri',
          }));
        } else if (passwordValue && passwordValue.length >= 8) {
          setErrors(prev => ({ ...prev, password: '' }));
        }
      } else {
        // Modalità create: validazione password normale
        if (passwordValue && passwordValue.length < 8) {
          setErrors(prev => ({
            ...prev,
            password: 'Password deve essere di almeno 8 caratteri',
          }));
        } else if (passwordValue && passwordValue.length >= 8) {
          setErrors(prev => ({ ...prev, password: '' }));
        }
      }
    }

    // Validazione in tempo reale per conferma password
    if (field === 'confirmPassword') {
      const confirmPasswordValue = value as string;
      const passwordValue = formData.password;

      if (mode === 'edit') {
        // In edit mode, se password è vuota, confirmPassword deve essere vuota
        if (!passwordValue || passwordValue.trim() === '') {
          if (confirmPasswordValue && confirmPasswordValue.trim() !== '') {
            setErrors(prev => ({
              ...prev,
              confirmPassword:
                'Conferma password non necessaria se password è vuota',
            }));
          } else {
            setErrors(prev => ({ ...prev, confirmPassword: '' }));
          }
        } else {
          // Se password è presente, deve coincidere
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
        // Modalità create: password deve coincidere
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

    // Usa lo schema corretto in base alla modalità
    const schema = mode === 'create' ? CreateUserSchema : EditUserSchema;
    const result = schema.safeParse(formData);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(error => {
        if (error.path[0]) {
          fieldErrors[error.path[0] as string] = error.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    // Rimuovi confirmPassword dai dati prima di inviare
    const { confirmPassword: _confirmPassword, ...dataToSubmit } = result.data;

    // Per edit mode, se password è vuota, rimuovila dai dati
    if (
      mode === 'edit' &&
      (!formData.password || formData.password.trim() === '')
    ) {
      const { password: _password, ...dataWithoutPassword } = dataToSubmit;

      // Rimuovi i campi sincronizzati dai dati da inviare
      const filteredData = { ...dataWithoutPassword };
      syncedFields?.forEach(field => {
        delete filteredData[field as keyof typeof filteredData];
      });

      onSubmit(filteredData as UserFormData);
    } else {
      // Rimuovi i campi sincronizzati dai dati da inviare
      const filteredData = { ...dataToSubmit };
      syncedFields?.forEach(field => {
        delete filteredData[field as keyof typeof filteredData];
      });

      onSubmit(filteredData as UserFormData);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === 'create' ? 'Nuovo Utente' : 'Modifica Utente'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
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
                disabled={syncedFields?.includes('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
              {syncedFields?.includes('password') && (
                <p className="text-xs text-muted-foreground mt-1">
                  Campo sincronizzato esternamente
                </p>
              )}
              {mode === 'edit' && !syncedFields?.includes('password') && (
                <p className="text-xs text-muted-foreground">
                  Lascia vuoto se non vuoi modificare la password attuale
                </p>
              )}
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
              className="h-4 w-4 rounded border border-input bg-background"
            />
            <Label htmlFor="isActive">Utente attivo</Label>
          </div>

          {/* Pulsanti */}
          <div className="flex justify-end space-x-2 pt-4">
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
      </CardContent>
    </Card>
  );
}
