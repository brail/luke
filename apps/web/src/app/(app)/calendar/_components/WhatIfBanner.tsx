'use client';

import { AlertTriangle, Check, FlaskConical, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';

import type { ProposedShift, Violation } from '@luke/calendar';

import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';

interface Props {
  shiftCount: number;
  violations: Violation[];
  suggestion: ProposedShift[] | null;
  loading: boolean;
  onSimulate: () => void;
  onApplySuggestion: (shifts: ProposedShift[]) => void;
  onApply: () => void;
  onReset: () => void;
  eventTitleById?: Record<string, string>;
}

function ViolationRow({ v, eventTitleById }: { v: Violation; eventTitleById: Record<string, string> }) {
  const isHard = v.severity === 'HARD';
  return (
    <Alert
      variant={isHard ? 'destructive' : 'default'}
      className={cn('py-2 px-3', !isHard && 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800')}
    >
      <AlertTriangle size={13} className={cn('shrink-0', !isHard && 'text-yellow-600 dark:text-yellow-400')} />
      <AlertDescription className="text-xs ml-1">
        <Badge variant={isHard ? 'destructive' : 'secondary'} className="text-[10px] mr-1.5">{v.severity}</Badge>
        {v.details}
        {v.eventIds.length > 0 && (
          <span className="text-muted-foreground ml-1">
            ({v.eventIds.map(id => eventTitleById[id] ?? id).join(', ')})
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Sticky banner shown when the calendar is in what-if (drag-preview) mode.
 *
 * Displays the number of pending shifts, any HARD/SOFT dependency violations,
 * and an AI-suggestion button. The "Apply" action is blocked when at least one
 * HARD violation is present.
 *
 * @param shiftCount - Number of events with pending date shifts.
 * @param violations - Dependency constraint violations detected by the simulator.
 * @param suggestion - AI-proposed shift list; null while not yet simulated.
 * @param onSimulate - Triggers constraint simulation for the current shifts.
 * @param onApplySuggestion - Applies the AI-suggested shift set.
 * @param onApply - Persists all pending shifts.
 * @param onReset - Discards all pending shifts.
 * @param eventTitleById - Map of event ID → title, used to label violations.
 */
export function WhatIfBanner({
  shiftCount,
  violations,
  suggestion,
  loading,
  onSimulate,
  onApplySuggestion,
  onApply,
  onReset,
  eventTitleById = {},
}: Props) {
  const hasHard = violations.some(v => v.severity === 'HARD');
  const canApply = !hasHard;

  return (
    <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 rounded-lg mb-3 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <FlaskConical size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-300 flex-1">
          What-If — {shiftCount} spostament{shiftCount === 1 ? 'o' : 'i'}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSimulate} disabled={loading || shiftCount === 0}>
            <RefreshCw size={12} className={cn('mr-1', loading && 'animate-spin')} />
            Simula
          </Button>
          {suggestion && suggestion.length > 0 && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400"
              onClick={() => onApplySuggestion(suggestion)}
            >
              <Sparkles size={12} className="mr-1" />Suggerimento
            </Button>
          )}
          <Button
            size="sm" className="h-7 text-xs" onClick={onApply}
            disabled={!canApply || shiftCount === 0}
            title={!canApply ? 'Ci sono violazioni critiche — correggi prima di applicare' : undefined}
          >
            <Check size={12} className="mr-1" />Applica
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onReset}>
            <RotateCcw size={12} className="mr-1" />Annulla
          </Button>
        </div>
      </div>

      {violations.length > 0 && (
        <div className="border-t border-amber-200 dark:border-amber-800 px-4 py-2 space-y-1.5">
          {violations.map((v, i) => <ViolationRow key={i} v={v} eventTitleById={eventTitleById} />)}
        </div>
      )}

      {violations.length === 0 && shiftCount > 0 && (
        <div className="border-t border-amber-200 dark:border-amber-800 px-4 py-2">
          <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <Check size={12} />
            Nessuna violazione rilevata — puoi applicare gli spostamenti
          </p>
        </div>
      )}
    </div>
  );
}
