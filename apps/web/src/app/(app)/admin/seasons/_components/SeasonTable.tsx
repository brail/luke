'use client';

import React from 'react';

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
import { usePermission } from '../../../../../hooks/usePermission';

interface Season {
  id: string;
  code: string;
  year: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SeasonTableProps {
  seasons: Season[];
  isLoading: boolean;
  error?: any;
  onEdit: (season: Season) => void;
  onDelete: (season: Season) => void;
  onRetry?: () => void;
}

export function SeasonTable({
  seasons,
  isLoading,
  error,
  onEdit,
  onDelete,
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
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center space-x-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[100px]" />
            </div>
          </div>
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

  const EditButton = ({ season }: { season: Season }) => {
    if (!canUpdate) {
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
              Non hai i permessi per modificare le stagioni
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return (
      <Button variant="outline" size="sm" onClick={() => onEdit(season)}>
        Modifica
      </Button>
    );
  };

  const DeleteButton = ({ season }: { season: Season }) => {
    if (!canDelete) {
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
              Non hai i permessi per eliminare le stagioni
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDelete(season)}
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
            <TableHead>Codice</TableHead>
            <TableHead>Anno</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Aggiornato</TableHead>
            <TableHead className="text-right">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {seasons.map(season => (
            <TableRow key={season.id}>
              <TableCell className="font-mono text-sm">{season.code}</TableCell>
              <TableCell className="font-mono text-sm">{season.year}</TableCell>
              <TableCell className="font-medium">{season.name}</TableCell>
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
                    <EditButton season={season} />
                    <DeleteButton season={season} />
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
