'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';

import { VendorInputSchema, type VendorInput } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Textarea } from '../../../../../components/ui/textarea';
import { usePermission } from '../../../../../hooks/usePermission';

import type { VendorItem } from './VendorTable';

interface VendorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: VendorItem | null;
  onSubmit: (data: VendorInput) => Promise<void>;
  isLoading: boolean;
}

export function VendorDialog({
  open,
  onOpenChange,
  vendor,
  onSubmit,
  isLoading,
}: VendorDialogProps) {
  const { can } = usePermission();
  const canEdit = vendor ? can('vendors:update') : can('vendors:create');

  const form = useForm<VendorInput>({
    resolver: zodResolver(VendorInputSchema),
    defaultValues: {
      name: '',
      countryCode: null,
      nickname: null,
      referente: null,
      email: null,
      phone: null,
      chat: null,
      notes: null,
      navVendorId: null,
    },
  });

  React.useEffect(() => {
    if (open) {
      if (vendor) {
        form.reset({
          name: vendor.name,
          countryCode: vendor.countryCode ?? null,
          nickname: vendor.nickname ?? null,
          referente: vendor.referente ?? null,
          email: vendor.email ?? null,
          phone: vendor.phone ?? null,
          chat: vendor.chat ?? null,
          notes: vendor.notes ?? null,
          navVendorId: vendor.navVendorId ?? null,
        });
      } else {
        form.reset({
          name: '',
          nickname: null,
          referente: null,
          email: null,
          phone: null,
          chat: null,
          notes: null,
          navVendorId: null,
        });
      }
    }
  }, [open, vendor?.id]); // form is stable (react-hook-form)

  const handleSubmit = async (data: VendorInput) => {
    await onSubmit(data);
  };

  const isNavLinked = !!vendor?.navVendorId;
  const title = vendor
    ? canEdit ? 'Modifica Fornitore' : 'Visualizza Fornitore'
    : 'Nuovo Fornitore';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {!canEdit && (
            <DialogDescription>Visualizzazione in sola lettura.</DialogDescription>
          )}
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel className="flex items-center gap-2">
                      Ragione Sociale *
                      {isNavLinked && (
                        <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">da NAV</span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. Acme S.r.l."
                        disabled={!canEdit || isLoading || isNavLinked}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="countryCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      Paese
                      {isNavLinked && (
                        <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">da NAV</span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. IT"
                        disabled={!canEdit || isLoading || isNavLinked}
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="nickname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nickname</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. Acme"
                        disabled={!canEdit || isLoading}
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="referente"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Referente commerciale</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. Mario Rossi"
                        disabled={!canEdit || isLoading}
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="es. info@acme.it"
                        disabled={!canEdit || isLoading}
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefono</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. +39 02 1234567"
                        disabled={!canEdit || isLoading}
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contatto messaggistica</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. WhatsApp, WeChat..."
                        disabled={!canEdit || isLoading}
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isNavLinked ? (
                <div className="col-span-2 space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    Codice NAV
                    <span className="text-xs font-normal text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">collegato</span>
                  </label>
                  <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm font-mono text-muted-foreground">
                    {vendor?.navVendorId}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Collegamento bloccato. Usa "Scollega da NAV" per rimuoverlo.
                  </p>
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name="navVendorId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Codice NAV</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="es. V00001"
                          disabled={!canEdit || isLoading}
                          {...field}
                          value={field.value ?? ''}
                          onChange={e => field.onChange(e.target.value || null)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Note</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Note libere sul fornitore..."
                        className="resize-none"
                        rows={3}
                        disabled={!canEdit || isLoading}
                        {...field}
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                {canEdit ? 'Annulla' : 'Chiudi'}
              </Button>
              {canEdit && (
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Salvataggio...' : vendor ? 'Aggiorna' : 'Crea'}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
