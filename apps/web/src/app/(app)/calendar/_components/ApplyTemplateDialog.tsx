'use client';

import { useState } from 'react';
import { toast } from 'sonner';

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
  onApplied: () => void;
  calendarId: string;
  hasMilestones: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ApplyTemplateDialog({ open, onClose, onApplied, calendarId, hasMilestones }: Props) {
  const [templateId, setTemplateId] = useState('');
  const [anchorDate, setAnchorDate] = useState(todayIso());

  const { data: templates, isLoading: loadingTemplates } = trpc.seasonCalendar.listTemplates.useQuery(
    undefined,
    { enabled: open }
  );

  const applyMutation = trpc.seasonCalendar.applyTemplate.useMutation({
    onSuccess: (data) => {
      toast.success(`Template applicato: ${data.length} milestone create`);
      onApplied();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleApply = () => {
    if (!templateId || !anchorDate) {
      toast.error('Seleziona template e data ancora');
      return;
    }
    applyMutation.mutate({
      calendarId,
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
              Il calendario contiene già milestone. Applicando il template verranno aggiunte ulteriori milestone.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applyMutation.isPending}>
            Annulla
          </Button>
          <Button onClick={handleApply} disabled={applyMutation.isPending || !templateId || !anchorDate}>
            {applyMutation.isPending ? 'Applicazione…' : 'Applica'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
