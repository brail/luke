'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Calculator } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import {
  PricingParameterSetInputSchema,
  type PricingParameterSetInput,
  PRICING_CURRENCIES,
} from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';

interface ParameterSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: PricingParameterSetInput & { id?: string };
  onSubmit: (data: PricingParameterSetInput) => void;
  isLoading?: boolean;
  mode: 'create' | 'edit';
}

export function ParameterSetDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
  isLoading = false,
  mode,
}: ParameterSetDialogProps) {
  const form = useForm<PricingParameterSetInput>({
    resolver: zodResolver(PricingParameterSetInputSchema),
    defaultValues: initialData ?? {
      name: '',
      purchaseCurrency: 'USD',
      sellingCurrency: 'EUR',
      qualityControlPercent: 5,
      transportInsuranceCost: 2.3,
      duty: 0,
      exchangeRate: 1.07,
      italyAccessoryCosts: 0.3,
      tools: 1.0,
      retailMultiplier: 2.5,
      optimalMargin: 50,
    },
  });

  // Reset del form quando il dialog si apre
  useEffect(() => {
    if (open) {
      form.reset(
        initialData ?? {
          name: '',
          purchaseCurrency: 'USD',
          sellingCurrency: 'EUR',
          qualityControlPercent: 5,
          transportInsuranceCost: 2.3,
          duty: 0,
          exchangeRate: 1.07,
          italyAccessoryCosts: 0.3,
          tools: 1.0,
          retailMultiplier: 2.5,
          optimalMargin: 50,
        }
      );
    }
  }, [open, initialData, form]);

  // Calcola companyMultiplier live
  const optimalMargin = form.watch('optimalMargin');
  const companyMultiplier =
    optimalMargin > 0 && optimalMargin < 100
      ? Math.round((1 / (1 - optimalMargin / 100)) * 100) / 100
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            {mode === 'create' ? 'Nuova variante parametri' : 'Modifica parametri'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
          >
            {/* Nome variante */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome variante *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="es. Pelle, Non Pelle, Tunisia..."
                      disabled={isLoading}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Valute */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="purchaseCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valuta acquisto</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isLoading}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRICING_CURRENCIES.map(c => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sellingCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valuta vendita</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isLoading}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRICING_CURRENCIES.map(c => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-muted-foreground mb-3">Costi e Tasse</p>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="qualityControlPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Controllo Qualità (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transportInsuranceCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trasporto + Assicurazione</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="duty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dazio (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="exchangeRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tasso di Cambio</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="italyAccessoryCosts"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Costi Accessori Italia</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tools"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stampi</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-muted-foreground mb-3">Moltiplicatori e Margini</p>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="retailMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Moltiplicatore Retail</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="optimalMargin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Margine Ottimale (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="99.9"
                          disabled={isLoading}
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Moltiplicatore aziendale calcolato (sola lettura) */}
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">
                    Moltiplicatore Aziendale{' '}
                    <Badge variant="secondary" className="ml-1 text-xs">calcolato</Badge>
                  </label>
                  <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                    {companyMultiplier > 0 ? companyMultiplier.toFixed(2) : '—'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    = 1 / (1 − margine%)
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading
                  ? 'Salvataggio...'
                  : mode === 'create'
                    ? 'Crea variante'
                    : 'Salva modifiche'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
