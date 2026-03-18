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

interface EmptyCollectionLayoutStateProps {
  brandId: string;
  seasonId: string;
  onCreateEmpty: () => void;
  onCopyFromSeason: (fromSeasonId: string) => void;
  isLoading?: boolean;
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
        <Button onClick={onCreateEmpty} disabled={!canUpdate || isLoading}>
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
