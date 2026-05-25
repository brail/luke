'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import { Label } from '../../../../../components/ui/label';
import { ScrollArea } from '../../../../../components/ui/scroll-area';
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
type CollectionRowData = CollectionLayoutData['groups'][number]['rows'][number];

interface CreateRevisionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: CollectionLayoutData;
  onSuccess: () => void;
}

export function CreateRevisionDrawer({
  open,
  onOpenChange,
  layout,
  onSuccess,
}: CreateRevisionDrawerProps) {
  const allRows = layout.groups.flatMap(g => g.rows);
  const isModified = (r: CollectionRowData) => r.lastRevisedAt === null || r.updatedAt > r.lastRevisedAt;

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(
    () => new Set(allRows.filter(isModified).map(r => r.id))
  );
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

  const toggleRow = (rowId: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const selectAll = () => setSelectedRowIds(new Set(allRows.map(r => r.id)));
  const selectModified = () => setSelectedRowIds(new Set(allRows.filter(isModified).map(r => r.id)));
  const selectNone = () => setSelectedRowIds(new Set());

  const canSubmit = revisionTypeValue.length > 0;

  const handleSubmit = () => {
    if (!revisionTypeValue) return;
    createMutation.mutate({
      collectionLayoutId: layout.id,
      revisionTypeValue,
      cause: 'MANUAL',
      notes: notes.trim() || null,
      includedRowIds: [...selectedRowIds],
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[560px] sm:max-w-[560px] flex flex-col">
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
              <SelectContent>
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
              rows={2}
              maxLength={1000}
            />
          </div>

          {/* Row selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Righe da includere ({selectedRowIds.size} / {allRows.length})</Label>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectAll}>Tutte</Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectModified}>Solo modificate</Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectNone}>Nessuna</Button>
              </div>
            </div>

            <ScrollArea className="h-64 rounded-md border">
              <div className="p-2 space-y-0.5">
                {layout.groups.map(group => (
                  <div key={group.id}>
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/50 rounded">
                      {group.name}
                    </div>
                    {group.rows.map((row: CollectionRowData) => {
                      const rowIsModified = isModified(row);
                      return (
                        <div key={row.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50">
                          <Checkbox
                            checked={selectedRowIds.has(row.id)}
                            onCheckedChange={() => toggleRow(row.id)}
                          />
                          <span className="text-sm flex-1 truncate">{row.line}{row.article ? ` — ${row.article}` : ''}</span>
                          {rowIsModified && (
                            <Badge variant="secondary" className="text-xs px-1 py-0 shrink-0">Modificata</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {allRows.length === 0 && (
                  <p className="text-sm text-muted-foreground p-4 text-center">Nessuna riga nel layout</p>
                )}
              </div>
            </ScrollArea>
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
