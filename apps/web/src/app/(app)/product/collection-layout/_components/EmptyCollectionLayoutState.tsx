'use client';

import { LayoutGrid, Plus } from 'lucide-react';
import { useState } from 'react';

import { COLLECTION_GENDER, type CollectionGender } from '@luke/core';

import { PermissionButton } from '../../../../../components/PermissionButton';
import { PermissionTooltip } from '../../../../../components/PermissionTooltip';
import { usePermission } from '../../../../../hooks/usePermission';
import { cn } from '../../../../../lib/utils';

import { CopyFromSeasonButton, type RowCopySelection } from './CopyFromSeasonButton';

interface EmptyCollectionLayoutStateProps {
  brandId: string;
  seasonId: string;
  onCreateEmpty: (availableGenders: CollectionGender[]) => void;
  onCopyFromSeason: (fromSeasonId: string, rows: RowCopySelection[]) => void;
  isLoading?: boolean;
}

const GENDER_OPTIONS = [
  { label: 'Solo Uomo', value: ['MAN'] },
  { label: 'Solo Donna', value: ['WOMAN'] },
  { label: 'Uomo + Donna', value: ['MAN', 'WOMAN'] },
] as const satisfies readonly { label: string; value: readonly CollectionGender[] }[];

function genderKey(v: readonly string[]) {
  return [...v].sort().join(',');
}

/**
 * Empty state shown when no collection layout exists for the active brand+season.
 *
 * Offers two paths: create a blank layout (with gender selection) or copy rows
 * from a previous season (`CopyFromSeasonButton`).
 *
 * @param onCreateEmpty - Called with the selected gender array to create a blank layout.
 * @param onCopyFromSeason - Called with the source season ID and row selection to copy.
 */
export function EmptyCollectionLayoutState({
  brandId,
  seasonId,
  onCreateEmpty,
  onCopyFromSeason,
  isLoading = false,
}: EmptyCollectionLayoutStateProps) {
  const { can } = usePermission();
  const canUpdate = can('collection_layout:update');

  const [selectedGenders, setSelectedGenders] = useState<CollectionGender[]>([...COLLECTION_GENDER]);
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
        {/* One tooltip for the whole group: the three toggles are disabled for the same single
            reason, so one tab stop and one message beat the sentence repeated three times. */}
        <PermissionTooltip
          hasPermission={canUpdate}
          tooltip="Non hai i permessi per creare il collection layout"
          className="w-full justify-center"
        >
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
                  // `pointer-events-none` is what lets the tooltip work: a disabled
                  // <button> dispatches no pointer events, so without it the wrapper span
                  // never sees the hover and the message stays keyboard-only.
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PermissionTooltip>
      </div>

      <div className="flex gap-3 flex-wrap justify-center">
        <CopyFromSeasonButton
          brandId={brandId}
          seasonId={seasonId}
          onCopyFromSeason={onCopyFromSeason}
          isLoading={isLoading}
        />
        <PermissionButton
          hasPermission={canUpdate}
          tooltip="Non hai i permessi per creare il collection layout"
          onClick={() => onCreateEmpty(selectedGenders)}
          disabled={isLoading}
        >
          <Plus className="h-4 w-4 mr-2" />
          Crea layout vuoto
        </PermissionButton>
      </div>
    </div>
  );
}
