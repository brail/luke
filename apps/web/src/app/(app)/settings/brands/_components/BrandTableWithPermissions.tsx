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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip';
import { useBrandPermissions } from '../../../../../hooks/useBrandPermissions';

interface Brand {
  id: string;
  code: string;
  name: string;
  logoUrl: string | null;
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
  onRetry?: () => void;
}

/**
 * Tabella per visualizzazione e gestione Brand con permission-aware actions
 *
 * Features:
 * - Nasconde pulsanti di azione se l'utente non ha permessi
 * - Mostra tooltip sui pulsanti disabilitati
 * - Adatta il comportamento in base al ruolo (viewer, editor, admin)
 */
export function BrandTableWithPermissions({
  brands,
  isLoading,
  error,
  onEdit,
  onDelete,
  onRetry,
}: BrandTableWithPermissionsProps) {
  const brandPerms = useBrandPermissions();

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
          Nessun brand trovato.
          {brandPerms.canCreate && (
            <span> Crea il primo brand per iniziare.</span>
          )}
        </p>
      </div>
    );
  }

  const EditButton = ({ brand }: { brand: Brand }) => {
    if (!brandPerms.canUpdate) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="opacity-50 cursor-not-allowed"
              >
                Modifica
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Non hai i permessi per modificare i brand
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onEdit(brand)}
      >
        Modifica
      </Button>
    );
  };

  const DeleteButton = ({ brand }: { brand: Brand }) => {
    if (!brandPerms.canDelete) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="opacity-50 cursor-not-allowed text-destructive"
              >
                Elimina
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Non hai i permessi per eliminare i brand
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDelete(brand)}
        className="text-destructive hover:text-destructive"
      >
        Elimina
      </Button>
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
                {brandPerms.canList && (
                  <div className="flex items-center justify-end gap-2">
                    {/* Mostra i pulsanti solo se l'utente non è in modalità sola lettura */}
                    {!brandPerms.isReadOnly() && (
                      <>
                        <EditButton brand={brand} />
                        <DeleteButton brand={brand} />
                      </>
                    )}
                    {/* Se in modalità sola lettura, mostra un messaggio */}
                    {brandPerms.isReadOnly() && (
                      <span className="text-xs text-muted-foreground">
                        Accesso sola lettura
                      </span>
                    )}
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
