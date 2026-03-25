'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import type { VendorInput } from '@luke/core';

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

import { VendorDialog } from './_components/VendorDialog';
import { VendorTable, type VendorItem } from './_components/VendorTable';

export default function VendorsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorItem | null>(null);
  const [deletingVendor, setDeletingVendor] = useState<VendorItem | null>(null);
  const [unlinkingVendor, setUnlinkingVendor] = useState<VendorItem | null>(null);
  const [hardDeletingVendor, setHardDeletingVendor] = useState<VendorItem | null>(null);
  const { can } = usePermission();
  const invalidateContext = useInvalidateContext();

  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.vendors.list.useQuery(
    { search: searchTerm || undefined, isActive: includeInactive ? undefined : true },
    { staleTime: 30 * 1000 },
  );

  const vendors = (data?.items ?? []) as VendorItem[];

  const invalidate = () => { void utils.vendors.list.invalidate(); invalidateContext(); };

  const getError = (error: unknown) =>
    getTrpcErrorMessage(error, { CONFLICT: 'Codice NAV già collegato a un altro fornitore' });

  const createMutation = trpc.vendors.create.useMutation({
    onSuccess: () => { invalidate(); setIsDialogOpen(false); toast.success('Fornitore creato con successo'); },
    onError: error => toast.error(getError(error)),
  });

  const updateMutation = trpc.vendors.update.useMutation({
    onSuccess: () => { invalidate(); setIsDialogOpen(false); setEditingVendor(null); toast.success('Fornitore aggiornato con successo'); },
    onError: error => toast.error(getError(error)),
  });

  const removeMutation = trpc.vendors.remove.useMutation({
    onSuccess: () => { invalidate(); setDeletingVendor(null); toast.success('Fornitore disattivato'); },
    onError: error => toast.error(getError(error)),
  });

  const restoreMutation = trpc.vendors.restore.useMutation({
    onSuccess: () => { invalidate(); toast.success('Fornitore riattivato'); },
    onError: error => toast.error(getError(error)),
  });

  const unlinkMutation = trpc.vendors.unlink.useMutation({
    onSuccess: () => {
      invalidate();
      setUnlinkingVendor(null);
      toast.success('Fornitore scollegato da NAV e disattivato');
    },
    onError: error => toast.error(getError(error)),
  });

  const hardDeleteMutation = trpc.vendors.hardDelete.useMutation({
    onSuccess: () => {
      invalidate();
      setHardDeletingVendor(null);
      toast.success('Fornitore eliminato definitivamente');
    },
    onError: error => toast.error(getError(error)),
  });

  const handleFormSubmit = async (data: VendorInput) => {
    if (editingVendor) {
      await updateMutation.mutateAsync({ id: editingVendor.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Fornitori" description="Anagrafica interna dei fornitori" />

      <SectionCard title="Ricerca" description="Cerca per nome o nickname">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label htmlFor="search">Cerca fornitore</Label>
            <Input
              id="search"
              placeholder="Nome o nickname..."
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
            <Label htmlFor="includeInactive" className="cursor-pointer text-sm font-normal">
              Mostra disattivati
            </Label>
          </div>
          <CreateActionButton
            label="Nuovo Fornitore"
            onClick={() => { setEditingVendor(null); setIsDialogOpen(true); }}
            canCreate={can('vendors:create')}
            resourceName="fornitore"
            isLoading={createMutation.isPending}
          />
        </div>
      </SectionCard>

      <SectionCard title="Fornitori" description="Lista completa dei fornitori configurati">
        <VendorTable
          vendors={vendors}
          isLoading={isLoading}
          error={error}
          onEdit={vendor => { setEditingVendor(vendor); setIsDialogOpen(true); }}
          onDelete={setDeletingVendor}
          onRestore={vendor => restoreMutation.mutate({ id: vendor.id })}
          onUnlink={setUnlinkingVendor}
          onHardDelete={setHardDeletingVendor}
          onRetry={() => invalidate()}
        />
      </SectionCard>

      <ConfirmDialog
        open={!!deletingVendor}
        onOpenChange={open => { if (!open) setDeletingVendor(null); }}
        title="Disattiva fornitore"
        description={`Sei sicuro di voler disattivare "${deletingVendor?.name}"? Non apparirà più nelle liste di selezione. Potrai riattivarlo in seguito.`}
        confirmText="Disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deletingVendor) removeMutation.mutate({ id: deletingVendor.id }); }}
        isLoading={removeMutation.isPending}
      />

      <ConfirmDialog
        open={!!unlinkingVendor}
        onOpenChange={open => { if (!open) setUnlinkingVendor(null); }}
        title="Scollega da NAV"
        description={`Sei sicuro di voler scollegare "${unlinkingVendor?.name}" da NAV? Il fornitore verrà disattivato e il codice NAV "${unlinkingVendor?.navVendorId}" tornerà disponibile per la sincronizzazione automatica.`}
        confirmText="Scollega e disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (unlinkingVendor) unlinkMutation.mutate({ id: unlinkingVendor.id }); }}
        isLoading={unlinkMutation.isPending}
      />

      <ConfirmDialog
        open={!!hardDeletingVendor}
        onOpenChange={open => { if (!open) setHardDeletingVendor(null); }}
        title="Elimina fornitore definitivamente"
        description={`Sei sicuro di voler eliminare "${hardDeletingVendor?.name}"? Questa operazione è irreversibile.`}
        confirmText="Elimina definitivamente"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (hardDeletingVendor) hardDeleteMutation.mutate({ id: hardDeletingVendor.id }); }}
        isLoading={hardDeleteMutation.isPending}
      />

      <VendorDialog
        open={isDialogOpen}
        onOpenChange={open => { setIsDialogOpen(open); if (!open) setEditingVendor(null); }}
        vendor={editingVendor}
        onSubmit={handleFormSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
