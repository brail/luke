'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Ban } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  BACKUP_RESTORE_CONFIRM_PHRASE,
  BackupRestoreInputSchema,
  type BackupRecord,
  type CheckRestoreCompatibilityOutput,
} from '@luke/core';

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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
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

/**
 * The two restore switches, taken from the mutation input; the `id` belongs to the parent.
 *
 * `confirmPhrase` is relaxed from the core schema's `z.literal` to a checked string: the field
 * starts empty and is typed toward the phrase, so the form has to model every intermediate value.
 * The equality rule is the same one, and the literal still guards the mutation input.
 */
interface RestoreFormData {
  preserveAuditLog: boolean;
  restoreFiles: boolean;
  confirmPhrase: string;
}

// Declared rather than inferred: `z.infer` of this composition still reports `confirmPhrase` as
// the literal, even though `.extend()` really does replace it — verified at runtime, where the
// field is a plain ZodString reporting the message below. The annotation pins the type the form
// actually holds.
const RestoreFormSchema: z.ZodType<RestoreFormData, RestoreFormData> = BackupRestoreInputSchema
  .pick({ preserveAuditLog: true, restoreFiles: true })
  .extend({
    confirmPhrase: z.string().refine(value => value === BACKUP_RESTORE_CONFIRM_PHRASE, {
      message: `Devi digitare esattamente "${BACKUP_RESTORE_CONFIRM_PHRASE}" per confermare`,
    }),
  });

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
  const [acknowledgeMigrationBridge, setAcknowledgeMigrationBridge] = useState(false);

  const form = useForm<RestoreFormData>({
    resolver: zodResolver(RestoreFormSchema),
    defaultValues: { preserveAuditLog: true, restoreFiles: false, confirmPhrase: '' },
    // The typed phrase gates the confirm button, so validity has to track every keystroke rather
    // than settle at submit time.
    mode: 'onChange',
  });

  // Reset per-target state when a different backup is targeted — this dialog may stay mounted
  // across restore targets rather than remounting, so state must not leak between them.
  useEffect(() => {
    form.reset({
      preserveAuditLog: true,
      restoreFiles: backup?.scope === 'DB_AND_FILES',
      confirmPhrase: '',
    });
    setAcknowledgeMigrationBridge(false);
  }, [backup?.id, backup?.scope, form]);

  if (!backup) return null;

  const canConfirmRestore = form.formState.isValid && !isLoading;
  const handleConfirmRestore = (data: RestoreFormData) => {
    onConfirm({ preserveAuditLog: data.preserveAuditLog, restoreFiles: data.restoreFiles });
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
          <DialogDescription asChild className="text-left space-y-3 pt-2">
            <div>
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
            </div>
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
          <DialogDescription asChild className="text-left space-y-3 pt-2">
            <div>
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
            </div>
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
          <DialogDescription asChild className="text-left space-y-3 pt-2">
            <div>
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
            </div>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleConfirmRestore)} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="preserveAuditLog"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between space-y-0 rounded-md border p-3">
                    <div className="space-y-0.5 pr-4">
                      <FormLabel>Preserva il registro attività corrente</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Se attivo (consigliato), il registro attuale viene unito a quello del backup:
                        nessun evento va perso, né quelli scritti dopo il backup né quelli che il backup
                        contiene. Se disattivi, il registro torna esattamente a quello del backup e gli
                        eventi successivi vengono persi.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLoading} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {backup.scope === 'DB_AND_FILES' && (
                <FormField
                  control={form.control}
                  name="restoreFiles"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between space-y-0 rounded-md border p-3">
                      <div className="space-y-0.5 pr-4">
                        <FormLabel>Ripristina anche i file (loghi, foto, allegati)</FormLabel>
                        <p className="text-sm text-muted-foreground">
                          Questo backup include anche i file storage. Sovrascriverà i file attuali con
                          quelli salvati nel backup.
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLoading} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="confirmPhrase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Digita <span className="font-mono font-semibold">{BACKUP_RESTORE_CONFIRM_PHRASE}</span> per confermare
                    </FormLabel>
                    <FormControl>
                      <Input autoComplete="off" className="font-mono" disabled={isLoading} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Annulla
              </Button>
              {/* Stays disabled until the phrase matches: this is a type-to-confirm gate on an
                  irreversible restore, and the requirement is stated directly above the field. */}
              <Button type="submit" variant="destructive" disabled={!canConfirmRestore}>
                {isLoading ? 'Ripristino in corso…' : 'Conferma ripristino'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </>
    );
  }

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable while the restore — or the migration bridge —
  // is already running, taking its progress UI with it.
  const handleOpenChange = (next: boolean) => {
    if (!next && (isLoading || isBridging)) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
      <DialogContent className="sm:max-w-[520px]">{body}</DialogContent>
    </Dialog>
  );
}
