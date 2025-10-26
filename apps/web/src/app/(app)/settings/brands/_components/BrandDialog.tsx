'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { BrandInputSchema, type BrandInput } from '@luke/core';

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
import { Switch } from '../../../../../components/ui/switch';

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
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<BrandFormData>({
    resolver: zodResolver(BrandFormSchema),
    defaultValues: {
      code: brand?.code || '',
      name: brand?.name || '',
      logoUrl: brand?.logoUrl || null,
      isActive: brand?.isActive ?? true,
    },
  });

  // Reset form quando brand cambia
  React.useEffect(() => {
    if (brand) {
      form.reset({
        code: brand.code,
        name: brand.name,
        logoUrl: brand.logoUrl,
        isActive: brand.isActive,
      });
      setLogoUrl(brand.logoUrl);
    } else {
      form.reset({
        code: '',
        name: '',
        logoUrl: null,
        isActive: true,
      });
      setLogoUrl(null);
    }
  }, [brand, form]);

  // Handler per upload logo
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

    try {
      // Per i brand nuovi, non possiamo fare upload finché non sono creati
      if (!brand?.id) {
        toast.error('Salva prima il brand per caricare il logo');
        setIsUploading(false);
        return;
      }

      const formData = new globalThis.FormData();
      formData.append('file', file);

      const response = await fetch(`/api/upload/brand-logo/${brand.id}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload fallito');
      }

      const result = await response.json();
      setLogoUrl(result.url);
      form.setValue('logoUrl', result.url);
      toast.success('Logo caricato con successo');
    } catch (error) {
      console.error('Errore upload logo:', error);
      toast.error('Errore durante il caricamento del logo');
    } finally {
      setIsUploading(false);
    }
  };

  // Handler per rimozione logo
  const handleLogoRemove = () => {
    setLogoUrl(null);
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
        logoUrl: data.logoUrl,
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
            {/* Logo Upload */}
            <div className="space-y-4">
              <FormLabel>Logo</FormLabel>
              <div className="flex items-center gap-4">
                {logoUrl && (
                  <div className="relative">
                    <img
                      src={logoUrl}
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
                    disabled={isUploading || !brand?.id}
                    title={
                      !brand?.id
                        ? 'Salva prima il brand per caricare il logo'
                        : undefined
                    }
                  >
                    {isUploading
                      ? 'Caricamento...'
                      : brand?.id
                        ? 'Carica Logo'
                        : 'Salva prima il brand'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, WebP. Max 2MB.
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
                    <Input placeholder="es. NIKE, ADIDAS" {...field} />
                  </FormControl>
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
                    <Input placeholder="es. Nike, Adidas" {...field} />
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
              >
                Annulla
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Salvataggio...' : brand ? 'Aggiorna' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
