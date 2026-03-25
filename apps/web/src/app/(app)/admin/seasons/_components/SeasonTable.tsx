'use client';

import React from 'react';

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

import type { SeasonItem } from './SeasonDialog';

interface SeasonTableProps {
  seasons: SeasonItem[];
  isLoading: boolean;
  error?: any;
  onEdit: (season: SeasonItem) => void;
  onDelete: (season: SeasonItem) => void;
  onRestore: (season: SeasonItem) => void;
  onUnlink: (season: SeasonItem) => void;
  onHardDelete: (season: SeasonItem) => void;
  onRetry?: () => void;
}

export function SeasonTable({
  seasons,
  isLoading,
  error,
  onEdit,
  onDelete,
  onRestore,
  onUnlink,
  onHardDelete,
  onRetry,
}: SeasonTableProps) {
  const { can } = usePermission();
  const canUpdate = can('seasons:update');
  const canDelete = can('seasons:delete');
  const canRead = can('seasons:read');

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive mb-4">
          Errore caricamento stagioni: {error.message}
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

  if (seasons.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          Nessuna stagione trovata.
          {can('seasons:create') && (
            <span> Crea la prima stagione per iniziare.</span>
          )}
        </p>
      </div>
    );
  }

  const ActionButton = ({ season }: { season: SeasonItem }) => {
    if (season.isActive) {
      if (season.navSeasonId) {
        return (
          <PermissionButton
            hasPermission={canDelete}
            tooltip="Non hai i permessi per scollegare le stagioni"
            variant="outline"
            size="sm"
            onClick={() => onUnlink(season)}
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
            tooltip="Non hai i permessi per eliminare le stagioni"
            variant="outline"
            size="sm"
            onClick={() => onDelete(season)}
            className="text-destructive hover:text-destructive"
          >
            Disattiva
          </PermissionButton>
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onHardDelete(season)}
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
          tooltip="Non hai i permessi per modificare le stagioni"
          variant="outline"
          size="sm"
          onClick={() => onRestore(season)}
        >
          Riattiva
        </PermissionButton>
        {!season.navSeasonId && canDelete && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onHardDelete(season)}
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
            <TableHead>Codice</TableHead>
            <TableHead>Anno</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>NAV</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Aggiornato</TableHead>
            <TableHead className="text-right">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {seasons.map(season => (
            <TableRow key={season.id} className={!season.isActive ? 'opacity-50' : undefined}>
              <TableCell className="font-mono text-sm">{season.code}</TableCell>
              <TableCell className="font-mono text-sm">
                {season.year ?? <span className="text-muted-foreground/50">—</span>}
              </TableCell>
              <TableCell className="font-medium">{season.name}</TableCell>
              <TableCell className="text-sm text-muted-foreground font-mono">
                {season.navSeasonId ?? <span className="text-muted-foreground/50">—</span>}
              </TableCell>
              <TableCell>
                <Badge variant={season.isActive ? 'default' : 'secondary'}>
                  {season.isActive ? 'Attiva' : 'Disattiva'}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(season.updatedAt).toLocaleDateString('it-IT')}
              </TableCell>
              <TableCell className="text-right">
                {canRead && (
                  <div className="flex items-center justify-end gap-2">
                    {season.isActive && (
                      <PermissionButton
                        hasPermission={canUpdate}
                        tooltip="Non hai i permessi per modificare le stagioni"
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(season)}
                      >
                        Modifica
                      </PermissionButton>
                    )}
                    <ActionButton season={season} />
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
