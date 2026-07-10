'use client';

import { useState } from 'react';

import type { RouterOutputs } from '@luke/api';

import { PlanningGroupListRow } from '../../../../components/PlanningGroupListRow';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '../../../../components/ui/radio-group';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import { trpc } from '../../../../lib/trpc';

type PlanningGroup = RouterOutputs['planningGroup']['list'][number];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (group: PlanningGroup) => void;
  brandId: string;
  seasonId: string;
  title: string;
  /** Restricts the list to groups matching this predicate (e.g. frozen-only, unfrozen-with-events-only). */
  filter?: (group: PlanningGroup) => boolean;
  emptyMessage: string;
}

/** Small picker used by manual freeze/unfreeze actions to choose which planning group to target. */
export function SelectPlanningGroupDialog({ open, onClose, onSelect, brandId, seasonId, title, filter, emptyMessage }: Props) {
  const [selectedId, setSelectedId] = useState('');

  const { data: groups = [], isLoading } = trpc.planningGroup.list.useQuery(
    { brandId, seasonId },
    { enabled: open }
  );
  const filteredGroups = filter ? groups.filter(filter) : groups;

  const handleContinue = () => {
    const group = filteredGroups.find(g => g.id === selectedId);
    if (group) onSelect(group);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="py-2">
          {isLoading && <p className="text-sm text-muted-foreground p-4 text-center">Caricamento…</p>}
          {!isLoading && filteredGroups.length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center">{emptyMessage}</p>
          )}
          {!isLoading && filteredGroups.length > 0 && (
            <ScrollArea className="h-56 rounded-md border">
              <RadioGroup value={selectedId} onValueChange={setSelectedId} className="p-2 space-y-0.5">
                {filteredGroups.map(g => (
                  <label key={g.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value={g.id} />
                    <PlanningGroupListRow group={g} />
                  </label>
                ))}
              </RadioGroup>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={handleContinue} disabled={!selectedId}>Continua</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
