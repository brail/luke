'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { VendorClosureUpsertInputSchema } from '@luke/core';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
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
import { useAppContext } from '../../../../../contexts/AppContextProvider';
import { usePermission } from '../../../../../hooks/usePermission';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

interface Props {
  vendorId: string;
  vendorName: string;
  vendorCountryCode?: string | null;
}

interface ClosureForm {
  name: string;
  countryCode: string;
  startDate: string;
  endDate: string;
  type: 'CLOSURE' | 'OPEN';
  notes: string;
}

const EMPTY_FORM: ClosureForm = {
  name: '',
  countryCode: '',
  startDate: '',
  endDate: '',
  type: 'CLOSURE',
  notes: '',
};

/**
 * The dialog's own shape of `holidays.upsertVendorClosure`: the date inputs hold `yyyy-mm-dd` and
 * are widened to the ISO datetimes the mutation wants on submit, and `countryCode`/`notes` are
 * plain strings that become null when left empty. The ordering check is new — nothing stopped an
 * end date before the start date before.
 */
const ClosureFormSchema: z.ZodType<ClosureForm, ClosureForm> = VendorClosureUpsertInputSchema
  .pick({ name: true, type: true })
  .extend({
    countryCode: z.string(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data di inizio non valida'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data di fine non valida'),
    notes: z.string().max(500, 'Massimo 500 caratteri'),
  })
  .refine(value => value.endDate >= value.startDate, {
    path: ['endDate'],
    message: 'La data di fine non può precedere quella di inizio',
  });

/**
 * Card-based manager for a vendor's closure and extra-opening periods in the
 * active season.
 *
 * Supports manual creation, editing, prefill from national holidays, and bulk
 * confirmation. Requires an active season in AppContext; renders a placeholder
 * when none is selected. Mutations are gated by `season_calendar:update`.
 *
 * @param vendorId - ID of the vendor whose closures are managed.
 * @param vendorName - Display name shown in the card title.
 * @param vendorCountryCode - When set, prefill uses only this country's holidays.
 */
