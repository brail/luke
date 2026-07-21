'use client';

import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import {
  CollectionAlertThresholdsSchema,
  type AlertBand,
  type CollectionAlertThresholds,
} from '@luke/core';

import { SectionCard } from '../../../../components/SectionCard';
import { SettingsFormShell } from '../../../../components/settings/SettingsFormShell';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { useToast } from '../../../../hooks/use-toast';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';

const EMPTY_BAND: AlertBand = {
  minDaysToDeadline: 0,
  maxDaysToDeadline: null,
  color: '#6B7280',
  label: 'Nuova banda',
};

/** Editor for one ordered list of bands (the global default, or one phase's override). */
function BandSetEditor({
  bands,
  onChange,
  disabled,
}: {
  bands: AlertBand[];
  onChange: (bands: AlertBand[]) => void;
  disabled: boolean;
}) {
  const updateBand = (index: number, patch: Partial<AlertBand>) => {
    onChange(bands.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const moveBand = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= bands.length) return;
    const next = [...bands];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const removeBand = (index: number) => {
    onChange(bands.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {bands.map((band, index) => (
        <div
          key={index}
          className="grid grid-cols-1 items-end gap-3 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_1fr_auto_auto] md:items-end"
        >
          <div className="space-y-1">
            <Label>Da giorni (min)</Label>
            <Input
              type="number"
              value={band.minDaysToDeadline}
              disabled={disabled}
              onChange={e =>
                updateBand(index, { minDaysToDeadline: parseInt(e.target.value, 10) || 0 })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>A giorni (max, vuoto = illimitato)</Label>
            <Input
              type="number"
              value={band.maxDaysToDeadline ?? ''}
              disabled={disabled}
              onChange={e =>
                updateBand(index, {
                  maxDaysToDeadline: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Etichetta</Label>
            <Input
              value={band.label}
              disabled={disabled}
              onChange={e => updateBand(index, { label: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Colore</Label>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                className="h-10 w-12 p-1"
                value={/^#[0-9A-Fa-f]{6}$/.test(band.color) ? band.color : '#6B7280'}
                disabled={disabled}
                onChange={e => updateBand(index, { color: e.target.value })}
              />
              <Input
                value={band.color}
                disabled={disabled}
                onChange={e => updateBand(index, { color: e.target.value })}
                className="w-24"
              />
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled || index === 0}
              onClick={() => moveBand(index, -1)}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled || index === bands.length - 1}
              onClick={() => moveBand(index, 1)}
            >
              <ArrowDown size={14} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled || bands.length <= 1}
              onClick={() => removeBand(index)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...bands, { ...EMPTY_BAND }])}
      >
        <Plus size={14} className="mr-1" />
        Aggiungi banda
      </Button>
    </div>
  );
}

export default function CollectionControlPage() {
  const toast = useToast();
  const { can } = usePermission();
  const canUpdate = can('config:update');

  const [thresholds, setThresholds] = useState<CollectionAlertThresholds | null>(null);
  const [newOverridePhase, setNewOverridePhase] = useState<string>('');

  const { data: existing, isLoading, error } = trpc.phaseAlert.thresholds.useQuery();
  const { data: phases } = trpc.phase.list.useQuery();

  useEffect(() => {
    if (existing) setThresholds(existing);
  }, [existing]);

  const updateMutation = trpc.phaseAlert.updateThresholds.useMutation({
    onSuccess: () => {
      toast.success('Soglie alert salvate con successo');
    },
    onError: err => {
      toast.error('Errore durante il salvataggio', { description: err.message });
    },
  });

  const patchThresholds = (fn: (t: CollectionAlertThresholds) => CollectionAlertThresholds) => {
    setThresholds(prev => (prev ? fn(prev) : prev));
  };

  const setDefaultBands = (bands: AlertBand[]) => patchThresholds(t => ({ ...t, default: { bands } }));

  const setOverrideBands = (phaseValue: string, bands: AlertBand[]) =>
    patchThresholds(t => ({
      ...t,
      perPhaseOverride: { ...t.perPhaseOverride, [phaseValue]: { bands } },
    }));

  const removeOverride = (phaseValue: string) =>
    patchThresholds(t => {
      const { [phaseValue]: _removed, ...rest } = t.perPhaseOverride ?? {};
      return { ...t, perPhaseOverride: rest };
    });

  const addOverride = () => {
    if (!newOverridePhase) return;
    patchThresholds(t => ({
      ...t,
      perPhaseOverride: {
        ...t.perPhaseOverride,
        [newOverridePhase]: { bands: t.default.bands.map(b => ({ ...b })) },
      },
    }));
    setNewOverridePhase('');
  };

  const handleSave = () => {
    if (!thresholds) return;
    const parsed = CollectionAlertThresholdsSchema.safeParse(thresholds);
    if (!parsed.success) {
      toast.error('Configurazione non valida', {
        description: parsed.error.issues[0]?.message,
      });
      return;
    }
    updateMutation.mutate(parsed.data);
  };

  const availablePhasesForOverride = (phases ?? []).filter(
    p => !(p.value in (thresholds?.perPhaseOverride ?? {}))
  );

  return (
    <SettingsFormShell
      title="Alert Calendario/Fasi"
      description="Configura le bande di criticità (giorni alla scadenza) usate dal motore di alert del calendario e delle fasi collezione"
      isLoading={isLoading}
      error={error}
    >
      {thresholds && (
        <>
          <SectionCard
            title="Bande di default"
            description="Applicate a ogni fase priva di un override specifico"
          >
            <BandSetEditor
              bands={thresholds.default.bands}
              onChange={setDefaultBands}
              disabled={!canUpdate}
            />
          </SectionCard>

          <SectionCard
            title="Override per fase"
            description="Sostituiscono le bande di default per una fase specifica (Phase.value)"
          >
            <div className="space-y-6">
              {Object.entries(thresholds.perPhaseOverride ?? {}).map(([phaseValue, set]) => {
                const phase = (phases ?? []).find(p => p.value === phaseValue);
                return (
                  <div key={phaseValue} className="space-y-2 rounded-md border border-border p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{phase?.label ?? phaseValue}</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canUpdate}
                        onClick={() => removeOverride(phaseValue)}
                      >
                        <Trash2 size={14} className="mr-1" />
                        Rimuovi override
                      </Button>
                    </div>
                    <BandSetEditor
                      bands={set.bands}
                      onChange={bands => setOverrideBands(phaseValue, bands)}
                      disabled={!canUpdate}
                    />
                  </div>
                );
              })}

              {canUpdate && availablePhasesForOverride.length > 0 && (
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label>Aggiungi override per fase</Label>
                    <Select value={newOverridePhase} onValueChange={setNewOverridePhase}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona una fase" />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePhasesForOverride.map(p => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="outline" disabled={!newOverridePhase} onClick={addOverride}>
                    <Plus size={14} className="mr-1" />
                    Aggiungi
                  </Button>
                </div>
              )}
            </div>
          </SectionCard>

          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>
                Le bande sono valutate nell&apos;ordine mostrato: la prima il cui intervallo
                contiene i giorni alla scadenza vince.
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" disabled={!canUpdate || updateMutation.isPending} onClick={handleSave}>
              {updateMutation.isPending ? 'Salvataggio...' : 'Salva Configurazione'}
            </Button>
          </div>
        </>
      )}
    </SettingsFormShell>
  );
}
