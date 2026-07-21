'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Label } from '../../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../../../../components/ui/sheet';
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;

interface CreateRevisionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: CollectionLayoutData;
  onSuccess: () => void;
}

/**
 * Drawer for creating a new collection layout revision snapshot.
 *
 * Lets the user choose a revision type and add a free-text note before committing.
 * The snapshot always covers every row in the layout. Calls
 * `collectionLayoutRevision.create` on save.
 *
 * @param layout - The collection layout the revision is created for.
 * @param onSuccess - Called after the revision is successfully created.
 */
export function CreateRevisionDrawer({
  open,
  onOpenChange,
  layout,
  onSuccess,
}: CreateRevisionDrawerProps) {
  const [revisionTypeValue, setRevisionTypeValue] = useState<string>('');
  const [notes, setNotes] = useState('');

  const { data: revisionTypeItems = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'revisionType' },
    { staleTime: 5 * 60 * 1000, enabled: open },
  );

  const { data: revisionsList = [] } = trpc.collectionLayoutRevision.list.useQuery(
    { collectionLayoutId: layout.id },
    { staleTime: 30 * 1000, enabled: open },
  );

  // list is sorted desc by revisionNumber — first element is the latest
  const nextRevisionNumber = (revisionsList[0]?.revisionNumber ?? -1) + 1;

  const createMutation = trpc.collectionLayoutRevision.create.useMutation({
    onSuccess: () => {
      toast.success(`Revisione rev${nextRevisionNumber} creata`);
      onOpenChange(false);
      onSuccess();
    },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const selectedRevisionType = revisionTypeItems.find(i => i.value === revisionTypeValue);

  const canSubmit = revisionTypeValue.length > 0;

  const handleSubmit = () => {
    if (!revisionTypeValue) return;
    createMutation.mutate({
      collectionLayoutId: layout.id,
      revisionTypeValue,
      cause: 'MANUAL',
      notes: notes.trim() || null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>
            Crea revisione
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              rev{nextRevisionNumber} (prossima)
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-5 py-4">
          {/* Tipo revisione */}
          <div className="space-y-1.5">
            <Label>Tipo revisione <span className="text-destructive">*</span></Label>
            <Select value={revisionTypeValue} onValueChange={setRevisionTypeValue}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona tipo revisione" />
              </SelectTrigger>
              <SelectContent className="w-[--radix-select-trigger-width]">
                {revisionTypeItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    <div className="flex flex-col gap-0.5">
                      <span>{item.label}</span>
                      {item.iso9001Categories.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.iso9001Categories.map(cat => (
                            <Badge key={cat} variant="secondary" className="text-xs px-1 py-0">{cat}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRevisionType?.iso9001Categories && selectedRevisionType.iso9001Categories.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedRevisionType.iso9001Categories.map(cat => (
                  <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
                ))}
              </div>
            )}
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="revision-notes">Note (opzionali)</Label>
            <Textarea
              id="revision-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Descrizione della revisione…"
              rows={3}
              maxLength={1000}
            />
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Annulla
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || createMutation.isPending}>
            {createMutation.isPending ? 'Creazione…' : `Crea rev${nextRevisionNumber}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
