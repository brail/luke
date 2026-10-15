'use client';

import { Plus, StickyNote } from 'lucide-react';
import { useMemo, useState } from 'react';

import { type CalendarDate, formatCalendarDate, isoWeekOf } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PermissionTooltip } from '../../../../components/PermissionTooltip';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { cn } from '../../../../lib/utils';
import { MONTH_NAMES_IT } from '../constants';
import { DELETE_BLOCK_REASON, eventDays, eventDeleteBlock, formatVisibleFunctions, groupBadge, groupTooltip, monthStart, resolveBrandColor, sortByFirstDay } from '../utils';

import { type CalendarEventItem as CalendarEvent } from './types';

interface Props {
  milestones: CalendarEvent[];
  /** The reader zone: timed events are dated in it. */
  zone: string;
  onEventClick: (id: string) => void;
  onNoteClick?: (id: string) => void;
  onDayClick?: (date: CalendarDate) => void;
  onBulkDelete?: (ids: string[]) => void;
  activeBrandId?: string;
  functionsById: Record<string, string>;
  canUpdate?: boolean;
  brandColorMap: Record<string, string>;
  /** Shows a fixed-width group-initials badge on each row — only worth the visual cost when the
   * current view actually mixes events from >1 planning group. */
  showGroupBadge?: boolean;
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
export function CalendarEventTimeline({ milestones, zone, onEventClick, onNoteClick, onDayClick, onBulkDelete, activeBrandId, functionsById, canUpdate, brandColorMap, showGroupBadge }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const sorted = useMemo(
    () => sortByFirstDay(milestones, zone),
    [milestones, zone]
  );

  const groups = useMemo(() => {
    const map = new Map<CalendarDate, { label: string; firstDay: CalendarDate; items: typeof sorted }>();
    for (const m of sorted) {
      // The month of the event's first date in `zone`: an all-day event on the 1st belongs to that
      // month in every zone.
      const firstDay = monthStart(eventDays(m, zone)[0]);
      if (!map.has(firstDay)) map.set(firstDay, { label: `${MONTH_NAMES_IT[Number(firstDay.slice(5, 7)) - 1]} ${firstDay.slice(0, 4)}`, firstDay, items: [] });
      map.get(firstDay)!.items.push(m);
    }
    return Array.from(map.values());
  }, [sorted, zone]);

  // Only deletable events can be selected, and the selection is read against the current list: an
  // event deleted, cancelled or frozen by someone else since it was ticked drops out on refresh.
  const deletableIds = useMemo(() => sorted.filter(m => !eventDeleteBlock(m)).map(m => m.id), [sorted]);
  const effective = useMemo(() => new Set(deletableIds.filter(id => selected.has(id))), [deletableIds, selected]);
  const allSelected = deletableIds.length > 0 && effective.size === deletableIds.length;

  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(deletableIds) : new Set());
  const toggleOne = (id: string) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const handleConfirmDelete = () => {
    setConfirmOpen(false);
    // Emptied before the outcome, so the same selection cannot be sent twice.
    setSelected(new Set());
    if (effective.size > 0) onBulkDelete?.([...effective]);
  };

  // Fixed-width columns (checkbox, badge, dates, title, function, cancelled, note) sized to their
  // content; custom track sizes aren't expressible via grid-cols-N.
  const colClass = canUpdate
    ? 'grid-cols-[32px_32px_120px_1fr_120px_120px_28px]'
    : 'grid-cols-[32px_120px_1fr_120px_120px_28px]';

  return (
    <>
      {canUpdate && effective.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b text-sm">
          <span className="text-muted-foreground">{effective.size} selezionat{effective.size === 1 ? 'a' : 'e'}</span>
          <Button variant="destructive" size="xs" onClick={() => setConfirmOpen(true)}>
            Elimina selezionat{effective.size === 1 ? 'a' : 'e'}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>Deseleziona</Button>
        </div>
      )}

      <div className="space-y-0">
        <div className={cn('grid gap-x-4 px-3 py-2 text-xs font-medium text-muted-foreground border-b', colClass)}>
          {canUpdate && <span className="flex items-center justify-center"><Checkbox checked={allSelected} disabled={deletableIds.length === 0} onCheckedChange={(v) => toggleAll(!!v)} aria-label="Seleziona tutto" /></span>}
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
                  <button type="button" onClick={() => onDayClick(group.firstDay)} className="text-muted-foreground/60 hover:text-foreground transition-colors p-0.5 rounded" title={`Aggiungi evento in ${group.label}`}>
                    <Plus size={12} />
                  </button>
                )}
              </div>
            </div>

            {group.items.map(m => {
              const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
              const firstDay = eventDays(m, zone)[0];
              const isSelected = effective.has(m.id);
              const deleteBlock = eventDeleteBlock(m);
              const hasNote = !!(m.notes?.[0]?.body);
              const badge = groupBadge(showGroupBadge, m.planningGroupName);
              return (
                <div
                  key={m.id}
                  onClick={() => onEventClick(m.id)}
                  className={cn('grid gap-x-4 w-full px-3 py-2 text-sm rounded hover:bg-muted/50 transition-colors cursor-pointer items-center',
                    colClass, isOtherBrand && 'opacity-40', isSelected && 'bg-muted/30')}
                >
                  {canUpdate && (
                    <span className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
                      <PermissionTooltip hasPermission={!deleteBlock} tooltip={deleteBlock ? DELETE_BLOCK_REASON[deleteBlock] : ''}>
                        <Checkbox checked={isSelected} disabled={!!deleteBlock} onCheckedChange={() => toggleOne(m.id)}
                          aria-label={`Seleziona ${m.title}`} className="disabled:pointer-events-none" />
                      </PermissionTooltip>
                    </span>
                  )}
                  {/* 10px: below Tailwind's text-xs (12px) floor; dense timeline week label */}
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums font-mono text-center">W{isoWeekOf(firstDay).week}</span>
                  <span className="text-muted-foreground tabular-nums">{formatCalendarDate(firstDay, { day: '2-digit', month: 'short' })}</span>
                  <span className="flex items-center gap-2 min-w-0">
                    {m.brandId && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: resolveBrandColor(m.brandId, brandColorMap) }} />}
                    {/* 10px: below Tailwind's text-xs (12px) floor; dense timeline badge */}
                    {badge && (
                      <span className="text-[10px] font-semibold text-muted-foreground shrink-0">{badge}</span>
                    )}
                    <span className="truncate font-medium" title={m.planningGroupName ? groupTooltip(m.planningGroupName, m.title) : undefined}>{m.title}</span>
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
        title={`Elimina ${effective.size} event${effective.size === 1 ? 'o' : 'i'}`}
        description={`Questa operazione è irreversibile. Vuoi eliminare ${effective.size} event${effective.size === 1 ? 'o selezionato' : 'i selezionati'}?`}
        confirmText="Elimina"
        cancelText="Annulla"
        actionType="delete"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
