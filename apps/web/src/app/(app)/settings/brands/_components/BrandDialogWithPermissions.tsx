'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';
import React, { useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { BrandInputSchema, type BrandInput, normalizeCode } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../../components/ui/form';
import { Input } from '../../../../../components/ui/input';
import { Progress } from '../../../../../components/ui/progress';
import { Switch } from '../../../../../components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip';
import { useInvalidateContext } from '../../../../../contexts/useInvalidateContext';
import { useBrandPermissions } from '../../../../../hooks/useBrandPermissions';
import {
  buildBrandLogoUploadUrl,
  buildTempBrandLogoUploadUrl,
} from '../../../../../lib/api';

// Schema per form con isActive obbligatorio (per React Hook Form)
// logoUrl accetta qualsiasi stringa (anche percorsi relativi in DEV) o null/undefined
const BrandFormSchema = BrandInputSchema.extend({
  isActive: z.boolean(),
  logoUrl: z.union([z.string(), z.null(), z.undefined()]).optional(),
});

type BrandFormData = z.infer<typeof BrandFormSchema>;

interface BrandDialogWithPermissionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand?: any;
  onSubmit: (data: BrandInput) => Promise<void>;
  isLoading: boolean;
}

/**
 * Dialog per creazione e modifica Brand con permission-aware UI
 *
 * Features:
 * - Disabilita i campi se l'utente non ha permessi di modifica
 * - Mostra "Read-Only" per i viewer
 * - Nasconde il pulsante di eliminazione se l'utente non ha permessi
 * - Mostra tooltip sui campi disabilitati spiegando il perché
 * - Conferma speciale per hard delete (solo admin)
 * - Disabilita upload logo se non admin/editor
 */
