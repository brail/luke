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

export interface VendorItem {
  id: string;
  name: string;
  countryCode: string | null;
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
  enabledParameterSets: { id: string }[];
}

interface VendorTableProps {
  vendors: VendorItem[];
  isLoading: boolean;
  error?: any;
  onEdit: (vendor: VendorItem) => void;
  onDelete: (vendor: VendorItem) => void;
  onRestore: (vendor: VendorItem) => void;
  onUnlink: (vendor: VendorItem) => void;
  onHardDelete: (vendor: VendorItem) => void;
  onRetry?: () => void;
}

export function VendorTable({
  vendors,
  isLoading,
  error,
  onEdit,
  onDelete,
  onRestore,
  onUnlink,
  onHardDelete,
  onRetry,
}: VendorTableProps) {
  const { can } = usePermission();
  const canUpdate = can('vendors:update');
  const canDelete = can('vendors:delete');
  const canRead = can('vendors:read');

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
          <Skeleton key={i} className="h-10 w-full" />
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

  const ActionButton = ({ vendor }: { vendor: VendorItem }) => {
    if (vendor.isActive) {
      if (vendor.navVendorId) {
        return (
          <PermissionButton
            hasPermission={canDelete}
            tooltip="Non hai i permessi per scollegare i fornitori"
            variant="outline"
            size="sm"
            onClick={() => onUnlink(vendor)}
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
            tooltip="Non hai i permessi per disattivare i fornitori"
            variant="outline"
            size="sm"
            onClick={() => onDelete(vendor)}
            className="text-destructive hover:text-destructive"
          >
            Disattiva
          </PermissionButton>
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onHardDelete(vendor)}
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
          tooltip="Non hai i permessi per riattivare i fornitori"
          variant="outline"
          size="sm"
          onClick={() => onRestore(vendor)}
        >
          Riattiva
        </PermissionButton>
        {!vendor.navVendorId && canDelete && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onHardDelete(vendor)}
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
            <TableHead>Nome</TableHead>
            <TableHead>Paese</TableHead>
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
              <TableCell className="text-sm text-muted-foreground">{vendor.countryCode ?? '—'}</TableCell>
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
                {canRead && (
                  <div className="flex items-center justify-end gap-2">
                    {vendor.isActive && (
                      <PermissionButton
                        hasPermission={canUpdate}
                        tooltip="Non hai i permessi per modificare i fornitori"
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(vendor)}
                      >
                        Modifica
                      </PermissionButton>
                    )}
                    <ActionButton vendor={vendor} />
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
