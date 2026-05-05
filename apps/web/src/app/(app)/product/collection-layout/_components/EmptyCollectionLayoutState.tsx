'use client';

import { Copy, LayoutGrid, Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../../../components/ui/button';
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
  onCopyFromSeason: (fromSeasonId: string) => void;
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

export function EmptyCollectionLayoutState({
  brandId: _brandId,
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

  const { data: seasons = [] } = trpc.season.list.useQuery(
    { isActive: true },
    { select: data => data.items.filter(s => s.id !== seasonId) }
  );

  const handleCopy = () => {
    if (!selectedFromSeasonId) return;
    onCopyFromSeason(selectedFromSeasonId);
    setIsCopyDialogOpen(false);
  };

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

      <Dialog open={isCopyDialogOpen} onOpenChange={open => {
        setIsCopyDialogOpen(open);
        if (!open) setSelectedFromSeasonId(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Copia da stagione precedente</DialogTitle>
            <DialogDescription>
              Seleziona la stagione da cui copiare il collection layout. Le foto
              non verranno copiate.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {seasons.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedFromSeasonId(s.id)}
                className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                  selectedFromSeasonId === s.id
                    ? 'border-primary bg-primary/5 font-medium'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                }`}
              >
                {s.code} {s.year}
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCopyDialogOpen(false)}
            >
              Annulla
            </Button>
            <Button
              onClick={handleCopy}
              disabled={!canUpdate || !selectedFromSeasonId || isLoading}
            >
              Copia layout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
