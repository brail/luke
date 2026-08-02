'use client';

import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import {
  CollectionAlertThresholdsSchema,
  type AlertBand,
  type AlertBandEmphasis,
  type AlertOutcomeBand,
  type CollectionAlertThresholds,
} from '@luke/core';

import { SectionCard } from '../../../../components/SectionCard';
import { SettingsFormShell } from '../../../../components/settings/SettingsFormShell';
import { Badge } from '../../../../components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useToast } from '../../../../hooks/use-toast';
import { usePermission } from '../../../../hooks/usePermission';
import { bandBadgeStyle, isHexColor } from '../../../../lib/alertBandStyle';
import { trpc } from '../../../../lib/trpc';
import { cn } from '../../../../lib/utils';

const EMPTY_BAND: AlertBand = {
  minDaysToDeadline: 0,
  maxDaysToDeadline: null,
  color: '#6B7280',
  label: 'Nuova banda',
  emphasis: 'outline',
};

/** Visual weight of a band's badge — the second severity axis next to color, so more than ~4
 * bands stay distinguishable. Mirrors `AlertBandEmphasisSchema` in @luke/core. */
const EMPHASIS_OPTIONS: { value: AlertBandEmphasis; label: string }[] = [
  { value: 'outline', label: 'Contorno' },
  { value: 'soft', label: 'Tenue' },
  { value: 'solid', label: 'Pieno' },
];

/** Larghezze delle colonne condivise dalle due tabelle (bande a range ed esiti), così le due
 * sezioni della pagina si leggono come un'unica griglia invece che come due form scollegati. */
const COL = {
  days: 'w-[104px]',
  label: 'min-w-[180px]',
  color: 'w-[164px]',
  emphasis: 'w-[148px]',
  preview: 'w-[160px]',
  actions: 'w-[116px]',
};

/** Swatch + hex della stessa banda: due input sullo stesso valore, sempre affiancati. */
function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="color"
        aria-label="Colore"
        className="h-9 w-9 shrink-0 p-1"
        // Il campo nativo accetta solo #RRGGBB: un valore incollato a metà digitazione lo
        // farebbe tornare a nero, quindi finché non è valido mostra il grigio di default.
        // Stesso predicato con cui `bandBadgeStyle` decide se sa rendere il colore.
        value={isHexColor(value) ? value : '#6B7280'}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      <Input
        aria-label="Colore esadecimale"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="h-9 font-mono text-xs"
      />
    </div>
  );
}