export function VendorClosurePeriodManager({ vendorId, vendorName, vendorCountryCode }: Props) {
  const { can } = usePermission();
  const canUpdate = can('season_calendar:update');
  const { season } = useAppContext();

  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<ClosureForm>({
    resolver: zodResolver(ClosureFormSchema),
    defaultValues: EMPTY_FORM,
  });

  const { data: countries = [] } = trpc.holidays.listCountries.useQuery();
  const { data: closures = [], refetch } = trpc.holidays.listVendorClosures.useQuery(
    { vendorId, seasonId: season?.id ?? '' },
    { enabled: !!season?.id },
  );

  const upsertMutation = trpc.holidays.upsertVendorClosure.useMutation({
    onSuccess: () => {
      toast.success(editTarget ? 'Periodo aggiornato' : 'Periodo aggiunto');
      setDialogOpen(false);
      setEditTarget(null);
      void refetch();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteMutation = trpc.holidays.deleteVendorClosure.useMutation({
    onSuccess: () => {
      toast.success('Periodo eliminato');
      setDeleteTarget(null);
      void refetch();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const confirmMutation = trpc.holidays.confirmVendorClosures.useMutation({
    onSuccess: data => {
      toast.success(`${data.confirmed} periodi confermati`);
      void refetch();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const prefillMutation = trpc.holidays.prefillVendorClosures.useMutation({
    onSuccess: data => {
      toast.success(`${data.created} periodi prefillati da festività`);
      void refetch();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  // The dialog stays mounted, so each opening seeds the form explicitly rather than relying on
  // defaults that were fixed the first time it rendered.
  function openCreate() {
    setEditTarget(null);
    form.reset(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(closure: (typeof closures)[number]) {
    setEditTarget(closure.id);
    form.reset({
      name: closure.name,
      countryCode: closure.countryCode ?? '',
      startDate: String(closure.startDate).slice(0, 10),
      endDate: String(closure.endDate).slice(0, 10),
      type: closure.type as 'CLOSURE' | 'OPEN',
      notes: closure.notes ?? '',
    });
    setDialogOpen(true);
  }

  function handleSave(data: ClosureForm) {
    if (!season?.id) return;
    upsertMutation.mutate({
      id: editTarget ?? undefined,
      vendorId,
      seasonId: season.id,
      countryCode: data.countryCode || null,
      name: data.name,
      startDate: new Date(data.startDate).toISOString(),
      endDate: new Date(data.endDate).toISOString(),
      type: data.type,
      notes: data.notes || null,
    });
  }

  const unconfirmed = closures.filter(c => !c.confirmedAt);

  if (!season?.id) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Seleziona una stagione per gestire i periodi di chiusura.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader size="compact">
          <CardTitle size="compact">
            Periodi di chiusura — {vendorName} ({season.name})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {canUpdate && (
              <>
                <Button type="button" size="sm" onClick={openCreate}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Aggiungi
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const codes = vendorCountryCode
                      ? [vendorCountryCode]
                      : countries.map(c => c.code);
                    if (codes.length === 0) return;
                    prefillMutation.mutate({ vendorId, seasonId: season.id, countryCodes: codes });
                  }}
                  disabled={prefillMutation.isPending || (!vendorCountryCode && countries.length === 0)}
                >
                  Prefill da festività
                </Button>
                {unconfirmed.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      confirmMutation.mutate({ ids: unconfirmed.map(c => c.id) })
                    }
                    disabled={confirmMutation.isPending}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Conferma tutti ({unconfirmed.length})
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Table */}
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Paese</th>
                  <th className="px-3 py-2 text-left font-medium">Nome</th>
                  <th className="px-3 py-2 text-left font-medium">Inizio</th>
                  <th className="px-3 py-2 text-left font-medium">Fine</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium">Stato</th>
                  {canUpdate && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {closures.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Nessun periodo di chiusura
                    </td>
                  </tr>
                ) : (
                  closures.map(c => (
                    <tr
                      key={c.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                      onClick={() => canUpdate && openEdit(c)}
                    >
                      <td className="px-3 py-2">
                        {c.countryCode ? (
                          <Badge variant="outline">{c.countryCode}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[120px] truncate" title={c.name}>{c.name}</td> {/* 120px: caps closure-name column so the table doesn't stretch; no exact scale match */}
                      <td className="px-3 py-2 tabular-nums">
                        {String(c.startDate).slice(0, 10)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {String(c.endDate).slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={c.type === 'CLOSURE' ? 'destructive' : 'secondary'}>
                          {c.type === 'CLOSURE' ? 'Chiusura' : 'Apertura extra'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {c.confirmedAt ? (
                          <Badge variant="default">
                            <Check className="mr-1 h-3 w-3" />
                            Confermato
                          </Badge>
                        ) : (
                          <Badge variant="outline">Bozza</Badge>
                        )}
                      </td>
                      {canUpdate && (
                        <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(c.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit/Create dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={open => { if (!open && !upsertMutation.isPending) setDialogOpen(false); }}
      >
        <DialogContent
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Modifica periodo' : 'Aggiungi periodo'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSave)} className="grid gap-4">
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="es. Capodanno cinese"
                          disabled={upsertMutation.isPending}
                          {...field}
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
                    <FormItem className="space-y-1.5">
                      <FormLabel>Paese</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={upsertMutation.isPending}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona paese" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {countries.map(c => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.code} — {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem className="space-y-1.5">
                        <FormLabel>Data inizio</FormLabel>
                        <FormControl>
                          <Input type="date" disabled={upsertMutation.isPending} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem className="space-y-1.5">
                        <FormLabel>Data fine</FormLabel>
                        <FormControl>
                          <Input type="date" disabled={upsertMutation.isPending} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Tipo</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={upsertMutation.isPending}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="CLOSURE">Chiusura</SelectItem>
                          <SelectItem value="OPEN">Apertura extra</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Note</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Opzionale"
                          disabled={upsertMutation.isPending}
                          {...field}
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
                  onClick={() => setDialogOpen(false)}
                  disabled={upsertMutation.isPending}
                >
                  Annulla
                </Button>
                <Button type="submit" disabled={upsertMutation.isPending}>
                  {upsertMutation.isPending ? 'Salvataggio…' : 'Salva'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Elimina periodo"
        description="Sei sicuro di voler eliminare questo periodo di chiusura?"
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ id: deleteTarget }); }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
