'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { useInvalidateContext } from '../../../../contexts/useInvalidateContext';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { SeasonDialog } from './_components/SeasonDialog';
import { SeasonTable } from './_components/SeasonTable';

import type { SeasonItem } from './_components/SeasonDialog';

export default function SeasonsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<SeasonItem | null>(null);
  const [deletingSeason, setDeletingSeason] = useState<SeasonItem | null>(null);
  const [unlinkingSeason, setUnlinkingSeason] = useState<SeasonItem | null>(null);
  const [hardDeletingSeason, setHardDeletingSeason] = useState<SeasonItem | null>(null);
  const { can } = usePermission();

  const {
    data: seasonsData = { items: [], nextCursor: null, hasMore: false },
    isLoading,
    error,
    refetch,
  } = trpc.season.list.useQuery({
    search: searchTerm || undefined,
    isActive: includeInactive ? undefined : true,
  });

  const seasons = seasonsData.items as SeasonItem[];

  const getErrorMessage = (error: any) =>
    getTrpcErrorMessage(error, {
      CONFLICT: 'Stagione con questo codice già esistente',
      NOT_FOUND: 'Stagione non trovata',
    });

  const utils = trpc.useUtils();
  const invalidateContext = useInvalidateContext();

  const invalidate = () => {
    utils.season.list.invalidate();
    invalidateContext(); // aggiorna context.get, catalog.brands, catalog.seasons (ContextSelector)
  };

  const createMutation = trpc.season.create.useMutation({
    onSuccess: () => {
      invalidate();
      setIsDialogOpen(false);
      setEditingSeason(null);
      toast.success('Stagione creata con successo');
    },
    onError: error => toast.error(getErrorMessage(error)),
  });

  const updateMutation = trpc.season.update.useMutation({
    onSuccess: () => {
      invalidate();
      setIsDialogOpen(false);
      setEditingSeason(null);
      toast.success('Stagione aggiornata con successo');
    },
    onError: error => toast.error(getErrorMessage(error)),
  });

  const removeMutation = trpc.season.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Stagione disattivata');
    },
    onError: error => toast.error(getErrorMessage(error)),
  });

  const restoreMutation = trpc.season.restore.useMutation({
    onSuccess: season => {
      invalidate();
      toast.success(`Stagione "${season.code}" riattivata`);
    },
    onError: error => toast.error(getTrpcErrorMessage(error)),
  });

  const unlinkMutation = trpc.season.unlink.useMutation({
    onSuccess: season => {
      invalidate();
      setUnlinkingSeason(null);
      toast.success(`Stagione "${season.code}" scollegata da NAV e disattivata`);
    },
    onError: error => toast.error(getTrpcErrorMessage(error)),
  });

  const hardDeleteMutation = trpc.season.hardDelete.useMutation({
    onSuccess: () => {
      invalidate();
      setHardDeletingSeason(null);
      toast.success('Stagione eliminata definitivamente');
    },
    onError: error => toast.error(getTrpcErrorMessage(error)),
  });

  const handleCreate = () => {
    setEditingSeason(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (season: SeasonItem) => {
    setEditingSeason(season);
    setIsDialogOpen(true);
  };

  const handleDelete = (season: SeasonItem) => {
    setDeletingSeason(season);
  };

  const handleFormSubmit = async (data: any) => {
    if (editingSeason) {
      await updateMutation.mutateAsync({ id: editingSeason.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Stagioni" description="Gestione delle stagioni" />

      <SectionCard title="Ricerca e Filtri" description="Cerca e filtra le stagioni del sistema">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label htmlFor="search">Cerca stagione</Label>
            <Input
              id="search"
              placeholder="Codice o nome stagione..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pb-0.5">
            <Checkbox
              id="includeInactive"
              checked={includeInactive}
              onCheckedChange={v => setIncludeInactive(!!v)}
            />
            <Label htmlFor="includeInactive" className="cursor-pointer">
              Mostra disattivate
            </Label>
          </div>
          <CreateActionButton
            label="Nuova Stagione"
            onClick={handleCreate}
            canCreate={can('seasons:create')}
            resourceName="stagione"
            isLoading={createMutation.isPending}
          />
        </div>
      </SectionCard>

      <SectionCard title="Stagioni" description="Lista completa delle stagioni configurate">
        <SeasonTable
          seasons={seasons}
          isLoading={isLoading}
          error={error}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onRestore={season => restoreMutation.mutate({ id: season.id })}
          onUnlink={setUnlinkingSeason}
          onHardDelete={setHardDeletingSeason}
          onRetry={() => refetch()}
        />
      </SectionCard>

      <ConfirmDialog
        open={!!deletingSeason}
        onOpenChange={open => { if (!open) setDeletingSeason(null); }}
        title="Disattiva stagione"
        description={`Sei sicuro di voler disattivare la stagione "${deletingSeason?.code}"? Potrà essere riattivata in seguito.`}
        confirmText="Disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deletingSeason) removeMutation.mutate({ id: deletingSeason.id }); }}
        isLoading={removeMutation.isPending}
      />

      <ConfirmDialog
        open={!!unlinkingSeason}
        onOpenChange={open => { if (!open) setUnlinkingSeason(null); }}
        title="Scollega da NAV"
        description={`Sei sicuro di voler scollegare "${unlinkingSeason?.code}" da NAV? La stagione verrà disattivata e il codice NAV "${unlinkingSeason?.navSeasonId}" tornerà disponibile per la sincronizzazione automatica.`}
        confirmText="Scollega e disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (unlinkingSeason) unlinkMutation.mutate({ id: unlinkingSeason.id }); }}
        isLoading={unlinkMutation.isPending}
      />

      <ConfirmDialog
        open={!!hardDeletingSeason}
        onOpenChange={open => { if (!open) setHardDeletingSeason(null); }}
        title="Elimina stagione definitivamente"
        description={`Sei sicuro di voler eliminare "${hardDeletingSeason?.code}"? Questa operazione è irreversibile.`}
        confirmText="Elimina definitivamente"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (hardDeletingSeason) hardDeleteMutation.mutate({ id: hardDeletingSeason.id }); }}
        isLoading={hardDeleteMutation.isPending}
      />

      <SeasonDialog
        open={isDialogOpen}
        onOpenChange={open => {
          setIsDialogOpen(open);
          if (!open) setEditingSeason(null);
        }}
        season={editingSeason}
        onSubmit={handleFormSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
