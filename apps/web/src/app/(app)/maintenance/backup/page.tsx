'use client';

import { PackageOpen, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { buildBackupExportDownloadUrl, type BackupRecord } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { BackupCreateDialog, type BackupScopeChoice } from '../../../../components/maintenance/BackupCreateDialog';
import { BackupExportDialog } from '../../../../components/maintenance/BackupExportDialog';
import { BackupImportDialog } from '../../../../components/maintenance/BackupImportDialog';
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
  IMPORTED: 'Importato',
  PRE_MIGRATION_SAFETY: 'Snapshot pre-migrazione',
  MIGRATED: 'Migrato',
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

function formatDuration(startedAt: string, completedAt: string): string {
  const seconds = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

/** Recap toast shown once a backup transitions into COMPLETED — the detail isn't known until the job finishes. */
function showBackupRecap(backup: BackupRecord) {
  const parts = [
    SCOPE_LABEL[backup.scope],
    formatSize(backup.sizeBytesEncrypted),
    formatDuration(backup.startedAt, backup.completedAt ?? backup.startedAt),
  ];
  if (backup.scope === 'DB_AND_FILES' && backup.fileCount !== null) {
    parts.push(`${backup.fileCount} file`);
  }
  toast.success(backup.label ? `Backup completato — ${backup.label}` : 'Backup completato', {
    description: parts.join(' · '),
  });
}

export default function MaintenanceBackupPage() {
  const { can } = usePermission();
  const utils = trpc.useUtils();

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [exportTarget, setExportTarget] = useState<BackupRecord | null>(null);

  const { data, isLoading } = trpc.maintenance.backup.list.useQuery(undefined, {
    refetchInterval: query => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some(i => i.status === 'PENDING' || i.status === 'RUNNING');
      return hasActive ? 3000 : false;
    },
  });

  // Recap toast: fires once per backup the moment polling observes its PENDING/RUNNING → COMPLETED
  // transition. Detail (size, duration, file count) only exists once the job has actually finished.
  const previousStatusesRef = useRef<Map<string, BackupRecord['status']>>(new Map());
  useEffect(() => {
    const items = data?.items ?? [];
    for (const backup of items) {
      const previousStatus = previousStatusesRef.current.get(backup.id);
      if (previousStatus && previousStatus !== 'COMPLETED' && backup.status === 'COMPLETED') {
        showBackupRecap(backup);
      }
    }
    previousStatusesRef.current = new Map(items.map(i => [i.id, i.status]));
  }, [data]);

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

  // Invariante per la durata del processo (il file di migration è nell'immagine, lo schema
  // corrente cambia solo al boot) — nessun evento di sessione lo invalida davvero, niente
  // refetch oltre al primo per ogni backup.
  const { data: restoreCompat } = trpc.maintenance.backup.checkRestoreCompatibility.useQuery(
    { id: restoreTarget?.id ?? '' },
    { enabled: restoreTarget !== null, staleTime: Infinity }
  );

  const bridgeMutation = trpc.maintenance.backup.runMigrationBridge.useMutation({
    onSuccess: () => {
      toast.success('Migrazione avviata — segui il progresso nella tabella backup');
      setRestoreTarget(null);
      void utils.maintenance.backup.list.invalidate();
      // Il recap-toast già esistente (showBackupRecap sopra) copre da solo la transizione
      // PENDING/RUNNING→COMPLETED del nuovo backup "Migrato" — nessun codice aggiuntivo qui.
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const prepareExportMutation = trpc.maintenance.backup.prepareExport.useMutation({
    onSuccess: ({ token, filename }) => {
      if (!exportTarget) return;
      const url = buildBackupExportDownloadUrl(exportTarget.id, token);
      triggerUrlDownload(url, filename);
      setExportTarget(null);
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const items = data?.items ?? [];
  const canCreate = can('maintenance:backup_create');
  const canDelete = can('maintenance:backup_delete');
  const canRestore = can('maintenance:backup_restore');
  const canExport = can('maintenance:backup_export');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup & Disaster Recovery"
        description="Backup cifrati dell'intero database, opzionalmente con i file storage. Il ripristino sovrascrive il database attuale."
        actions={
          <div className="flex items-center gap-2">
            <PermissionButton
              hasPermission={canRestore}
              tooltip="Non hai i permessi per importare un backup"
              variant="outline"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Importa backup
            </PermissionButton>
            <CreateActionButton
              label="Crea backup"
              onClick={() => setCreateOpen(true)}
              canCreate={canCreate}
              resourceName="backup"
            />
          </div>
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
                  <TableCell>
                    {SCOPE_LABEL[backup.scope]}
                    {backup.scope === 'DB_AND_FILES' && backup.fileCount !== null && (
                      <span className="text-muted-foreground"> ({backup.fileCount} file)</span>
                    )}
                    {backup.label && <p className="text-xs text-muted-foreground">{backup.label}</p>}
                  </TableCell>
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
                      hasPermission={canExport && backup.status === 'COMPLETED'}
                      tooltip={
                        !canExport
                          ? 'Non hai i permessi per esportare un backup'
                          : 'Il backup non è ancora completato'
                      }
                      variant="ghost"
                      size="icon"
                      onClick={() => setExportTarget(backup)}
                    >
                      <PackageOpen className="h-4 w-4" />
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
        compat={restoreCompat}
        isLoading={restoreMutation.isPending}
        onConfirm={fields =>
          restoreTarget && restoreMutation.mutate({ id: restoreTarget.id, ...fields })
        }
        isBridging={bridgeMutation.isPending}
        onRunMigrationBridge={() =>
          restoreTarget && bridgeMutation.mutate({ id: restoreTarget.id, acknowledgeMigrationBridge: true })
        }
      />

      <BackupExportDialog
        open={exportTarget !== null}
        onOpenChange={open => !open && setExportTarget(null)}
        isLoading={prepareExportMutation.isPending}
        onConfirm={({ passphrase }) =>
          exportTarget && prepareExportMutation.mutate({ id: exportTarget.id, passphrase })
        }
      />

      <BackupImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void utils.maintenance.backup.list.invalidate()}
      />
    </div>
  );
}
