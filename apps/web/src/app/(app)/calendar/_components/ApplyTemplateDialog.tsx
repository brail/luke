'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { PlanningGroupSelect } from '../../../../components/PlanningGroupSelect';
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
import { narrowRouterOutput, trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import type { CalendarEventItem } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the events just created by the apply, so the caller can hand them to the wizard. */
  onApplied: (createdEvents: CalendarEventItem[], planningGroupId: string) => void;
  brandId: string;
  seasonId: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dialog for applying a calendar template to a planning group of the current season calendar.
 *
 * The user picks a planning group, a template, and an anchor date; the backend computes each
 * milestone's date from the template item's offsetDays. `force: true` is sent automatically when
 * the chosen group already has events (re-applying a template to the same group).
 *
 * @param brandId - Brand of the target calendar (used to list planning groups).
 * @param seasonId - Season of the target calendar (used to list planning groups).
 * @param onApplied - Called with the newly created events after a successful apply.
 */
export function ApplyTemplateDialog({ open, onClose, onApplied, brandId, seasonId }: Props) {
  const [planningGroupId, setPlanningGroupId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [anchorDate, setAnchorDate] = useState(todayIso());

  const { data: templates, isLoading: loadingTemplates } = trpc.seasonCalendar.listTemplates.useQuery(
    undefined,
    { enabled: open }
  );
  const { data: planningGroups = [], isLoading: loadingGroups } = trpc.planningGroup.list.useQuery(
    { brandId, seasonId },
    { enabled: open }
  );

  const selectedGroup = planningGroups.find(g => g.id === planningGroupId);
  const hasMilestones = (selectedGroup?._count.events ?? 0) > 0;

  const applyMutation = trpc.seasonCalendar.applyTemplate.useMutation({
    onSuccess: (data) => {
      toast.success(`Template applicato: ${data.length} milestone create`);
      onApplied(narrowRouterOutput<CalendarEventItem[]>(data), planningGroupId);
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleApply = () => {
    if (!planningGroupId || !templateId || !anchorDate) {
      toast.error('Seleziona gruppo di pianificazione, template e data ancora');
      return;
    }
    applyMutation.mutate({
      planningGroupId,
      templateId,
      anchorDate: new Date(anchorDate).toISOString(),
      force: hasMilestones,
    });
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Applica template</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Gruppo di pianificazione</Label>
            <PlanningGroupSelect
              value={planningGroupId}
              onValueChange={setPlanningGroupId}
              groups={planningGroups}
              loading={loadingGroups}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId} disabled={loadingTemplates}>
              <SelectTrigger>
                <SelectValue placeholder={loadingTemplates ? 'Caricamento…' : 'Seleziona template'} />
              </SelectTrigger>
              <SelectContent>
                {templates?.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.items.length > 0 && (
                      <span className="ml-1 text-muted-foreground">({t.items.length} milestone)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="anchor-date">Data ancora (giorno 0)</Label>
            <Input
              id="anchor-date"
              type="date"
              value={anchorDate}
              onChange={e => setAnchorDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Le milestone saranno create con offset relativo a questa data.
            </p>
          </div>

          {hasMilestones && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Il gruppo selezionato contiene già milestone. Applicando il template verranno aggiunte ulteriori milestone.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applyMutation.isPending}>
            Annulla
          </Button>
          <Button onClick={handleApply} disabled={applyMutation.isPending || !planningGroupId || !templateId || !anchorDate}>
            {applyMutation.isPending ? 'Applicazione…' : 'Applica'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
