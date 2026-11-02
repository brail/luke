'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';
import type { BrandInput } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { useInvalidateContext } from '../../../../contexts/useInvalidateContext';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { PurgeConfirmDialog } from '../_components/PurgeConfirmDialog';

import { BrandDialogWithPermissions } from './_components/BrandDialogWithPermissions';
import { BrandTableWithPermissions } from './_components/BrandTableWithPermissions';

type BrandItem = RouterOutputs['brand']['list']['items'][number];

export default function BrandsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<BrandItem | null>(null);
  const [deletingBrand, setDeletingBrand] = useState<BrandItem | null>(null);
  const [unlinkingBrand, setUnlinkingBrand] = useState<BrandItem | null>(null);
  const [hardDeletingBrand, setHardDeletingBrand] = useState<BrandItem | null>(null);
  const [purgingBrand, setPurgingBrand] = useState<BrandItem | null>(null);
  const { brand: currentBrand } = useAppContext();
  const { can } = usePermission();

  const {
    data: brandsData = { items: [], nextCursor: null, hasMore: false },
    isLoading,
    error,
    refetch,
  } = trpc.brand.list.useQuery({
    search: searchTerm || undefined,
    isActive: includeInactive ? undefined : true,
  });

  const brands = brandsData.items;

  const invalidateContext = useInvalidateContext();

  const getErrorMessage = (error: unknown) =>
    getTrpcErrorMessage(error, { CONFLICT: 'Nome o codice brand già in uso' });

  const createMutation = trpc.brand.create.useMutation({
    onSuccess: () => {
      invalidateContext();
      setIsDialogOpen(false);
      setEditingBrand(null);
      toast.success('Brand creato con successo');
    },
    onError: error => {
      toast.error(getErrorMessage(error));
    },
  });

  const updateMutation = trpc.brand.update.useMutation({
    onSuccess: updatedBrand => {
      invalidateContext();
      setIsDialogOpen(false);
      setEditingBrand(null);
      toast.success('Brand aggiornato con successo');

      if (currentBrand?.id === updatedBrand.id && !updatedBrand.isActive) {
        toast.info('Brand disattivato. Il contesto verrà ripristinato automaticamente.');
      }
    },
    onError: error => {
      toast.error(getErrorMessage(error));
    },
  });

  const removeMutation = trpc.brand.remove.useMutation({
    onSuccess: removedBrand => {
      invalidateContext();
      toast.success('Brand disattivato');

      if (currentBrand?.id === removedBrand.id) {
        toast.info('Brand disattivato. Il contesto verrà ripristinato automaticamente.');
      }
    },
    onError: error => {
      toast.error(getErrorMessage(error));
    },
  });

  const restoreMutation = trpc.brand.restore.useMutation({
    onSuccess: restoredBrand => {
      invalidateContext();
      toast.success(`Brand "${restoredBrand.name}" riattivato`);
    },
    onError: error => {
      toast.error(getTrpcErrorMessage(error));
    },
  });

  const unlinkMutation = trpc.brand.unlink.useMutation({
    onSuccess: unlinkedBrand => {
      invalidateContext();
      setUnlinkingBrand(null);
      toast.success(`Brand "${unlinkedBrand.name}" scollegato da NAV e disattivato`);
    },
    onError: error => {
      toast.error(getTrpcErrorMessage(error));
    },
  });

  const purgePreview = trpc.brand.purgePreview.useQuery(
    { id: purgingBrand?.id ?? '' },
    // A refusal (reactivated, linked to NAV meanwhile) is an answer, not a fault to retry.
    { enabled: !!purgingBrand, retry: false }
  );
  const utils = trpc.useUtils();
  const purgeMutation = trpc.brand.purge.useMutation({
    onSuccess: () => {
      // Closed first, so the preview of what no longer exists is not fetched again.
      setPurgingBrand(null);
      // It deletes layouts, calendars, plans and sets under it too: every cached list may hold them.
      void utils.invalidate();
      toast.success('Brand eliminato con i suoi dati');
    },
    onError: error => {
      toast.error(getTrpcErrorMessage(error));
    },
  });

  const hardDeleteMutation = trpc.brand.hardDelete.useMutation({
    onSuccess: () => {
      invalidateContext();
      setHardDeletingBrand(null);
      toast.success('Brand eliminato definitivamente');
    },
    onError: error => {
      toast.error(getTrpcErrorMessage(error));
    },
  });

  const handleCreateBrand = () => {
    setEditingBrand(null);
    setIsDialogOpen(true);
  };

  const handleEditBrand = (brand: BrandItem) => {
    setEditingBrand(brand);
    setIsDialogOpen(true);
  };

  const handleDeleteBrand = (brand: BrandItem) => {
    setDeletingBrand(brand);
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setEditingBrand(null);
  };

  const handleFormSubmit = async (data: BrandInput) => {
    if (editingBrand) {
      await updateMutation.mutateAsync({ id: editingBrand.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Brand" description="Gestione dei marchi" />

      <SectionCard title="Ricerca e Filtri" description="Cerca e filtra i brand del sistema">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label htmlFor="search">Cerca brand</Label>
            <Input
              id="search"
              placeholder="Nome o codice brand..."
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
              Mostra disattivati
            </Label>
          </div>
          <CreateActionButton
            label="Nuovo Brand"
            onClick={handleCreateBrand}
            canCreate={can('brands:create')}
            resourceName="brand"
            isLoading={createMutation.isPending}
          />
        </div>
      </SectionCard>

      <SectionCard title="Brand Sistema" description="Lista completa dei brand configurati">
        <BrandTableWithPermissions
          brands={brands}
          isLoading={isLoading}
          error={error}
          onEdit={handleEditBrand}
          onDelete={handleDeleteBrand}
          onRestore={brand => restoreMutation.mutate({ id: brand.id })}
          onUnlink={setUnlinkingBrand}
          onHardDelete={setHardDeletingBrand}
          onPurge={setPurgingBrand}
          onRetry={() => refetch()}
        />
      </SectionCard>

      <ConfirmDialog
        open={!!deletingBrand}
        onOpenChange={open => { if (!open) setDeletingBrand(null); }}
        title="Disattiva brand"
        description={`Sei sicuro di voler disattivare il brand "${deletingBrand?.name}"? Potrà essere riattivato in seguito.`}
        confirmText="Disattiva"
        cancelText="Annulla"
        actionType="disable"
        onConfirm={() => { if (deletingBrand) removeMutation.mutate({ id: deletingBrand.id }); }}
        isLoading={removeMutation.isPending}
      />

      <ConfirmDialog
        open={!!unlinkingBrand}
        onOpenChange={open => { if (!open) setUnlinkingBrand(null); }}
        title="Scollega da NAV"
        description={`Sei sicuro di voler scollegare "${unlinkingBrand?.name}" da NAV? Il brand verrà disattivato e il codice NAV "${unlinkingBrand?.navBrandId}" tornerà disponibile per la sincronizzazione automatica.`}
        confirmText="Scollega e disattiva"
        cancelText="Annulla"
        actionType="delete"
        onConfirm={() => { if (unlinkingBrand) unlinkMutation.mutate({ id: unlinkingBrand.id }); }}
        isLoading={unlinkMutation.isPending}
      />

      <ConfirmDialog
        open={!!hardDeletingBrand}
        onOpenChange={open => { if (!open) setHardDeletingBrand(null); }}
        title="Elimina brand definitivamente"
        description={`Sei sicuro di voler eliminare "${hardDeletingBrand?.name}"? Questa operazione è irreversibile.`}
        confirmText="Elimina definitivamente"
        cancelText="Annulla"
        actionType="hardDelete"
        confirmPhrase={HARD_DELETE_CONFIRM_PHRASE}
        onConfirm={phrase => {
          if (hardDeletingBrand && phrase) hardDeleteMutation.mutate({ id: hardDeletingBrand.id, confirmPhrase: phrase });
        }}
        isLoading={hardDeleteMutation.isPending}
      />

      <PurgeConfirmDialog
        open={!!purgingBrand}
        onOpenChange={open => { if (!open) setPurgingBrand(null); }}
        kind="brand"
        name={purgingBrand?.name ?? ''}
        preview={purgePreview.data}
        previewError={purgePreview.error}
        onConfirm={confirmName => {
          if (purgingBrand) purgeMutation.mutate({ id: purgingBrand.id, confirmName });
        }}
        isLoading={purgeMutation.isPending}
      />

      <BrandDialogWithPermissions
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        brand={editingBrand}
        onSubmit={handleFormSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
