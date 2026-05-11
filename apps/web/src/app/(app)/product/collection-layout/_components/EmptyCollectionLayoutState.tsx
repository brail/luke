'use client';

import { AlertCircle, ArrowLeft, Copy, LayoutGrid, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { usePermission } from '../../../../../hooks/usePermission';
import { trpc } from '../../../../../lib/trpc';
import { cn } from '../../../../../lib/utils';

interface EmptyCollectionLayoutStateProps {
  brandId: string;
  seasonId: string;
  onCreateEmpty: (availableGenders: string[]) => void;
  onCopyFromSeason: (fromSeasonId: string, rows: { id: string; copyQuotations: boolean }[]) => void;
  isLoading?: boolean;
}

const GENDER_OPTIONS = [
  { label: 'Solo Uomo', value: ['MAN'] },
  { label: 'Solo Donna', value: ['WOMAN'] },
  { label: 'Uomo + Donna', value: ['MAN', 'WOMAN'] },
] as const;

function genderKey(v: readonly string[]) {
  return [...v].sort().join(',');
}

type RowSelection = { included: boolean; copyQuotations: boolean };

export function EmptyCollectionLayoutState({
  brandId,
  seasonId,
  onCreateEmpty,
  onCopyFromSeason,
  isLoading = false,
}: EmptyCollectionLayoutStateProps) {
  const { can } = usePermission();
  const canUpdate = can('collection_layout:update');

  const [selectedGenders, setSelectedGenders] = useState<string[]>(['MAN', 'WOMAN']);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [selectedFromSeasonId, setSelectedFromSeasonId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [rowSelections, setRowSelections] = useState<Map<string, RowSelection>>(new Map());
  const rowSelectionsInitialized = useRef(false);

  const { data: seasons = [] } = trpc.season.list.useQuery(
    { isActive: true },
    { select: data => data.items.filter(s => s.id !== seasonId) }
  );

  const { data: sourceLayout, isLoading: isLoadingLayout } = trpc.collectionLayout.get.useQuery(
    { brandId, seasonId: selectedFromSeasonId ?? '' },
    { enabled: step === 2 && !!selectedFromSeasonId }
  );

  // Init all rows as included+with quotations on first load. Ref-guard prevents background
  // refetches (SWR) from resetting in-progress user selections.
  useEffect(() => {
    if (!sourceLayout || rowSelectionsInitialized.current) return;
    rowSelectionsInitialized.current = true;
    const allRows = sourceLayout.groups.flatMap(g => g.rows);
    setRowSelections(new Map(allRows.map(r => [r.id, { included: true, copyQuotations: true }])));
  }, [sourceLayout]);

  const allRowIds = sourceLayout?.groups.flatMap(g => g.rows.map(r => r.id)) ?? [];
  const selectedRows = [...rowSelections.entries()]
    .filter(([, s]) => s.included)
    .map(([id, s]) => ({ id, copyQuotations: s.copyQuotations }));

  function setAllIncluded(included: boolean) {
    setRowSelections(prev => {
      const next = new Map(prev);
      for (const id of allRowIds) {
        const cur = next.get(id) ?? { included: false, copyQuotations: true };
        next.set(id, { ...cur, included });
      }
      return next;
    });
  }

  function setAllQuotations(copyQuotations: boolean) {
    setRowSelections(prev => {
      const next = new Map(prev);
      for (const [id, sel] of next) {
        if (sel.included) next.set(id, { ...sel, copyQuotations });
      }
      return next;
    });
  }

  function toggleRowIncluded(id: string, included: boolean) {
    setRowSelections(prev => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { included: false, copyQuotations: true };
      next.set(id, { ...cur, included });
      return next;
    });
  }

  function toggleRowQuotations(id: string, copyQuotations: boolean) {
    setRowSelections(prev => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { included: false, copyQuotations: true };
      next.set(id, { ...cur, copyQuotations });
      return next;
    });
  }

  function resetDialogState() {
    setIsCopyDialogOpen(false);
    setSelectedFromSeasonId(null);
    setStep(1);
    setRowSelections(new Map());
    rowSelectionsInitialized.current = false;
  }

  function handleCopy() {
    if (!selectedFromSeasonId || selectedRows.length === 0) return;
    onCopyFromSeason(selectedFromSeasonId, selectedRows);
    resetDialogState();
  }

  const selectedKey = genderKey(selectedGenders);

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-6">
      <div className="rounded-full bg-muted p-5">
        <LayoutGrid className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-semibold">
          Nessun Collection Layout configurato
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Non esiste ancora un collection layout per la combinazione
          brand+stagione corrente. Creane uno nuovo o copia da una stagione
          precedente.
        </p>
      </div>

      {/* Gender selector */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Gender disponibili nel layout</p>
        <div className="flex gap-2 justify-center">
          {GENDER_OPTIONS.map(opt => (
            <button
              key={genderKey(opt.value)}
              type="button"
              onClick={() => setSelectedGenders([...opt.value])}
              disabled={!canUpdate}
              className={cn(
                'px-4 py-2 rounded-md border text-sm font-medium transition-colors',
                selectedKey === genderKey(opt.value)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap justify-center">
        {seasons.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setIsCopyDialogOpen(true)}
            disabled={!canUpdate || isLoading}
          >
            <Copy className="h-4 w-4 mr-2" />
            Copia da stagione precedente
          </Button>
        )}
        <Button onClick={() => onCreateEmpty(selectedGenders)} disabled={!canUpdate || isLoading}>
          <Plus className="h-4 w-4 mr-2" />
          Crea layout vuoto
        </Button>
      </div>

      <Dialog open={isCopyDialogOpen} onOpenChange={open => { if (!open) resetDialogState(); }}>
        <DialogContent className={step === 2 ? 'max-w-2xl' : 'max-w-md'}>
          {/* ── Step 1: scegli stagione ─────────────────────── */}
          {step === 1 && (
            <>
              <DialogHeader>
                <DialogTitle>Copia da stagione precedente</DialogTitle>
                <DialogDescription>
                  Seleziona la stagione da cui copiare il collection layout.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {seasons.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedFromSeasonId(s.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors',
                      selectedFromSeasonId === s.id
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    )}
                  >
                    {s.code} {s.year}
                  </button>
                ))}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={resetDialogState}>
                  Annulla
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={!selectedFromSeasonId}
                >
                  Avanti →
                </Button>
              </DialogFooter>
            </>
          )}

          {/* ── Step 2: scegli righe ────────────────────────── */}
          {step === 2 && (
            <>
              <DialogHeader>
                <DialogTitle>Scegli righe da copiare</DialogTitle>
                <DialogDescription>
                  Seleziona le righe da includere e se copiarne le quotazioni (prezzi e fornitori).
                </DialogDescription>
              </DialogHeader>

              <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-xs text-amber-800 dark:text-amber-300">
                  Il campo <strong>progress</strong> verrà azzerato in tutte le righe copiate. Le foto non vengono copiate.
                </AlertDescription>
              </Alert>

              {/* Shortcut globali */}
              <div className="flex flex-wrap gap-2 text-xs">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAllIncluded(true)}>
                  Seleziona tutte
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAllIncluded(false)}>
                  Deseleziona tutte
                </Button>
                <span className="text-muted-foreground self-center">·</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAllQuotations(true)}
                  disabled={selectedRows.length === 0}>
                  Tutte con quotazioni
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAllQuotations(false)}
                  disabled={selectedRows.length === 0}>
                  Tutte senza quotazioni
                </Button>
              </div>

              {isLoadingLayout ? (
                <p className="text-sm text-muted-foreground text-center py-6">Caricamento righe...</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                  {/* Header colonne */}
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center px-1">
                    <span />
                    <span className="text-xs font-medium text-muted-foreground text-center w-16">Includi</span>
                    <span className="text-xs font-medium text-muted-foreground text-center w-20">Quotazioni</span>
                  </div>

                  {sourceLayout?.groups.map(group => (
                    <div key={group.id} className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                        {group.name}
                      </p>
                      {group.rows.map(row => {
                        const sel = rowSelections.get(row.id) ?? { included: false, copyQuotations: true };
                        const label = `${row.gender} — ${row.line}${row.article ? ' ' + row.article : ''}`;
                        return (
                          <div
                            key={row.id}
                            className={cn(
                              'grid grid-cols-[1fr_auto_auto] gap-2 items-center rounded-md border px-3 py-2 text-sm transition-colors',
                              sel.included ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'
                            )}
                          >
                            <span className={cn('truncate', !sel.included && 'text-muted-foreground')}>
                              {label}
                            </span>
                            <div className="flex justify-center w-16">
                              <Checkbox
                                checked={sel.included}
                                onCheckedChange={v => toggleRowIncluded(row.id, !!v)}
                                disabled={!canUpdate}
                              />
                            </div>
                            <div className="flex justify-center w-20">
                              <Checkbox
                                checked={sel.included && sel.copyQuotations}
                                onCheckedChange={v => toggleRowQuotations(row.id, !!v)}
                                disabled={!canUpdate || !sel.included}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => setStep(1)} className="sm:mr-auto">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Indietro
                </Button>
                <Button variant="outline" onClick={resetDialogState}>
                  Annulla
                </Button>
                <Button
                  onClick={handleCopy}
                  disabled={!canUpdate || selectedRows.length === 0 || isLoading}
                >
                  Copia {selectedRows.length} {selectedRows.length === 1 ? 'riga' : 'righe'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