function DisabledFieldWrapper({
  children,
  disabled,
  tooltip,
}: {
  children: React.ReactNode;
  disabled: boolean;
  tooltip: string;
}) {
  if (!disabled || !tooltip) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function BrandDialogWithPermissions({
  open,
  onOpenChange,
  brand,
  onSubmit,
  isLoading,
}: BrandDialogWithPermissionsProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(brand?.logoUrl || null);
  const [tempLogoId, setTempLogoId] = useState<string | null>(null);
  const [tempLogoUrl, setTempLogoUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [codePreview, setCodePreview] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hook per permissions
  const brandPerms = useBrandPermissions();
  const { data: session } = useSession();

  // Hook per invalidazione cache
  const invalidateContext = useInvalidateContext();

  // Determina il label del dialog in base ai permessi
  const dialogTitle = useMemo(() => {
    if (brand) {
      return brandPerms.isReadOnly() ? 'Visualizza Brand' : 'Modifica Brand';
    }
    return 'Nuovo Brand';
  }, [brand, brandPerms]);

  const dialogDescription = useMemo(() => {
    if (brand) {
      if (brandPerms.isReadOnly()) {
        return 'Visualizzazione del brand (accesso sola lettura)';
      }
      return 'Modifica le informazioni del brand selezionato.';
    }
    return 'Crea un nuovo brand nel sistema.';
  }, [brand, brandPerms]);

  // Messaggio per campi disabilitati
  const disabledFieldTooltip = useMemo(() => {
    if (brandPerms.isReadOnly()) {
      return 'Accesso sola lettura - non puoi modificare i brand';
    }
    if (!brandPerms.canEdit()) {
      return 'Non hai i permessi necessari per modificare i brand';
    }
    return '';
  }, [brandPerms]);

  const form = useForm<BrandFormData>({
    resolver: zodResolver(BrandFormSchema),
    defaultValues: {
      code: brand?.code || '',
      name: brand?.name || '',
      logoUrl: brand?.logoUrl ?? null,
      isActive: brand?.isActive ?? true,
    },
  });

  // Reset form quando brand cambia
  React.useEffect(() => {
    if (brand) {
      form.reset({
        code: brand.code,
        name: brand.name,
        logoUrl: brand.logoUrl ?? null,
        isActive: brand.isActive,
      });
      setLogoUrl(brand.logoUrl);
      setTempLogoId(null);
      setTempLogoUrl(null);
      setCodePreview('');
      setUploadProgress(0);
    } else {
      form.reset({
        code: '',
        name: '',
        logoUrl: null,
        isActive: true,
      });
      setLogoUrl(null);
      setTempLogoId(null);
      setTempLogoUrl(null);
      setCodePreview('');
      setUploadProgress(0);
    }
  }, [
    brand?.id,
    brand?.code,
    brand?.name,
    brand?.logoUrl,
    brand?.isActive,
    form,
  ]);

  // Auto-focus su campo code quando dialog si apre
  React.useEffect(() => {
    if (open && brandPerms.canEdit()) {
      // Delay per permettere al dialog di renderizzare
      setTimeout(() => {
        const codeInput = document.querySelector(
          'input[placeholder="es. nike-2024"]'
        ) as HTMLInputElement;
        if (codeInput) {
          codeInput.focus();
        }
      }, 100);
    } else if (!open) {
      // Reset form quando dialog si chiude
      form.reset();
      setLogoUrl(null);
      setTempLogoId(null);
      setTempLogoUrl(null);
      setCodePreview('');
      setUploadProgress(0);
    }
  }, [open]); // intentionally limited to open: avoid infinite loop from unstable refs

  // Handler per upload logo (normale o temporaneo) con progress tracking
  const handleLogoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!brandPerms.canUpdate) {
      toast.error('Non hai i permessi per modificare il logo');
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    // Validazione file
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Formato file non supportato. Usa PNG, JPEG o WebP.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      // 2MB
      toast.error('File troppo grande. Massimo 2MB.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const formData = new globalThis.FormData();
      formData.append('file', file);

      if (brand?.id) {
        // Upload normale per brand esistente con progress tracking
        const xhr = new globalThis.XMLHttpRequest();

        // Track progress
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percentComplete);
          }
        });

        // Handle response
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            try {
              const result = JSON.parse(xhr.responseText);
              // Usa publicUrl dalla nuova response API
              const logoUrlWithTimestamp = `${result.publicUrl}?t=${Date.now()}`;
              setLogoUrl(logoUrlWithTimestamp);
              form.setValue('logoUrl', logoUrlWithTimestamp);
              toast.success('Logo caricato con successo');

              // Invalida cache per aggiornare lista
              invalidateContext();
            } catch (_parseError) {
              toast.error('Errore durante il parsing della risposta');
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              toast.error(errorData.message || 'Upload fallito');
            } catch {
              toast.error('Upload fallito');
            }
          }
          setIsUploading(false);
          setUploadProgress(0);
        });

        xhr.addEventListener('error', () => {
          toast.error('Errore di rete durante upload');
          setIsUploading(false);
          setUploadProgress(0);
        });

        xhr.open('POST', buildBrandLogoUploadUrl(brand.id));
        if (session?.accessToken) {
          xhr.setRequestHeader(
            'Authorization',
            `Bearer ${session.accessToken}`
          );
        }
        xhr.send(formData);
      } else {
        // Upload temporaneo per brand nuovo con progress tracking
        // IMPORTANTE: tempId deve essere appeso PRIMA del file nel FormData,
        // perché @fastify/multipart legge data.fields solo per i campi che precedono il file nello stream.
        const tempId = crypto.randomUUID();
        const tempFormData = new globalThis.FormData();
        tempFormData.append('tempId', tempId);
        tempFormData.append('file', file);

        const xhr = new globalThis.XMLHttpRequest();

        // Track progress
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percentComplete);
          }
        });

        // Handle response
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            try {
              const result = JSON.parse(xhr.responseText);
              // Usa publicUrl dalla nuova response API
              setTempLogoId(result.tempLogoId);
              setTempLogoUrl(result.publicUrl);
              toast.success(
                'Logo caricato (verrà associato al brand dopo il salvataggio)'
              );
            } catch (_parseError) {
              toast.error('Errore durante il parsing della risposta');
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              toast.error(errorData.message || 'Upload temporaneo fallito');
            } catch {
              toast.error('Upload temporaneo fallito');
            }
          }
          setIsUploading(false);
          setUploadProgress(0);
        });

        xhr.addEventListener('error', () => {
          toast.error('Errore di rete durante upload temporaneo');
          setIsUploading(false);
          setUploadProgress(0);
        });

        xhr.open('POST', buildTempBrandLogoUploadUrl());
        if (session?.accessToken) {
          xhr.setRequestHeader(
            'Authorization',
            `Bearer ${session.accessToken}`
          );
        }
        xhr.send(tempFormData);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore upload';
      toast.error(`Upload fallito: ${message}`);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Handler per rimozione logo
  const handleLogoRemove = () => {
    if (!brandPerms.canUpdate) {
      toast.error('Non hai i permessi per modificare il logo');
      return;
    }
    setLogoUrl(null);
    setTempLogoId(null);
    setTempLogoUrl(null);
    form.setValue('logoUrl', null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handler per submit form
  const handleSubmit = async (data: BrandFormData) => {
    if (!brandPerms.canEdit()) {
      toast.error('Non hai i permessi per modificare i brand');
      return;
    }

    try {
      // Converti BrandFormData a BrandInput per il backend
      const brandInput: BrandInput = {
        code: data.code,
        name: data.name,
        // Send logoUrl only when explicitly clearing (null).
        // XHR upload already updates DB directly; tempLogoId handles new-brand logo flow.
        ...(data.logoUrl === null ? { logoUrl: null } : {}),
        tempLogoId: tempLogoId || undefined,
        isActive: data.isActive,
      };

      await onSubmit(brandInput);
    } catch (error) {
      console.error('Errore submit form:', error);
      throw error;
    }
  };

  const isFormDisabled = !brandPerms.canEdit();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-6"
          >
            {/* Campo nascosto per logoUrl */}
            <FormField
              control={form.control}
              name="logoUrl"
              render={({ field }) => (
                <input
                  type="hidden"
                  {...field}
                  value={field.value || ''}
                  onChange={e => {
                    const value = e.target.value === '' ? null : e.target.value;
                    field.onChange(value);
                  }}
                />
              )}
            />

            {/* Logo Upload */}
            <div className="space-y-4">
              <FormLabel>Logo</FormLabel>
              <div className="flex items-center gap-4">
                {(logoUrl || tempLogoUrl) && (
                  <div className="relative">
                    <img
                      src={logoUrl || tempLogoUrl || ''}
                      alt="Logo brand"
                      className="h-16 w-16 rounded-lg object-cover border"
                    />
                    {brandPerms.canUpdate && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                        onClick={handleLogoRemove}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <DisabledFieldWrapper
                    disabled={!brandPerms.canUpdate}
                    tooltip={disabledFieldTooltip}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setTimeout(() => fileInputRef.current?.click(), 0)
                      }
                      disabled={
                        isUploading || isLoading || !brandPerms.canUpdate
                      }
                    >
                      {isUploading ? 'Caricamento...' : 'Carica Logo'}
                    </Button>
                  </DisabledFieldWrapper>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                    disabled={isUploading || isLoading || !brandPerms.canUpdate}
                  />
                  {isUploading && (
                    <div className="space-y-1">
                      <Progress value={uploadProgress} className="h-2" />
                      <p className="text-xs text-muted-foreground text-center">
                        {uploadProgress}% completato
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, WebP. Max 2MB.
                    {tempLogoUrl && !brand?.id && (
                      <span className="block text-blue-600">
                        Logo temporaneo caricato
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Codice */}
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Codice</FormLabel>
                  <DisabledFieldWrapper
                    disabled={isFormDisabled}
                    tooltip={disabledFieldTooltip}
                  >
                    <FormControl>
                      <Input
                        placeholder="es. nike-2024"
                        disabled={isLoading || isFormDisabled}
                        {...field}
                        onChange={e => {
                          field.onChange(e);
                          const normalized = normalizeCode(e.target.value);
                          setCodePreview(normalized);
                        }}
                      />
                    </FormControl>
                  </DisabledFieldWrapper>
                  {codePreview && codePreview !== field.value && (
                    <p className="text-xs text-muted-foreground">
                      Verrà salvato come: <strong>{codePreview}</strong>
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Nome */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <DisabledFieldWrapper
                    disabled={isFormDisabled}
                    tooltip={disabledFieldTooltip}
                  >
                    <FormControl>
                      <Input
                        placeholder="es. Nike, Adidas"
                        disabled={isLoading || isFormDisabled}
                        {...field}
                      />
                    </FormControl>
                  </DisabledFieldWrapper>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Stato Attivo */}
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Brand attivo</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Il brand sarà disponibile per la selezione
                    </p>
                  </div>
                  <DisabledFieldWrapper
                    disabled={isFormDisabled}
                    tooltip={disabledFieldTooltip}
                  >
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isLoading || isFormDisabled}
                      />
                    </FormControl>
                  </DisabledFieldWrapper>
                </FormItem>
              )}
            />

            {/* Read-Only Banner */}
            {brandPerms.isReadOnly() && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                <p className="text-sm text-blue-800">
                  Hai accesso sola lettura. Per modificare i brand, contatta un
                  amministratore.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading || isUploading}
              >
                {brandPerms.isReadOnly() ? 'Chiudi' : 'Annulla'}
              </Button>
              {brandPerms.canEdit() && (
                <Button type="submit" disabled={isLoading || isUploading}>
                  {isLoading ? 'Salvataggio...' : brand ? 'Aggiorna' : 'Crea'}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
