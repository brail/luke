'use client';

import React from 'react';

import { BrandAvatar } from '../../../../../components/context/BrandAvatar';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Skeleton } from '../../../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';

interface Brand {
  id: string;
  code: string;
  name: string;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BrandTableProps {
  brands: Brand[];
  isLoading: boolean;
  onEdit: (brand: Brand) => void;
  onDelete: (brand: Brand) => void;
}

/**
 * Tabella per visualizzazione e gestione Brand
 * Include logo, informazioni base e azioni
 */
export function BrandTable({
  brands,
  isLoading,
  onEdit,
  onDelete,
}: BrandTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center space-x-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[100px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          Nessun brand trovato. Crea il primo brand per iniziare.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Logo</TableHead>
            <TableHead>Codice</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Aggiornato</TableHead>
            <TableHead className="text-right">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map(brand => (
            <TableRow key={brand.id}>
              <TableCell>
                <BrandAvatar
                  brand={{
                    id: brand.id,
                    code: brand.code,
                    name: brand.name,
                    logoUrl: brand.logoUrl,
                    isActive: brand.isActive,
                  }}
                  size="sm"
                />
              </TableCell>
              <TableCell className="font-mono text-sm">{brand.code}</TableCell>
              <TableCell className="font-medium">{brand.name}</TableCell>
              <TableCell>
                <Badge variant={brand.isActive ? 'default' : 'secondary'}>
                  {brand.isActive ? 'Attivo' : 'Disattivo'}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(brand.updatedAt).toLocaleDateString('it-IT')}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(brand)}
                  >
                    Modifica
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDelete(brand)}
                    className="text-destructive hover:text-destructive"
                  >
                    Elimina
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
