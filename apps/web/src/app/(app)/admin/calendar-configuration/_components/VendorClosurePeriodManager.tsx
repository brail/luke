'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
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

export function VendorClosurePeriodManager({ vendorId, vendorName, vendorCountryCode }: Props) {
  const { can } = usePermission();
  const canUpdate = can('season_calendar:update');
  const { season } = useAppContext();

  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState<ClosureForm>(EMPTY_FORM);
  const [dialogOpen, setDialogOpen] = useState(false);

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
      setForm(EMPTY_FORM);
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

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(closure: (typeof closures)[number]) {
    setEditTarget(closure.id);
    setForm({
      name: closure.name,
      countryCode: closure.countryCode ?? '',
      startDate: String(closure.startDate).slice(0, 10),
      endDate: String(closure.endDate).slice(0, 10),
      type: closure.type as 'CLOSURE' | 'OPEN',
      notes: closure.notes ?? '',
    });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!season?.id) return;
    upsertMutation.mutate({
      id: editTarget ?? undefined,
      vendorId,
      seasonId: season.id,
      countryCode: form.countryCode || null,
      name: form.name,
      startDate: new Date(form.startDate).toISOString(),
      endDate: new Date(form.endDate).toISOString(),
      type: form.type,
      notes: form.notes || null,
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
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
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
                      <td className="px-3 py-2 max-w-[120px] truncate" title={c.name}>{c.name}</td>
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
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
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
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) { setDialogOpen(false); setForm(EMPTY_FORM); } }}>
        <DialogContent
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Modifica periodo' : 'Aggiungi periodo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="es. Capodanno cinese"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Paese</Label>
              <Select
                value={form.countryCode}
                onValueChange={v => setForm(f => ({ ...f, countryCode: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona paese" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map(c => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data inizio</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data fine</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.type}
                onValueChange={v => setForm(f => ({ ...f, type: v as 'CLOSURE' | 'OPEN' }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CLOSURE">Chiusura</SelectItem>
                  <SelectItem value="OPEN">Apertura extra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Opzionale"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Annulla
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={upsertMutation.isPending || !form.name || !form.startDate || !form.endDate}
            >
              {upsertMutation.isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          </DialogFooter>
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
