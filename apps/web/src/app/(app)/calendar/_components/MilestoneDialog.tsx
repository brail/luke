'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CALENDAR_MILESTONE_TYPE, CALENDAR_MILESTONE_STATUS } from '@luke/core';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { TYPE_LABELS, STATUS_LABELS } from '../constants';


interface ExistingMilestone {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
  status: string;
  type: string;
  ownerFunctionId: string;
  publishExternally: boolean;
  visibilities: { functionId: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  calendarId: string;
  availableFunctions: { id: string; name: string }[];
  milestone?: ExistingMilestone;
  defaultDate?: string;
}

function toDateInput(val: Date | string | null | undefined): string {
  if (!val) return '';
  const d = new Date(val);
  return d.toISOString().slice(0, 10);
}

export function MilestoneDialog({ open, onClose, onSaved, calendarId, availableFunctions, milestone, defaultDate }: Props) {
  const isEdit = !!milestone;

  const defaultOwner = milestone?.ownerFunctionId ?? availableFunctions[0]?.id ?? '';

  const [title, setTitle] = useState(milestone?.title ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [type, setType] = useState<(typeof CALENDAR_MILESTONE_TYPE)[number]>((milestone?.type as (typeof CALENDAR_MILESTONE_TYPE)[number]) ?? 'MILESTONE');
  const [status, setStatus] = useState<(typeof CALENDAR_MILESTONE_STATUS)[number]>((milestone?.status as (typeof CALENDAR_MILESTONE_STATUS)[number]) ?? 'PLANNED');
  const [ownerFunctionId, setOwnerFunctionId] = useState<string>(defaultOwner);
  const [visibilityFunctionIds, setVisibilityFunctionIds] = useState<string[]>(
    milestone
      ? milestone.visibilities.map(v => v.functionId)
      : (defaultOwner ? [defaultOwner] : [])
  );
  const [startAt, setStartAt] = useState(toDateInput(milestone?.startAt ?? defaultDate));
  const [endAt, setEndAt] = useState(toDateInput(milestone?.endAt));
  const [allDay, setAllDay] = useState(milestone?.allDay ?? true);
  const [publishExternally, setPublishExternally] = useState(milestone?.publishExternally ?? false);

  // Reset form when milestone changes
  useEffect(() => {
    setTitle(milestone?.title ?? '');
    setDescription(milestone?.description ?? '');
    setType((milestone?.type as (typeof CALENDAR_MILESTONE_TYPE)[number]) ?? 'MILESTONE');
    setStatus((milestone?.status as (typeof CALENDAR_MILESTONE_STATUS)[number]) ?? 'PLANNED');
    const owner = milestone?.ownerFunctionId ?? availableFunctions[0]?.id ?? '';
    setOwnerFunctionId(owner);
    setVisibilityFunctionIds(
      milestone
        ? milestone.visibilities.map(v => v.functionId)
        : (owner ? [owner] : [])
    );
    setStartAt(toDateInput(milestone?.startAt ?? defaultDate));
    setEndAt(toDateInput(milestone?.endAt));
    setAllDay(milestone?.allDay ?? true);
    setPublishExternally(milestone?.publishExternally ?? false);
  }, [milestone?.id, open, defaultDate]);

  const handleOwnerChange = (val: string) => {
    setOwnerFunctionId(val);
    setVisibilityFunctionIds(prev => prev.includes(val) ? prev : [...prev, val]);
  };

  const toggleVisible = (fnId: string) => {
    if (fnId === ownerFunctionId) return; // owner always included
    setVisibilityFunctionIds(prev =>
      prev.includes(fnId) ? prev.filter(k => k !== fnId) : [...prev, fnId]
    );
  };

  const createMutation = trpc.seasonCalendar.createMilestone.useMutation({
    onSuccess: () => { toast.success('Milestone creata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateMutation = trpc.seasonCalendar.updateMilestone.useMutation({
    onSuccess: () => { toast.success('Milestone aggiornata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!title.trim() || !startAt) {
      toast.error('Titolo e data di inizio sono obbligatori');
      return;
    }
    if (visibilityFunctionIds.length === 0) {
      toast.error('Seleziona almeno una funzione visibile');
      return;
    }

    const startIso = new Date(startAt).toISOString();
    const endIso = endAt ? new Date(endAt).toISOString() : undefined;

    if (isEdit) {
      updateMutation.mutate({
        id: milestone.id,
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          type,
          status,
          ownerFunctionId,
          visibilityFunctionIds,
          startAt: startIso,
          endAt: endIso,
          allDay,
          publishExternally,
        },
      });
    } else {
      createMutation.mutate({
        calendarId,
        title: title.trim(),
        description: description.trim() || undefined,
        type: type as typeof CALENDAR_MILESTONE_TYPE[number],
        status: status as typeof CALENDAR_MILESTONE_STATUS[number],
        ownerFunctionId,
        visibilityFunctionIds,
        startAt: startIso,
        endAt: endIso,
        allDay,
        publishExternally,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica milestone' : 'Nuova milestone'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="ms-title">Titolo *</Label>
            <Input
              id="ms-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Nome della milestone"
            />
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={v => setType(v as (typeof CALENDAR_MILESTONE_TYPE)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALENDAR_MILESTONE_TYPE.map(t => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Stato</Label>
              <Select value={status} onValueChange={v => setStatus(v as (typeof CALENDAR_MILESTONE_STATUS)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALENDAR_MILESTONE_STATUS.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Owner function */}
          <div className="space-y-1.5">
            <Label>Funzione proprietaria *</Label>
            <Select value={ownerFunctionId} onValueChange={handleOwnerChange}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona funzione…" />
              </SelectTrigger>
              <SelectContent>
                {availableFunctions.map(fn => (
                  <SelectItem key={fn.id} value={fn.id}>{fn.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Visible functions */}
          <div className="space-y-1.5">
            <Label>Funzioni visibili</Label>
            <div className="flex flex-wrap gap-3">
              {availableFunctions.map(fn => (
                <label key={fn.id} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={visibilityFunctionIds.includes(fn.id)}
                    disabled={fn.id === ownerFunctionId}
                    onCheckedChange={() => toggleVisible(fn.id)}
                  />
                  <span className="text-sm">{fn.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ms-start">Data inizio *</Label>
              <Input
                id="ms-start"
                type="date"
                value={startAt}
                onChange={e => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-end">Data fine</Label>
              <Input
                id="ms-end"
                type="date"
                value={endAt}
                onChange={e => setEndAt(e.target.value)}
              />
            </div>
          </div>

          {/* Flags */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={allDay} onCheckedChange={v => setAllDay(!!v)} />
              <span className="text-sm">Tutto il giorno</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={publishExternally} onCheckedChange={v => setPublishExternally(!!v)} />
              <span className="text-sm">Pubblica su Google Calendar</span>
            </label>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ms-desc">Descrizione</Label>
            <Textarea
              id="ms-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Note opzionali…"
              className="resize-none text-sm"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annulla
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Salvataggio…' : isEdit ? 'Salva' : 'Crea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
