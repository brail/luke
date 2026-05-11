'use client';

import React from 'react';

import { BrandAvatar } from '../../../../../components/context/BrandAvatar';
import { PermissionButton } from '../../../../../components/PermissionButton';
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
import { usePermission } from '../../../../../hooks/usePermission';

export interface Brand {
  id: string;
  code: string;
  name: string;
  logoKey: string | null;
  logoUrl: string | null;
  navBrandId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BrandTableWithPermissionsProps {
  brands: Brand[];
  isLoading: boolean;
  error?: any;
  onEdit: (brand: Brand) => void;
  onDelete: (brand: Brand) => void;
  onRestore: (brand: Brand) => void;
  onUnlink: (brand: Brand) => void;
  onHardDelete: (brand: Brand) => void;
  onRetry?: () => void;
}

export function BrandTableWithPermissions({
  brands,
  isLoading,
  error,
  onEdit,
  onDelete,
  onRestore,
  onUnlink,
  onHardDelete,
  onRetry,
}: BrandTableWithPermissionsProps) {
  const { can } = usePermission();
  const canUpdate = can('brands:update');
  const canDelete = can('brands:delete');
  const canRead = can('brands:read');

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive mb-4">
          Errore caricamento brand: {error.message}
        </p>
        {onRetry && (
          <Button onClick={onRetry} variant="outline">
            Riprova
          </Button>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          Nessun brand trovato.
          {can('brands:create') && (
            <span> Crea il primo brand per iniziare.</span>
          )}
        </p>
      </div>
    );
  }

  const ActionButton = ({ brand }: { brand: Brand }) => {
    if (brand.isActive) {
      if (brand.navBrandId) {
        return (
          <PermissionButton
            hasPermission={canDelete}
            tooltip="Non hai i permessi per scollegare i brand"
            variant="outline"
            size="sm"
            onClick={() => onUnlink(brand)}
            className="text-destructive hover:text-destructive"
          >
            Scollega da NAV
          </PermissionButton>
        );
      }
      return (
        <>
          <PermissionButton
            hasPermission={canDelete}
            tooltip="Non hai i permessi per eliminare i brand"
            variant="outline"
            size="sm"
            onClick={() => onDelete(brand)}
            className="text-destructive hover:text-destructive"
          >
            Disattiva
          </PermissionButton>
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onHardDelete(brand)}
              className="text-destructive hover:text-destructive"
            >
              Elimina
            </Button>
          )}
        </>
      );
    }

    return (
      <>
        <PermissionButton
          hasPermission={canUpdate}
          tooltip="Non hai i permessi per modificare i brand"
          variant="outline"
          size="sm"
          onClick={() => onRestore(brand)}
        >
          Riattiva
        </PermissionButton>
        {!brand.navBrandId && canDelete && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onHardDelete(brand)}
            className="text-destructive hover:text-destructive"
          >
            Elimina
          </Button>
        )}
      </>
    );
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Logo</TableHead>
            <TableHead>Codice</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>NAV</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Aggiornato</TableHead>
            <TableHead className="text-right">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map(brand => (
            <TableRow key={brand.id} className={!brand.isActive ? 'opacity-50' : undefined}>
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
              <TableCell className="text-sm text-muted-foreground font-mono">
                {brand.navBrandId ?? <span className="text-muted-foreground/50">—</span>}
              </TableCell>
              <TableCell>
                <Badge variant={brand.isActive ? 'default' : 'secondary'}>
                  {brand.isActive ? 'Attivo' : 'Disattivo'}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(brand.updatedAt).toLocaleDateString('it-IT')}
              </TableCell>
              <TableCell className="text-right">
                {canRead && (
                  <div className="flex items-center justify-end gap-2">
                    {brand.isActive && (
                      <PermissionButton
                        hasPermission={canUpdate}
                        tooltip="Non hai i permessi per modificare i brand"
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(brand)}
                      >
                        Modifica
                      </PermissionButton>
                    )}
                    <ActionButton brand={brand} />
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
