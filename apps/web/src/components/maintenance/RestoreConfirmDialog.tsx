'use client';

import { AlertTriangle, Ban } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { BACKUP_RESTORE_CONFIRM_PHRASE, type BackupRecord, type CheckRestoreCompatibilityOutput } from '@luke/core';

import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { Switch } from '../ui/switch';

interface RestoreConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backup: BackupRecord | null;
  /** Fetched by the parent page (`checkRestoreCompatibility`) — same data-ownership convention as every other mutation on this page. */
  compat: CheckRestoreCompatibilityOutput | undefined;
  onConfirm: (params: { preserveAuditLog: boolean; restoreFiles: boolean }) => void;
  isLoading?: boolean;
  /** Requests the migration bridge (only reachable when `compat.classification === 'OLDER'`). */
  onRunMigrationBridge: () => void;
  isBridging?: boolean;
}

function DialogIconTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <DialogTitle className="text-left">{children}</DialogTitle>
    </div>
  );
}

/**
 * Restore confirmation — branches into 3 bodies depending on how the backup's schema compares to
 * this instance's current one (`compat.classification`, fetched by the parent page):
 * - SAME: full restore UI (typed confirm phrase, audit/file switches).
 * - OLDER: the migration bridge sub-flow — a dedicated checkbox + "Applica migrazioni" button
 *   that produces a new "Migrato" backup (visible in the table), itself later classified SAME.
 * - NEWER_OR_UNKNOWN: hard block, no way to proceed — migrations have no maintained rollback path.
 */
