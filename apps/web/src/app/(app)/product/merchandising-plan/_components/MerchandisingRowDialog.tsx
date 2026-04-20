'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { useEffect , useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { RouterOutputs } from '@luke/api';
import {
  MERCHANDISING_GENDER,
  MERCHANDISING_LIFE_TYPE,
  MERCHANDISING_LAUNCH_TYPE,
  MerchandisingPlanRowInputSchema,
} from '@luke/core';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
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
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';


type MerchandisingRow = RouterOutputs['merchandisingPlan']['listRows'][number];

// Schema per il form (omit planId — viene passato dall'esterno)
const FormSchema = MerchandisingPlanRowInputSchema.omit({ planId: true }).extend({
  pricingParameterSetId: z.string().optional().nullable(),
  assignedUserId: z.string().optional().nullable(),
});
type FormValues = z.infer<typeof FormSchema>;

const GENDER_LABELS: Record<string, string> = {
  MAN: 'Uomo',
  WOMAN: 'Donna',
  UNISEX: 'Unisex',
  KID: 'Bambino',
};

const LIFE_TYPE_LABELS: Record<string, string> = {
  NEW_LINE: 'New Line',
  NEW_STYLE: 'New Style',
  NEW_COLOR: 'New Color',
  CARRY_OVER: 'Carry Over',
};

const LAUNCH_TYPE_LABELS: Record<string, string> = {
  SAMPLED: 'Sampled',
  OPEN_TO_BUY: 'Open to Buy',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  row?: MerchandisingRow;
  planId: string;
  brandId: string;
  seasonId: string;
  onSubmit: (data: FormValues) => void;
  onDelete?: () => void;
  isLoading: boolean;
  canUpdate: boolean;
}

