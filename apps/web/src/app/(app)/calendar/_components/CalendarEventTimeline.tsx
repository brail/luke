'use client';

import { Plus, StickyNote } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { cn } from '../../../../lib/utils';
import { MONTH_NAMES_IT } from '../constants';
import { formatVisibleFunctions, getIsoWeek, resolveBrandColor } from '../utils';

import { type CalendarEventItem as CalendarEvent } from './types';

interface Props {
  milestones: CalendarEvent[];
  onEventClick: (id: string) => void;
  onNoteClick?: (id: string) => void;
  onDayClick?: (isoDate: string) => void;
  onBulkDelete?: (ids: string[]) => void;
  activeBrandId?: string;
  functionsById: Record<string, string>;
  canUpdate?: boolean;
  brandColorMap: Record<string, string>;
}

/**
 * Chronological list view that groups calendar events by ISO week.
 *
 * Supports multi-select for bulk deletion (gated by `canUpdate`). Each row
 * shows the event chip, visible functions, and a sticky-note icon when a personal
 * note exists.
 *
 * @param onBulkDelete - Called with the selected event IDs to trigger deletion.
 * @param functionsById - Map of function ID → name, shown next to each event.
 * @param activeBrandId - Dims events that belong to a different brand.
 * @param brandColorMap - Pre-computed brand-ID→colour map.
 */
export function CalendarEventTimeline({ milestones, onEventClick, onNoteClick, onDayClick, onBulkDelete, activeBrandId, functionsById, canUpdate, brandColorMap }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const sorted = useMemo(
    () => [...milestones].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [milestones]
  );

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; firstDay: Date; items: typeof sorted }>();
    for (const m of sorted) {
      const d = new Date(m.startAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!map.has(key)) map.set(key, { label: `${MONTH_NAMES_IT[d.getMonth()]} ${d.getFullYear()}`, firstDay: new Date(d.getFullYear(), d.getMonth(), 1), items: [] });
      map.get(key)!.items.push(m);
    }
    return Array.from(map.values());
  }, [sorted]);

  const allIds = useMemo(() => sorted.map(m => m.id), [sorted]);
  const allSelected = useMemo(() => allIds.length > 0 && allIds.every(id => selected.has(id)), [allIds, selected]);

  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(allIds) : new Set());
  const toggleOne = (id: string) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const handleConfirmDelete = () => {
    const ids = [...selected];
    setSelected(new Set());
    setConfirmOpen(false);
    onBulkDelete?.(ids);
  };

  const colClass = canUpdate
    ? 'grid-cols-[32px_32px_120px_1fr_120px_120px_28px]'
    : 'grid-cols-[32px_120px_1fr_120px_120px_28px]';

  return (
    <>
      {canUpdate && selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b text-sm">
          <span className="text-muted-foreground">{selected.size} selezionat{selected.size === 1 ? 'a' : 'e'}</span>
          <Button variant="destructive" size="xs" onClick={() => setConfirmOpen(true)}>
            Elimina selezionat{selected.size === 1 ? 'a' : 'e'}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>Deseleziona</Button>
        </div>
      )}

      <div className="space-y-0">
        <div className={cn('grid gap-x-4 px-3 py-2 text-xs font-medium text-muted-foreground border-b', colClass)}>
          {canUpdate && <span className="flex items-center justify-center"><Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} aria-label="Seleziona tutto" /></span>}
          <span className="text-center">W</span>
          <span>Data</span>
          <span>Evento</span>
          <span>Visibile a</span>
          <span>Stato</span>
          <span />
        </div>

        {groups.map(group => (
          <div key={group.label}>
            <div className={cn('grid gap-x-4 px-3 py-1.5 bg-muted/40 border-b border-t mt-1 first:mt-0', colClass)}>
              <div className={cn('flex items-center justify-between', canUpdate ? 'col-span-7' : 'col-span-6')}>
                <span className="text-xs font-semibold text-muted-foreground">{group.label}</span>
                {canUpdate && onDayClick && (
                  <button type="button" onClick={() => onDayClick(group.firstDay.toISOString())} className="text-muted-foreground/60 hover:text-foreground transition-colors p-0.5 rounded" title={`Aggiungi evento in ${group.label}`}>
                    <Plus size={12} />
                  </button>
                )}
              </div>
            </div>

            {group.items.map(m => {
              const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
              const d = new Date(m.startAt);
              const isSelected = selected.has(m.id);
              const hasNote = !!(m.notes?.[0]?.body);
              return (
                <div
                  key={m.id}
                  onClick={() => onEventClick(m.id)}
                  className={cn('grid gap-x-4 w-full px-3 py-2 text-sm rounded hover:bg-muted/50 transition-colors cursor-pointer items-center',
                    colClass, isOtherBrand && 'opacity-40', isSelected && 'bg-muted/30')}
                >
                  {canUpdate && (
                    <span className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(m.id)} aria-label={`Seleziona ${m.title}`} />
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums font-mono text-center">W{getIsoWeek(d)}</span>
                  <span className="text-muted-foreground tabular-nums">{d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}</span>
                  <span className="flex items-center gap-2 min-w-0">
                    {m.brandId && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: resolveBrandColor(m.brandId, brandColorMap) }} />}
                    <span className="truncate font-medium">{m.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground truncate">{formatVisibleFunctions(m.visibilities, functionsById)}</span>
                  <span>{m.cancelledAt && <Badge variant="destructive" className="text-xs">Annullato</Badge>}</span>
                  <span className="flex items-center justify-center">
                    {onNoteClick && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onNoteClick(m.id); }}
                        className={cn('p-1 rounded text-muted-foreground hover:text-foreground transition-colors', !hasNote && 'opacity-30 hover:opacity-70')}
                        title="Note personali"
                      >
                        <StickyNote size={13} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => { if (!open) setConfirmOpen(false); }}
        title={`Elimina ${selected.size} event${selected.size === 1 ? 'o' : 'i'}`}
        description={`Questa operazione è irreversibile. Vuoi eliminare ${selected.size} event${selected.size === 1 ? 'o selezionato' : 'i selezionati'}?`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