function EmphasisSelect({
  value,
  onChange,
  disabled,
}: {
  value: AlertBandEmphasis;
  onChange: (emphasis: AlertBandEmphasis) => void;
  disabled: boolean;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={v => onChange(v as AlertBandEmphasis)}>
      <SelectTrigger className="h-9" aria-label="Intensità">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EMPHASIS_OPTIONS.map(o => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Anteprima del badge come lo vedrà l'utente finale: colore ed emphasis sono valori runtime
 * (hex da AppConfig), non design token, quindi la leggibilità della combinazione si verifica
 * solo guardandola. */
function BandPreview({ color, emphasis, label }: { color: string; emphasis: AlertBandEmphasis; label: string }) {
  return (
    <Badge variant="outline" className="max-w-full truncate" style={bandBadgeStyle({ color, emphasis })}>
      {label || 'Banda'}
    </Badge>
  );
}

/**
 * Le tre celle che definiscono l'aspetto di una banda più la sua anteprima. Identiche fra la
 * tabella delle bande a range e quella degli esiti — le larghezze in `COL` promettono già che le
 * due si leggano come un'unica griglia, e una promessa mantenuta a copia-incolla si rompe al primo
 * ritocco su una sola delle due.
 */
function BandAppearanceCells({
  band,
  disabled,
  onPatch,
}: {
  band: { label: string; color: string; emphasis: AlertBandEmphasis };
  disabled: boolean;
  onPatch: (patch: Partial<{ label: string; color: string; emphasis: AlertBandEmphasis }>) => void;
}) {
  return (
    <>
      <TableCell className="py-2">
        <Input
          aria-label="Etichetta"
          className="h-9"
          value={band.label}
          disabled={disabled}
          onChange={e => onPatch({ label: e.target.value })}
        />
      </TableCell>
      <TableCell className="py-2">
        <ColorField value={band.color} disabled={disabled} onChange={color => onPatch({ color })} />
      </TableCell>
      <TableCell className="py-2">
        <EmphasisSelect value={band.emphasis} disabled={disabled} onChange={emphasis => onPatch({ emphasis })} />
      </TableCell>
      <TableCell className="py-2">
        <BandPreview color={band.color} emphasis={band.emphasis} label={band.label} />
      </TableCell>
    </>
  );
}

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
      <div className="rounded-md border border-border">
        {/* `Table` porta con sé il wrapper `overflow-auto`: la larghezza minima fa scorrere la
            tabella su viewport strette invece di schiacciare gli input fino a renderli inusabili. */}
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={COL.days}>Da (gg)</TableHead>
              <TableHead className={COL.days}>A (gg)</TableHead>
              <TableHead className={COL.label}>Etichetta</TableHead>
              <TableHead className={COL.color}>Colore</TableHead>
              <TableHead className={COL.emphasis}>Intensità</TableHead>
              <TableHead className={COL.preview}>Anteprima</TableHead>
              <TableHead className={cn(COL.actions, 'text-right')}>
                <span className="sr-only">Azioni</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bands.map((band, index) => (
              <TableRow key={index} className="hover:bg-transparent">
                <TableCell className="py-2">
                  <Input
                    type="number"
                    aria-label="Da giorni"
                    className="h-9"
                    value={band.minDaysToDeadline}
                    disabled={disabled}
                    onChange={e =>
                      updateBand(index, { minDaysToDeadline: parseInt(e.target.value, 10) || 0 })
                    }
                  />
                </TableCell>
                <TableCell className="py-2">
                  <Input
                    type="number"
                    aria-label="A giorni"
                    // Il vuoto è un valore ammesso (nessun limite superiore), non un campo da
                    // compilare: il placeholder lo dice dove serve, invece che nell'intestazione.
                    placeholder="illimitato"
                    className="h-9"
                    value={band.maxDaysToDeadline ?? ''}
                    disabled={disabled}
                    onChange={e =>
                      updateBand(index, {
                        maxDaysToDeadline: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                      })
                    }
                  />
                </TableCell>
                <BandAppearanceCells
                  band={band}
                  disabled={disabled}
                  onPatch={patch => updateBand(index, patch)}
                />
                <TableCell className="py-2">
                  <div className="flex justify-end gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Sposta su"
                      disabled={disabled || index === 0}
                      onClick={() => moveBand(index, -1)}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Sposta giù"
                      disabled={disabled || index === bands.length - 1}
                      onClick={() => moveBand(index, 1)}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label="Rimuovi banda"
                      disabled={disabled || bands.length <= 1}
                      onClick={() => removeBand(index)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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

/**
 * I due badge di esito (conclusa in tempo / in ritardo) in un'unica tabella, con le stesse
 * colonne delle bande a range. Non hanno un intervallo di giorni — la conclusione è uno stato,
 * non una distanza da una scadenza — quindi la prima colonna dice *quando* si applicano invece
 * di chiedere un numero.
 */
function OutcomeBandsTable({
  completedBand,
  completedLateBand,
  onChange,
  disabled,
}: {
  completedBand: AlertOutcomeBand;
  completedLateBand: AlertOutcomeBand;
  onChange: (key: 'completedBand' | 'completedLateBand', band: AlertOutcomeBand) => void;
  disabled: boolean;
}) {
  const rows = [
    {
      key: 'completedBand' as const,
      band: completedBand,
      title: 'Conclusa in tempo',
      description: "Entro la scadenza dell'ultima milestone legata a una fase attiva",
    },
    {
      key: 'completedLateBand' as const,
      band: completedLateBand,
      title: 'Conclusa in ritardo',
      description: 'Dopo quella scadenza',
    },
  ];

  return (
    <div className="rounded-md border border-border">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Esito</TableHead>
            <TableHead className={COL.label}>Etichetta</TableHead>
            <TableHead className={COL.color}>Colore</TableHead>
            <TableHead className={COL.emphasis}>Intensità</TableHead>
            <TableHead className={COL.preview}>Anteprima</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ key, band, title, description }) => (
            <TableRow key={key} className="hover:bg-transparent">
              <TableCell className="py-2">
                <div className="font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{description}</div>
              </TableCell>
              <BandAppearanceCells
                band={band}
                disabled={disabled}
                onPatch={patch => onChange(key, { ...band, ...patch })}
              />
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
            title="Esito al completamento"
            description="Badge mostrato quando una riga viene marcata come conclusa, a seconda di come la data di conclusione si colloca rispetto all'ultima milestone pianificata"
          >
            <OutcomeBandsTable
              completedBand={thresholds.completedBand}
              completedLateBand={thresholds.completedLateBand}
              onChange={(key, band) => patchThresholds(t => ({ ...t, [key]: band }))}
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
