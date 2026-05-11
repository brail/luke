'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { CALENDAR_MILESTONE_STATUS } from '@luke/core';

import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

interface Props {
  open: boolean;
  onClose: () => void;
  onCloned: () => void;
  targetBrandId: string;
  targetSeasonId: string;
}

export function CloneBrandSeasonDialog({ open, onClose, onCloned, targetBrandId, targetSeasonId }: Props) {
  const [sourceBrandId, setSourceBrandId] = useState('');
  const [sourceSeasonId, setSourceSeasonId] = useState('');
  const [dateShiftDays, setDateShiftDays] = useState('0');

  const { data: brandsData } = trpc.brand.list.useQuery(
    { isActive: true, limit: 100 },
    { enabled: open }
  );
  const { data: seasonsData } = trpc.season.list.useQuery(
    { isActive: true, limit: 100 },
    { enabled: open }
  );

  const cloneMutation = trpc.seasonCalendar.cloneFromBrandSeason.useMutation({
    onSuccess: data => {
      toast.success(`Clonato: ${data.milestonesCreated} milestone create`);
      onCloned();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleClone = () => {
    if (!sourceBrandId || !sourceSeasonId) {
      toast.error('Seleziona brand e stagione sorgente');
      return;
    }
    const shift = parseInt(dateShiftDays, 10);
    cloneMutation.mutate({
      sourceBrandId,
      sourceSeasonId,
      targetBrandId,
      targetSeasonId,
      dateShiftDays: isNaN(shift) ? 0 : shift,
      includeStatuses: CALENDAR_MILESTONE_STATUS.filter(s => s !== 'CANCELLED'),
    });
  };

  const brands = brandsData?.items ?? [];
  const seasons = seasonsData?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Clona da altro calendario</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Brand sorgente</Label>
            <Select value={sourceBrandId} onValueChange={setSourceBrandId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona brand" />
              </SelectTrigger>
              <SelectContent>
                {brands.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Stagione sorgente</Label>
            <Select value={sourceSeasonId} onValueChange={setSourceSeasonId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona stagione" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.year ? ` ${s.year}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shift-days">Offset giorni</Label>
            <Input
              id="shift-days"
              type="number"
              value={dateShiftDays}
              onChange={e => setDateShiftDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Numero di giorni da aggiungere a ogni data (negativo per anticipare).
            </p>
          </div>

          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Verranno clonate le milestone con stato: <strong>Pianificato, In corso, Completato</strong>.
            Le milestone Annullate non vengono copiate.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cloneMutation.isPending}>
            Annulla
          </Button>
          <Button
            onClick={handleClone}
            disabled={cloneMutation.isPending || !sourceBrandId || !sourceSeasonId}
          >
            {cloneMutation.isPending ? 'Clonazione…' : 'Clona'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
