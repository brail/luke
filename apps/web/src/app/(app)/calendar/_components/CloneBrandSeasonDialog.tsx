'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { CALENDAR_EVENT_STATUS } from '@luke/core';

import { PlanningGroupListRow } from '../../../../components/PlanningGroupListRow';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { ScrollArea } from '../../../../components/ui/scroll-area';
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

/**
 * Dialog for cloning milestones from another brand+season into the current calendar.
 *
 * Lets the user pick a source brand, source season, and an optional day-shift
 * offset to apply to all cloned event dates.
 *
 * @param targetBrandId - Brand ID of the calendar that will receive the cloned events.
 * @param targetSeasonId - Season ID of the calendar that will receive the cloned events.
 * @param onCloned - Called after a successful clone operation.
 */
export function CloneBrandSeasonDialog({ open, onClose, onCloned, targetBrandId, targetSeasonId }: Props) {
  const [sourceBrandId, setSourceBrandId] = useState('');
  const [sourceSeasonId, setSourceSeasonId] = useState('');
  const [sourcePlanningGroupIds, setSourcePlanningGroupIds] = useState<Set<string>>(new Set());
  const [dateShiftDays, setDateShiftDays] = useState('0');

  const { data: brandsData } = trpc.brand.list.useQuery(
    { isActive: true, limit: 100 },
    { enabled: open }
  );
  const { data: seasonsData } = trpc.season.list.useQuery(
    { isActive: true, limit: 100 },
    { enabled: open }
  );
  const { data: sourcePlanningGroups = [] } = trpc.planningGroup.list.useQuery(
    { brandId: sourceBrandId, seasonId: sourceSeasonId },
    { enabled: open && !!sourceBrandId && !!sourceSeasonId }
  );

  const toggleGroup = (groupId: string) => {
    setSourcePlanningGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

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
    if (sourcePlanningGroupIds.size === 0) {
      toast.error('Seleziona almeno un gruppo di pianificazione da clonare');
      return;
    }
    const shift = parseInt(dateShiftDays, 10);
    cloneMutation.mutate({
      sourceBrandId,
      sourceSeasonId,
      targetBrandId,
      targetSeasonId,
      sourcePlanningGroupIds: [...sourcePlanningGroupIds],
      dateShiftDays: isNaN(shift) ? 0 : shift,
      includeStatuses: CALENDAR_EVENT_STATUS.filter(s => s !== 'CANCELLED'),
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
            <Select value={sourceBrandId} onValueChange={v => { setSourceBrandId(v); setSourcePlanningGroupIds(new Set()); }}>
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
            <Select value={sourceSeasonId} onValueChange={v => { setSourceSeasonId(v); setSourcePlanningGroupIds(new Set()); }}>
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

          {sourceBrandId && sourceSeasonId && (
            <div className="space-y-1.5">
              <Label>Gruppi di pianificazione da clonare</Label>
              <ScrollArea className="h-32 rounded-md border">
                <div className="p-2 space-y-0.5">
                  {sourcePlanningGroups.length === 0 && (
                    <p className="text-sm text-muted-foreground p-4 text-center">Nessun gruppo nel calendario sorgente</p>
                  )}
                  {sourcePlanningGroups.map(g => (
                    <div key={g.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50">
                      <Checkbox
                        checked={sourcePlanningGroupIds.has(g.id)}
                        onCheckedChange={() => toggleGroup(g.id)}
                      />
                      <PlanningGroupListRow group={g} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

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
            disabled={cloneMutation.isPending || !sourceBrandId || !sourceSeasonId || sourcePlanningGroupIds.size === 0}
          >
            {cloneMutation.isPending ? 'Clonazione…' : 'Clona'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
