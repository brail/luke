'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import type { VendorInput } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { VendorDialog } from './_components/VendorDialog';
import { VendorTable, type VendorItem } from './_components/VendorTable';

export default function VendorsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorItem | null>(null);
  const [deletingVendor, setDeletingVendor] = useState<VendorItem | null>(null);
  const { can } = usePermission();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = trpc.vendors.list.useQuery(
    { search: searchTerm || undefined },
    { staleTime: 30 * 1000 },
  );

  const vendors = (data?.items ?? []) as VendorItem[];

  const getError = (error: unknown) =>
    getTrpcErrorMessage(error, { CONFLICT: 'Codice NAV già collegato a un altro fornitore' });

  const createMutation = trpc.vendors.create.useMutation({
    onSuccess: () => {
      void refetch();
      setIsDialogOpen(false);
      toast.success('Fornitore creato con successo');
    },
    onError: error => toast.error(getError(error)),
  });

  const updateMutation = trpc.vendors.update.useMutation({
    onSuccess: () => {
      void refetch();
      setIsDialogOpen(false);
      setEditingVendor(null);
      toast.success('Fornitore aggiornato con successo');
    },
    onError: error => toast.error(getError(error)),
  });

  const removeMutation = trpc.vendors.remove.useMutation({
    onSuccess: () => {
      void refetch();
      setDeletingVendor(null);
      toast.success('Fornitore eliminato');
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
          onRetry={() => void refetch()}
        />
      </SectionCard>

      <ConfirmDialog
        open={!!deletingVendor}
        onOpenChange={open => { if (!open) setDeletingVendor(null); }}
        title="Elimina fornitore"
        description={`Sei sicuro di voler eliminare il fornitore "${deletingVendor?.name}"? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deletingVendor) removeMutation.mutate({ id: deletingVendor.id }); }}
        isLoading={removeMutation.isPending}
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
