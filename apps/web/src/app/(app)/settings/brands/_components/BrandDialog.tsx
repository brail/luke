'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useState, useRef } from 'react';
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
import { useInvalidateContext } from '../../../../../contexts/useInvalidateContext';
import {
  buildBrandLogoUploadUrl,
  buildTempBrandLogoUploadUrl,
} from '../../../../../lib/api';

// Schema per form con isActive obbligatorio (per React Hook Form)
const BrandFormSchema = BrandInputSchema.extend({
  isActive: z.boolean(),
});

type BrandFormData = z.infer<typeof BrandFormSchema>;

interface BrandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand?: any;
  onSubmit: (data: BrandInput) => Promise<void>;
  isLoading: boolean;
}

/**
 * Dialog per creazione e modifica Brand
 * Include upload logo e validazioni form
 */
export function BrandDialog({
  open,
  onOpenChange,
  brand,
  onSubmit,
  isLoading,
}: BrandDialogProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(brand?.logoUrl || null);
  const [tempLogoId, setTempLogoId] = useState<string | null>(null);
  const [tempLogoUrl, setTempLogoUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [codePreview, setCodePreview] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hook per invalidazione cache
  const invalidateContext = useInvalidateContext();

  const form = useForm<BrandFormData>({
    resolver: zodResolver(BrandFormSchema),
    defaultValues: {
      code: brand?.code || '',
      name: brand?.name || '',
      logoUrl: brand?.logoUrl || '',
      isActive: brand?.isActive ?? true,
    },
  });

  // Reset form quando brand cambia
  React.useEffect(() => {
    if (brand) {
      form.reset({
        code: brand.code,
        name: brand.name,
        logoUrl: brand.logoUrl || '',
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
        logoUrl: '',
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
    if (open) {
      // Delay per permettere al dialog di renderizzare
      setTimeout(() => {
        const codeInput = document.querySelector(
          'input[placeholder="es. nike-2024"]'
        ) as HTMLInputElement;
        if (codeInput) {
          codeInput.focus();
        }
      }, 100);
    } else {
      // Reset form quando dialog si chiude
      form.reset();
      setLogoUrl(null);
      setTempLogoId(null);
      setTempLogoUrl(null);
      setCodePreview('');
      setUploadProgress(0);
    }
  }, [open, form]);

  // Handler per upload logo (normale o temporaneo) con progress tracking
  const handleLogoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
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
        xhr.send(formData);
      } else {
        // Upload temporaneo per brand nuovo con progress tracking
        const tempId = crypto.randomUUID();
        formData.append('tempId', tempId);

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
        xhr.send(formData);
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
    try {
      // Converti BrandFormData a BrandInput per il backend
      const brandInput: BrandInput = {
        code: data.code,
        name: data.name,
        logoUrl: data.logoUrl || null, // Assicurati che sia null se vuoto
        tempLogoId: tempLogoId || undefined,
        isActive: data.isActive,
      };

      await onSubmit(brandInput);
      // Non chiudiamo il modal qui - lo gestisce il componente padre
    } catch (error) {
      console.error('Errore submit form:', error);
      // L'errore viene già gestito dal componente padre
      throw error;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{brand ? 'Modifica Brand' : 'Nuovo Brand'}</DialogTitle>
          <DialogDescription>
            {brand
              ? 'Modifica le informazioni del brand selezionato.'
              : 'Crea un nuovo brand nel sistema.'}
          </DialogDescription>
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
                    // Gestisci correttamente i valori null/undefined
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
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                      onClick={handleLogoRemove}
                    >
                      ×
                    </Button>
                  </div>
                )}
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isLoading}
                  >
                    {isUploading ? 'Caricamento...' : 'Carica Logo'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                    disabled={isUploading || isLoading}
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
                  <FormControl>
                    <Input
                      placeholder="es. nike-2024"
                      disabled={isLoading}
                      {...field}
                      onChange={e => {
                        field.onChange(e);
                        // Mostra anteprima normalizzata
                        const normalized = normalizeCode(e.target.value);
                        setCodePreview(normalized);
                      }}
                    />
                  </FormControl>
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
                  <FormControl>
                    <Input
                      placeholder="es. Nike, Adidas"
                      disabled={isLoading}
                      {...field}
                    />
                  </FormControl>
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
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading || isUploading}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={isLoading || isUploading}>
                {isLoading ? 'Salvataggio...' : brand ? 'Aggiorna' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
