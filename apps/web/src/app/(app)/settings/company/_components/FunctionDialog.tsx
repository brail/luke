'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

/** Props for {@link FunctionDialog}. */
export interface FunctionDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When provided the dialog opens in edit mode; omit to create a new function. */
  fn?: { id: string; slug: string; name: string; description?: string | null };
}

/**
 * Modal dialog for creating or editing a company function (funzione aziendale).
 * Operates in create mode when `fn` is omitted and edit mode when `fn` is provided.
 */
export function FunctionDialog({ open, onClose, onSaved, fn }: FunctionDialogProps) {
  const isEdit = !!fn;
  const [slug, setSlug] = useState(fn?.slug ?? '');
  const [name, setName] = useState(fn?.name ?? '');
  const [description, setDescription] = useState(fn?.description ?? '');

  const createMutation = trpc.company.function.create.useMutation({
    onSuccess: () => { toast.success('Funzione creata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const updateMutation = trpc.company.function.update.useMutation({
    onSuccess: () => { toast.success('Funzione aggiornata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (isEdit) {
      updateMutation.mutate({ id: fn.id, name: name.trim(), description: description.trim() || undefined });
    } else {
      if (!slug.trim()) { toast.error('Slug obbligatorio'); return; }
      createMutation.mutate({ slug: slug.trim(), name: name.trim(), description: description.trim() || undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica funzione' : 'Nuova funzione aziendale'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="fn-slug">Slug *</Label>
              <Input
                id="fn-slug"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="es. product"
              />
              <p className="text-xs text-muted-foreground">Identificatore unico, non modificabile dopo la creazione</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="fn-name">Nome *</Label>
            <Input id="fn-name" value={name} onChange={e => setName(e.target.value)} placeholder="es. Prodotto" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fn-desc">Descrizione</Label>
            <Textarea id="fn-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annulla</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? 'Salvataggio…' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