export function RestoreConfirmDialog({
  open,
  onOpenChange,
  backup,
  compat,
  onConfirm,
  isLoading = false,
  onRunMigrationBridge,
  isBridging = false,
}: RestoreConfirmDialogProps) {
  const [preserveAuditLog, setPreserveAuditLog] = useState(true);
  const [restoreFiles, setRestoreFiles] = useState(backup?.scope === 'DB_AND_FILES');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [acknowledgeMigrationBridge, setAcknowledgeMigrationBridge] = useState(false);

  // Reset per-target state when a different backup is targeted — this dialog may stay mounted
  // across restore targets rather than remounting, so state must not leak between them.
  useEffect(() => {
    setPreserveAuditLog(true);
    setRestoreFiles(backup?.scope === 'DB_AND_FILES');
    setTypedPhrase('');
    setAcknowledgeMigrationBridge(false);
  }, [backup?.id, backup?.scope]);

  if (!backup) return null;

  const canConfirmRestore = typedPhrase === BACKUP_RESTORE_CONFIRM_PHRASE && !isLoading;
  const handleConfirmRestore = () => {
    if (!canConfirmRestore) return;
    onConfirm({ preserveAuditLog, restoreFiles });
  };

  const canRunBridge = acknowledgeMigrationBridge && !isBridging;
  const handleRunBridge = () => {
    if (!canRunBridge) return;
    onRunMigrationBridge();
  };

  let body: ReactNode;

  if (!compat) {
    body = (
      <>
        <DialogHeader>
          <DialogTitle>Ripristina database da backup</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </>
    );
  } else if (compat.classification === 'NEWER_OR_UNKNOWN') {
    body = (
      <>
        <DialogHeader>
          <DialogIconTitle icon={<Ban className="h-6 w-6 text-destructive shrink-0" />}>
            Impossibile ripristinare: schema più recente
          </DialogIconTitle>
          <DialogDescription className="text-left space-y-3 pt-2">
            <p>
              Questo backup proviene da uno schema database più recente (o comunque non
              riconosciuto da questa istanza:{' '}
              <span className="font-mono">{backup.schemaMigrationName ?? '—'}</span>), rispetto a
              quello in esecuzione (
              <span className="font-mono">{compat.currentSchemaMigrationName ?? '—'}</span>).
            </p>
            <p>
              Non è possibile applicare le migrazioni all&apos;indietro senza perdita di dati:
              questo progetto non mantiene un percorso di rollback, e diverse migrazioni rimuovono
              colonne o tabelle in modo irreversibile.
            </p>
            <p className="font-medium text-foreground">
              Aggiorna questa istanza a una versione ≥ di quella del backup, poi riprova il
              ripristino.
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </>
    );
  } else if (compat.classification === 'OLDER') {
    body = (
      <>
        <DialogHeader>
          <DialogIconTitle icon={<AlertTriangle className="h-6 w-6 text-destructive shrink-0" />}>
            Schema del backup non aggiornato
          </DialogIconTitle>
          <DialogDescription className="text-left space-y-3 pt-2">
            <p>
              Questo backup usa uno schema più vecchio (
              <span className="font-mono">{backup.schemaMigrationName}</span>) di quello corrente
              (<span className="font-mono">{compat.currentSchemaMigrationName}</span>). Cliccando{' '}
              <strong className="text-foreground">Applica migrazioni</strong> verrà eseguito, in
              ordine:
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Creazione di un database temporaneo isolato</li>
              <li>
                Ripristino del backup in quel database — <strong>nessun impatto su produzione</strong>
              </li>
              <li>Salvataggio di uno snapshot di sicurezza pre-migrazione</li>
              <li>Applicazione delle {compat.pendingMigrations.length} migrazioni mancanti (elenco sotto)</li>
              <li>Salvataggio del risultato come nuovo backup &quot;Migrato&quot;, pronto per il ripristino</li>
              <li>Rimozione del database temporaneo</li>
            </ol>
            <p>
              L&apos;operazione gira in background: puoi chiudere questa finestra, il progresso è
              visibile nella tabella backup.
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border p-2 font-mono text-xs text-muted-foreground">
            {compat.pendingMigrations.map(name => (
              <div key={name}>{name}</div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="acknowledge-migration-bridge"
              checked={acknowledgeMigrationBridge}
              onCheckedChange={checked => setAcknowledgeMigrationBridge(checked === true)}
            />
            <Label htmlFor="acknowledge-migration-bridge" className="text-sm font-normal">
              Ho capito i rischi di applicare {compat.pendingMigrations.length} migrazioni a dati
              non recenti e voglio procedere
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBridging}>
            Annulla
          </Button>
          <Button variant="destructive" onClick={handleRunBridge} disabled={!canRunBridge}>
            {isBridging ? 'Avvio…' : 'Applica migrazioni'}
          </Button>
        </DialogFooter>
      </>
    );
  } else {
    // classification === 'SAME'
    body = (
      <>
        <DialogHeader>
          <DialogIconTitle icon={<AlertTriangle className="h-6 w-6 text-destructive shrink-0" />}>
            Ripristina database da backup
          </DialogIconTitle>
          <DialogDescription className="text-left space-y-3 pt-2">
            <p className="font-medium text-foreground">
              Questa operazione SOVRASCRIVE completamente il database attuale con il contenuto
              del backup del{' '}
              {new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short' }).format(
                new Date(backup.createdAt)
              )}
              . Tutti i dati creati o modificati dopo quel momento andranno persi.
            </p>
            <p>
              Prima di procedere viene creato automaticamente uno snapshot di sicurezza del
              database attuale — se il restore fosse un errore, potrai ripristinare quello
              snapshot. L&apos;operazione è comunque da considerarsi irreversibile: l&apos;app
              entra in modalità manutenzione (bloccando tutti gli utenti non-admin) per la
              durata del ripristino.
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="preserve-audit-log">Preserva il registro attività corrente</Label>
              <p className="text-sm text-muted-foreground">
                Se attivo (consigliato), l&apos;audit log attuale resta intatto e l&apos;evento di
                restore vi viene comunque registrato. Se disattivi, anche il registro attività
                torna a quello del backup.
              </p>
            </div>
            <Switch
              id="preserve-audit-log"
              checked={preserveAuditLog}
              onCheckedChange={setPreserveAuditLog}
            />
          </div>

          {backup.scope === 'DB_AND_FILES' && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="restore-files">Ripristina anche i file (loghi, foto, allegati)</Label>
                <p className="text-sm text-muted-foreground">
                  Questo backup include anche i file storage. Sovrascriverà i file attuali con
                  quelli salvati nel backup.
                </p>
              </div>
              <Switch id="restore-files" checked={restoreFiles} onCheckedChange={setRestoreFiles} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="confirm-phrase">
              Digita <span className="font-mono font-semibold">{BACKUP_RESTORE_CONFIRM_PHRASE}</span> per confermare
            </Label>
            <Input
              id="confirm-phrase"
              value={typedPhrase}
              onChange={e => setTypedPhrase(e.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Annulla
          </Button>
          <Button variant="destructive" onClick={handleConfirmRestore} disabled={!canConfirmRestore}>
            {isLoading ? 'Ripristino in corso…' : 'Conferma ripristino'}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
      <DialogContent className="sm:max-w-[520px]">{body}</DialogContent>
    </Dialog>
  );
}
