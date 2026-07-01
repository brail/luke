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
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { trpc } from '../../../../lib/trpc';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dialog letting an admin manually send the calendar digest recap for an arbitrary date range.
 */
export function SendDigestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());

  const digestMutation = trpc.system.triggerCalendarDigest.useMutation({
    onSuccess: () => {
      toast.success('Recap inviato');
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Invia Recap</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="digest-from">Dal</Label>
            <Input id="digest-from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="digest-to">Al</Label>
            <Input id="digest-to" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button
            disabled={digestMutation.isPending || !from || !to}
            onClick={() => digestMutation.mutate({ from, to })}
          >
            {digestMutation.isPending ? 'Invio...' : 'Invia'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
