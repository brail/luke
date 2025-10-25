'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { trpc } from '../../../../lib/trpc';

import { BrandDialog } from './_components/BrandDialog';
import { BrandTable } from './_components/BrandTable';

/**
 * Pagina per gestione Brand
 * CRUD completo con upload logo e integrazione context
 */
export default function BrandsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<any>(null);
  const { brand: currentBrand } = useAppContext();

  // Query per ottenere la lista dei brand
  const {
    data: brands = [],
    isLoading,
    refetch,
  } = trpc.brand.list.useQuery({
    search: searchTerm || undefined,
  });

  // Utils per invalidazione context
  const utils = trpc.useUtils();

  // Mutation per creare/aggiornare brand
  const createMutation = trpc.brand.create.useMutation({
    onSuccess: () => {
      refetch();
      setIsDialogOpen(false);
      setEditingBrand(null);
      toast.success('Brand creato con successo');
      // Invalida context e catalog per aggiornare selettori
      utils.context.get.invalidate();
      utils.catalog.brands.invalidate();
    },
    onError: (error) => {
      toast.error(`Errore durante la creazione: ${error.message}`);
    },
  });

  const updateMutation = trpc.brand.update.useMutation({
    onSuccess: updatedBrand => {
      refetch();
      setIsDialogOpen(false);
      setEditingBrand(null);
      toast.success('Brand aggiornato con successo');

      // Invalida context e catalog
      utils.context.get.invalidate();
      utils.catalog.brands.invalidate();

      // Se il brand corrente è stato disattivato, gestisci il context
      if (currentBrand?.id === updatedBrand.id && !updatedBrand.isActive) {
        // Il context.get potrebbe fallire se non ci sono più brand attivi
        // AppContextProvider gestirà automaticamente needsSetup=true
        toast.success(
          'Brand disattivato. Il contesto verrà ripristinato automaticamente.'
        );
      }
    },
    onError: (error) => {
      toast.error(`Errore durante l'aggiornamento: ${error.message}`);
    },
  });

  const removeMutation = trpc.brand.remove.useMutation({
    onSuccess: (removedBrand) => {
      refetch();
      toast.success('Brand eliminato con successo');

      // Invalida context e catalog
      utils.context.get.invalidate();
      utils.catalog.brands.invalidate();

      // Se il brand corrente è stato eliminato, gestisci il context
      if (currentBrand?.id === removedBrand.id) {
        // Il context.get potrebbe fallire se non ci sono più brand attivi
        // AppContextProvider gestirà automaticamente needsSetup=true
        toast.success(
          'Brand eliminato. Il contesto verrà ripristinato automaticamente.'
        );
      }
    },
    onError: (error) => {
      toast.error(`Errore durante l'eliminazione: ${error.message}`);
    },
  });

  // Handler per apertura dialog creazione
  const handleCreateBrand = () => {
    setEditingBrand(null);
    setIsDialogOpen(true);
  };

  // Handler per apertura dialog modifica
  const handleEditBrand = (brand: any) => {
    setEditingBrand(brand);
    setIsDialogOpen(true);
  };

  // Handler per eliminazione brand
  const handleDeleteBrand = async (brand: any) => {
    if (
      globalThis.confirm(
        `Sei sicuro di voler eliminare il brand "${brand.name}"?`
      )
    ) {
      await removeMutation.mutateAsync({ id: brand.id });
    }
  };

  // Handler per chiusura dialog
  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setEditingBrand(null);
  };

  // Handler per submit form
  const handleFormSubmit = async (data: any) => {
    if (editingBrand) {
      await updateMutation.mutateAsync({
        id: editingBrand.id,
        data,
      });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Brand" description="Gestione dei marchi" />

      {/* Toolbar con ricerca e azioni */}
      <SectionCard
        title="Ricerca e Filtri"
        description="Cerca e filtra i brand del sistema"
      >
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="search">Cerca brand</Label>
            <Input
              id="search"
              placeholder="Nome o codice brand..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={handleCreateBrand}>Nuovo Brand</Button>
          </div>
        </div>
      </SectionCard>

      {/* Tabella Brand */}
      <SectionCard
        title="Brand Sistema"
        description="Lista completa dei brand configurati"
      >
        <BrandTable
          brands={brands}
          isLoading={isLoading}
          onEdit={handleEditBrand}
          onDelete={handleDeleteBrand}
        />
      </SectionCard>

      {/* Dialog per creazione/modifica */}
      <BrandDialog
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        brand={editingBrand}
        onSubmit={handleFormSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
