'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { CreateActionButton } from '../../../../components/CreateActionButton';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { SeasonDialog } from './_components/SeasonDialog';
import { SeasonTable } from './_components/SeasonTable';

type SeasonItem = RouterOutputs['season']['list']['items'][number];

export default function SeasonsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<SeasonItem | null>(null);
  const { can } = usePermission();

  const {
    data: seasonsData = { items: [], nextCursor: null, hasMore: false },
    isLoading,
    error,
    refetch,
  } = trpc.season.list.useQuery({
    search: searchTerm || undefined,
  });

  const seasons = seasonsData.items;

  const getErrorMessage = (error: any) =>
    getTrpcErrorMessage(error, {
      CONFLICT: 'Stagione con questo codice e anno già esistente',
      NOT_FOUND: 'Stagione non trovata',
    });

  const utils = trpc.useUtils();

  const createMutation = trpc.season.create.useMutation({
    onSuccess: () => {
      utils.season.list.invalidate();
      utils.catalog.seasons.invalidate();
      setIsDialogOpen(false);
      setEditingSeason(null);
      toast.success('Stagione creata con successo');
    },
    onError: error => toast.error(getErrorMessage(error)),
  });

  const updateMutation = trpc.season.update.useMutation({
    onSuccess: () => {
      utils.season.list.invalidate();
      utils.catalog.seasons.invalidate();
      setIsDialogOpen(false);
      setEditingSeason(null);
      toast.success('Stagione aggiornata con successo');
    },
    onError: error => toast.error(getErrorMessage(error)),
  });

  const removeMutation = trpc.season.remove.useMutation({
    onSuccess: () => {
      utils.season.list.invalidate();
      utils.catalog.seasons.invalidate();
      toast.success('Stagione eliminata con successo');
    },
    onError: error => toast.error(getErrorMessage(error)),
  });

  const handleCreate = () => {
    setEditingSeason(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (season: SeasonItem) => {
    setEditingSeason(season);
    setIsDialogOpen(true);
  };

  const handleDelete = async (season: SeasonItem) => {
    if (
      globalThis.confirm(
        `Sei sicuro di voler eliminare la stagione "${season.code} ${season.year}"?`
      )
    ) {
      await removeMutation.mutateAsync({ id: season.id });
    }
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

      <SectionCard
        title="Ricerca e Filtri"
        description="Cerca e filtra le stagioni del sistema"
      >
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
          <CreateActionButton
            label="Nuova Stagione"
            onClick={handleCreate}
            canCreate={can('seasons:create')}
            resourceName="stagione"
            isLoading={createMutation.isPending}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Stagioni"
        description="Lista completa delle stagioni configurate"
      >
        <SeasonTable
          seasons={seasons}
          isLoading={isLoading}
          error={error}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onRetry={() => refetch()}
        />
      </SectionCard>

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
