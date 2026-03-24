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

export interface VendorItem {
  id: string;
  name: string;
  nickname: string | null;
  referente: string | null;
  email: string | null;
  phone: string | null;
  chat: string | null;
  notes: string | null;
  navVendorId: string | null;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface VendorTableProps {
  vendors: VendorItem[];
  isLoading: boolean;
  error?: any;
  onEdit: (vendor: VendorItem) => void;
  onDelete: (vendor: VendorItem) => void;
  onRestore: (vendor: VendorItem) => void;
  onRetry?: () => void;
}

export function VendorTable({
  vendors,
  isLoading,
  error,
  onEdit,
  onDelete,
  onRestore,
  onRetry,
}: VendorTableProps) {
  const { can } = usePermission();
  const canUpdate = can('vendors:update');
  const canDelete = can('vendors:delete');

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive mb-4">Errore caricamento fornitori: {error.message}</p>
        {onRetry && <Button onClick={onRetry} variant="outline">Riprova</Button>}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (vendors.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          Nessun fornitore trovato.
          {can('vendors:create') && <span> Crea il primo fornitore per iniziare.</span>}
        </p>
      </div>
    );
  }

  const EditButton = ({ vendor }: { vendor: VendorItem }) => {
    if (!canUpdate) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" disabled className="opacity-50 cursor-not-allowed">Modifica</Button>
            </TooltipTrigger>
            <TooltipContent>Non hai i permessi per modificare i fornitori</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return <Button variant="outline" size="sm" onClick={() => onEdit(vendor)}>Modifica</Button>;
  };

  const ActionButton = ({ vendor }: { vendor: VendorItem }) => {
    if (vendor.isActive) {
      if (!canDelete) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" disabled className="opacity-50 cursor-not-allowed text-destructive">Disattiva</Button>
              </TooltipTrigger>
              <TooltipContent>Non hai i permessi per disattivare i fornitori</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }
      return (
        <Button variant="outline" size="sm" onClick={() => onDelete(vendor)} className="text-destructive hover:text-destructive">
          Disattiva
        </Button>
      );
    }

    // vendor inattivo → mostra Riattiva
    if (!canUpdate) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" disabled className="opacity-50 cursor-not-allowed">Riattiva</Button>
            </TooltipTrigger>
            <TooltipContent>Non hai i permessi per riattivare i fornitori</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return <Button variant="outline" size="sm" onClick={() => onRestore(vendor)}>Riattiva</Button>;
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Nickname</TableHead>
            <TableHead>Referente</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Telefono</TableHead>
            <TableHead>NAV</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead className="text-right">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vendors.map(vendor => (
            <TableRow key={vendor.id} className={!vendor.isActive ? 'opacity-50' : undefined}>
              <TableCell className="font-medium">{vendor.name}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{vendor.nickname ?? '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{vendor.referente ?? '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{vendor.email ?? '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{vendor.phone ?? '—'}</TableCell>
              <TableCell className="text-sm font-mono text-muted-foreground">{vendor.navVendorId ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={vendor.isActive ? 'default' : 'secondary'}>
                  {vendor.isActive ? 'Attivo' : 'Disattivato'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {vendor.isActive && <EditButton vendor={vendor} />}
                  <ActionButton vendor={vendor} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
