'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Textarea } from '../../../../components/ui/textarea';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

interface Props {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  initialNote: string;
}

export function CalendarEventNoteDialog({ open, onClose, eventId, eventTitle, initialNote }: Props) {
  const [body, setBody] = useState(initialNote);
  const [status, setStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setBody(initialNote);
      setStatus('idle');
    }
  }, [open, eventId, initialNote]);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const utils = trpc.useUtils();

  const upsertMutation = trpc.seasonCalendar.upsertNote.useMutation({
    onSuccess: () => {
      setStatus('saved');
      void utils.seasonCalendar.listMilestones.invalidate();
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 2500);
    },
    onError: err => {
      setStatus('dirty');
      toast.error(getTrpcErrorMessage(err));
    },
  });

  const save = () => {
    if (status !== 'dirty') return;
    setStatus('saving');
    upsertMutation.mutate({ eventId, body: body.trim() });
  };

  const handleChange = (val: string) => {
    setBody(val);
    setStatus(val.trim() !== initialNote.trim() ? 'dirty' : 'idle');
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { save(); onClose(); } }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold leading-snug truncate">
            {eventTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Note personali</span>
            <span className="text-[11px] tabular-nums">
              {status === 'dirty' && <span className="text-amber-500">● non salvato</span>}
              {status === 'saving' && <span className="text-muted-foreground animate-pulse">salvataggio…</span>}
              {status === 'saved' && <span className="text-green-600 dark:text-green-400">✓ salvato</span>}
            </span>
          </div>
          <Textarea
            value={body}
            onChange={e => handleChange(e.target.value)}
            onBlur={save}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
            placeholder="Aggiungi una nota personale…"
            className="text-sm resize-none"
            rows={5}
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground/50">Salvato automaticamente · ⌘↵ per salvare subito</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Chiudi</Button>
          <Button onClick={save} disabled={status !== 'dirty' || upsertMutation.isPending}>
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