export function MerchandisingRowDialog({
  open,
  onOpenChange,
  mode,
  row,
  planId: _planId,
  brandId,
  seasonId,
  onSubmit,
  onDelete,
  isLoading,
  canUpdate,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: parameterSets = [] } = trpc.pricing.parameterSets.list.useQuery(
    { brandId, seasonId },
    { enabled: open && !!brandId && !!seasonId }
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      order: 0,
      articleCode: '',
      styleDescription: '',
      styleCode: '',
      colorCode: '',
      colorDescription: '',
      gender: 'MAN',
      productCategory: '',
      lineCode: '',
      lifeType: null,
      carryoverFromSeason: '',
      launchType: null,
      smsPairsOrder: null,
      targetPairs: null,
      cancellationStatus: '',
      designer: '',
      pricingParameterSetId: null,
      targetFobPrice: null,
      firstOfferPrice: null,
      finalOfferPrice: null,
      retailTargetIt: null,
      wholesaleIt: null,
      retailTargetEu: null,
      wholesaleEu: null,
      pricingNotes: '',
      generalNotes: '',
      assignedUserId: null,
    },
  });

  // Populate form when editing
  useEffect(() => {
    if (mode === 'edit' && row) {
      form.reset({
        order: row.order,
        articleCode: row.articleCode,
        styleDescription: row.styleDescription,
        styleCode: row.styleCode ?? '',
        colorCode: row.colorCode,
        colorDescription: row.colorDescription,
        gender: row.gender as any,
        productCategory: row.productCategory,
        lineCode: row.lineCode ?? '',
        lifeType: (row.lifeType as any) ?? null,
        carryoverFromSeason: row.carryoverFromSeason ?? '',
        launchType: (row.launchType as any) ?? null,
        smsPairsOrder: row.smsPairsOrder ?? null,
        targetPairs: row.targetPairs ?? null,
        cancellationStatus: row.cancellationStatus ?? '',
        designer: row.designer ?? '',
        pricingParameterSetId: row.pricingParameterSetId ?? null,
        targetFobPrice: row.targetFobPrice ? Number(row.targetFobPrice) : null,
        firstOfferPrice: row.firstOfferPrice ? Number(row.firstOfferPrice) : null,
        finalOfferPrice: row.finalOfferPrice ? Number(row.finalOfferPrice) : null,
        retailTargetIt: row.retailTargetIt ? Number(row.retailTargetIt) : null,
        wholesaleIt: row.wholesaleIt ? Number(row.wholesaleIt) : null,
        retailTargetEu: row.retailTargetEu ? Number(row.retailTargetEu) : null,
        wholesaleEu: row.wholesaleEu ? Number(row.wholesaleEu) : null,
        pricingNotes: row.pricingNotes ?? '',
        generalNotes: row.generalNotes ?? '',
        assignedUserId: row.assignedUserId ?? null,
      });
    } else if (mode === 'create') {
      form.reset();
    }
  }, [mode, row, open]);

  const handleSubmit = (values: FormValues) => {
    onSubmit(values);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Nuova riga SKU' : 'Modifica riga SKU'}
            </DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              {/* Identificazione */}
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="articleCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Codice articolo *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="es. S7BUCK15" disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="styleCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Codice stile</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="styleDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrizione stile *</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={!canUpdate} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="colorCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Codice colore *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="es. LEA" disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="colorDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrizione colore *</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!canUpdate}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MERCHANDISING_GENDER.map(g => (
                            <SelectItem key={g} value={g}>
                              {GENDER_LABELS[g] ?? g}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="productCategory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Categoria prodotto *</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lineCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Line</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="lifeType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Life type</FormLabel>
                      <Select
                        value={field.value ?? '__none__'}
                        onValueChange={v => field.onChange(v === '__none__' ? null : v)}
                        disabled={!canUpdate}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {MERCHANDISING_LIFE_TYPE.map(t => (
                            <SelectItem key={t} value={t}>
                              {LIFE_TYPE_LABELS[t] ?? t}
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
                  name="launchType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Launch type</FormLabel>
                      <Select
                        value={field.value ?? '__none__'}
                        onValueChange={v => field.onChange(v === '__none__' ? null : v)}
                        disabled={!canUpdate}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {MERCHANDISING_LAUNCH_TYPE.map(t => (
                            <SelectItem key={t} value={t}>
                              {LAUNCH_TYPE_LABELS[t] ?? t}
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
                  name="designer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Designer</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Pricing */}
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Pricing</p>
                <FormField
                  control={form.control}
                  name="pricingParameterSetId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parameter set</FormLabel>
                      <Select
                        value={field.value ?? '__none__'}
                        onValueChange={v => field.onChange(v === '__none__' ? null : v)}
                        disabled={!canUpdate}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="— Nessuno —" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">— Nessuno —</SelectItem>
                          {parameterSets.map((ps: any) => (
                            <SelectItem key={ps.id} value={ps.id}>
                              {ps.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      ['targetFobPrice', 'FOB target'],
                      ['firstOfferPrice', 'Prima offerta'],
                      ['finalOfferPrice', 'Offerta finale'],
                      ['retailTargetIt', 'Retail IT'],
                      ['wholesaleIt', 'Wholesale IT'],
                      ['retailTargetEu', 'Retail EU'],
                      ['wholesaleEu', 'Wholesale EU'],
                    ] as const
                  ).map(([name, label]) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name as any}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{label}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={field.value ?? ''}
                              onChange={e =>
                                field.onChange(
                                  e.target.value === '' ? null : Number(e.target.value)
                                )
                              }
                              disabled={!canUpdate}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
                <FormField
                  control={form.control}
                  name="pricingNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Note pricing</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value ?? ''}
                          rows={2}
                          disabled={!canUpdate}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Note generali */}
              <FormField
                control={form.control}
                name="generalNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note generali</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        rows={2}
                        disabled={!canUpdate}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="flex items-center justify-between">
                <div>
                  {mode === 'edit' && onDelete && canUpdate && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Elimina
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Annulla
                  </Button>
                  {canUpdate && (
                    <Button type="submit" disabled={isLoading}>
                      {mode === 'create' ? 'Crea' : 'Salva'}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={open => { if (!open) setConfirmDelete(false); }}
          title="Elimina riga SKU"
          description={`Sei sicuro di voler eliminare la riga "${row?.articleCode ?? ''}"? Verranno eliminate anche specsheet e immagini associate. Operazione irreversibile.`}
          confirmText="Elimina"
          cancelText="Annulla"
          variant="destructive"
          actionType="delete"
          onConfirm={() => { setConfirmDelete(false); onDelete(); }}
          isLoading={false}
        />
      )}
    </>
  );
}
