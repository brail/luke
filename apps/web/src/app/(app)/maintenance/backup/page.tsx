'use client';

import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { BACKUP_RESTORE_CONFIRM_PHRASE, buildApiUrl, type BackupRecord } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { BackupCreateDialog, type BackupScopeChoice } from '../../../../components/maintenance/BackupCreateDialog';
import { BackupScheduleCard } from '../../../../components/maintenance/BackupScheduleCard';
import { RestoreConfirmDialog } from '../../../../components/maintenance/RestoreConfirmDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { PermissionButton } from '../../../../components/PermissionButton';
import { SectionCard } from '../../../../components/SectionCard';
import { Badge } from '../../../../components/ui/badge';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { usePermission } from '../../../../hooks/usePermission';
import { triggerUrlDownload } from '../../../../lib/download';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

const SCOPE_LABEL: Record<BackupRecord['scope'], string> = {
  DB: 'Solo DB',
  DB_AND_FILES: 'DB + file',
};

const TRIGGER_LABEL: Record<BackupRecord['trigger'], string> = {
  MANUAL: 'Manuale',
  SCHEDULED: 'Programmato',
  PRE_RESTORE_SAFETY: 'Snapshot di sicurezza',
};

function StatusBadge({ status }: { status: BackupRecord['status'] }) {
  switch (status) {
    case 'COMPLETED':
      return <Badge variant="secondary">Completato</Badge>;
    case 'RUNNING':
      return <Badge>In corso…</Badge>;
    case 'PENDING':
      return <Badge variant="outline">In coda</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">Fallito</Badge>;
  }
}

function formatSize(bytes: string | null): string {
  if (!bytes) return '—';
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default function MaintenanceBackupPage() {
  const { can } = usePermission();
  const utils = trpc.useUtils();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);

  const { data, isLoading } = trpc.maintenance.backup.list.useQuery(undefined, {
    refetchInterval: query => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some(i => i.status === 'PENDING' || i.status === 'RUNNING');
      return hasActive ? 3000 : false;
    },
  });

  const createMutation = trpc.maintenance.backup.create.useMutation({
    onSuccess: () => {
      toast.success('Backup avviato');
      setCreateOpen(false);
      void utils.maintenance.backup.list.invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteMutation = trpc.maintenance.backup.delete.useMutation({
    onSuccess: () => {
      toast.success('Backup eliminato');
      void utils.maintenance.backup.list.invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const restoreMutation = trpc.maintenance.backup.restore.useMutation({
    onSuccess: () => {
      toast.success('Ripristino completato');
      setRestoreTarget(null);
      void utils.maintenance.backup.list.invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const getDownloadLinkMutation = trpc.maintenance.backup.getDownloadLink.useMutation();

  const handleDownload = async (backup: BackupRecord) => {
    try {
      const { token, filename } = await getDownloadLinkMutation.mutateAsync({ id: backup.id });
      const url = buildApiUrl(`/maintenance/backup/${backup.id}/download?token=${encodeURIComponent(token)}`);
      triggerUrlDownload(url, filename || `${backup.id}.enc`);
    } catch {
      toast.error('Download del backup fallito');
    }
  };

  const items = data?.items ?? [];
  const canCreate = can('maintenance:backup_create');
  const canDelete = can('maintenance:backup_delete');
  const canRestore = can('maintenance:backup_restore');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup & Disaster Recovery"
        description="Backup cifrati dell'intero database, opzionalmente con i file storage. Il ripristino sovrascrive il database attuale."
        actions={
          <CreateActionButton
            label="Crea backup"
            onClick={() => setCreateOpen(true)}
            canCreate={canCreate}
            resourceName="backup"
          />
        }
      />

      <SectionCard title="Backup disponibili" description="Ordinati dal più recente">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun backup ancora creato.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Contenuto</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Dimensione</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(backup => (
                <TableRow key={backup.id}>
                  <TableCell>
                    {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(
                      new Date(backup.createdAt)
                    )}
                  </TableCell>
                  <TableCell>{SCOPE_LABEL[backup.scope]}</TableCell>
                  <TableCell>{TRIGGER_LABEL[backup.trigger]}</TableCell>
                  <TableCell>
                    <StatusBadge status={backup.status} />
                    {backup.status === 'FAILED' && backup.errorMessage && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1 cursor-help text-xs text-muted-foreground underline decoration-dotted">
                              dettagli
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">{backup.errorMessage}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
                  <TableCell>{formatSize(backup.sizeBytesEncrypted)}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <PermissionButton
                      hasPermission={backup.status === 'COMPLETED'}
                      tooltip="Il backup non è ancora completato"
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleDownload(backup)}
                    >
                      <Download className="h-4 w-4" />
                    </PermissionButton>
                    <PermissionButton
                      hasPermission={canRestore && backup.status === 'COMPLETED'}
                      tooltip={
                        !canRestore
                          ? 'Non hai i permessi per ripristinare un backup'
                          : 'Il backup non è ancora completato'
                      }
                      variant="ghost"
                      size="icon"
                      onClick={() => setRestoreTarget(backup)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </PermissionButton>
                    <PermissionButton
                      hasPermission={canDelete}
                      tooltip="Non hai i permessi per eliminare un backup"
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(backup)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </PermissionButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <BackupScheduleCard />

      <BackupCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        isLoading={createMutation.isPending}
        onConfirm={({ scope, label }: { scope: BackupScopeChoice; label?: string }) =>
          createMutation.mutate({ scope, label })
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title="Elimina backup"
        description="Il file cifrato verrà rimosso definitivamente dallo storage. Questa azione non è reversibile."
        actionType="delete"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
      />

      <RestoreConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={open => !open && setRestoreTarget(null)}
        backup={restoreTarget}
        isLoading={restoreMutation.isPending}
        onConfirm={({ preserveAuditLog, restoreFiles }: { preserveAuditLog: boolean; restoreFiles: boolean }) =>
          restoreTarget &&
          restoreMutation.mutate({
            id: restoreTarget.id,
            preserveAuditLog,
            restoreFiles,
            confirmPhrase: BACKUP_RESTORE_CONFIRM_PHRASE,
          })
        }
      />
    </div>
  );
}
