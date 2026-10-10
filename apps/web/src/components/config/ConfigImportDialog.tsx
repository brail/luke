import { CheckCircle, CircleMinus, XCircle, AlertTriangle, LoaderCircle } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  CONFIG_SECRET_PLACEHOLDER,
  ConfigImportFileSchema,
  ConfigImportItemSchema,
  type ConfigImportItem,
} from '@luke/core';

import {
  validateConfigKey,
  validateConfigValue,
} from '../../lib/configHelpers';
import { debugError, debugWarn } from '../../lib/debug';
import { trpc } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Progress } from '../ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';

/** A row of the file as the preview shows it; `error` holds the reason for `invalid` and `skipped`. */
type ImportPreview = ConfigImportItem & {
  status: 'new' | 'update' | 'invalid' | 'skipped';
  error?: string;
};

/**
 * Classifies one row of the file. A row that passes every check is `new`; whether it already exists
 * is asked of the server afterwards, for those rows only.
 */
function classifyRow(row: unknown, index: number): ImportPreview {
  const parsed = ConfigImportItemSchema.safeParse(row);
  if (!parsed.success) {
    return {
      key: `riga ${index + 1}`,
      value: null,
      status: 'invalid',
      error: z.prettifyError(parsed.error),
    };
  }

  const item = parsed.data;
  if (item.value === null) {
    return { ...item, status: 'skipped', error: 'Nessun valore nel file' };
  }
  if (item.value === CONFIG_SECRET_PLACEHOLDER) {
    return {
      ...item,
      status: 'skipped',
      error: "Valore cifrato: l'export non lo contiene, reinseriscilo a mano",
    };
  }

  const keyValidation = validateConfigKey(item.key);
  if (!keyValidation.valid) {
    return { ...item, status: 'invalid', error: keyValidation.error };
  }
  const valueValidation = validateConfigValue(item.value);
  if (!valueValidation.valid) {
    return { ...item, status: 'invalid', error: valueValidation.error };
  }

  return { ...item, status: 'new' };
}

interface ConfigImportDialogProps {
  onOpenChange: () => void;
  onSuccess: () => void;
}

/**
 * Three-step dialog for batch-importing AppConfig entries from a JSON file.
 *
 * Step 1 — file upload, parsed with `ConfigImportFileSchema` and each row with the
 * `ConfigImportItemSchema` that `config.importJson` shares. Step 2 — preview table
 * distinguishing new vs. update vs. invalid vs. skipped rows (existence checked via tRPC).
 * Step 3 — import with a progress bar; reports the skipped keys and the server's per-item errors.
 *
 * Existing keys are overwritten, except by the rows the file carries without a value — `value: null`
 * and the export's `CONFIG_SECRET_PLACEHOLDER` — which are skipped. Invalid rows are not sent.
 *
 * @param onSuccess - Called after at least one config was imported successfully.
 */
export function ConfigImportDialog({
  onOpenChange,
  onSuccess,
}: ConfigImportDialogProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>(
    'upload'
  );
  const [preview, setPreview] = useState<ImportPreview[]>([]);
  const [progress, setProgress] = useState(0);
  const [importing, setImporting] = useState(false);

  const importMutation = trpc.config.importJson.useMutation();
  const utils = trpc.useUtils();
  // The rows the import sends: everything else stays as it is on the server.
  const importable = preview.filter(p => p.status === 'new' || p.status === 'update');

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.json')) {
      toast.error('Seleziona un file JSON valido');
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(await selectedFile.text());
    } catch (error) {
      debugError('File parse error:', error);
      toast.error('Errore nel parsing del file JSON');
      return;
    }

    const file = ConfigImportFileSchema.safeParse(data);
    if (!file.success) {
      toast.error('Formato file non valido', { description: z.prettifyError(file.error) });
      return;
    }

    const rows = file.data.configs.map(classifyRow);

    const newKeys = rows.filter(r => r.status === 'new').map(r => r.key);
    const existingKeys = new Set<string>();
    if (newKeys.length > 0) {
      try {
        // Straight from the server: a cached answer could call a key saved since then new.
        const results = await utils.client.config.getMultiple.query({ keys: newKeys });
        results.forEach(r => {
          if (r.found) existingKeys.add(r.key);
        });
      } catch (err) {
        debugWarn('Failed to check existing configs:', err);
        toast.warning('Impossibile verificare le chiavi esistenti', {
          description: 'Le righe risultano tutte nuove: quelle già presenti verranno sovrascritte',
        });
      }
    }

    setPreview(
      rows.map(r =>
        r.status === 'new' && existingKeys.has(r.key) ? { ...r, status: 'update' } : r
      )
    );
    setStep('preview');
  };

  const handleImport = async () => {
    const items = importable.map(({ key, value, encrypt }) => ({ key, value, encrypt }));

    if (items.length === 0) {
      toast.error('Nessuna configurazione valida da importare');
      return;
    }

    setStep('importing');
    setImporting(true);
    setProgress(0);

    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      // Working progress bar during the import
      progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const result = await importMutation.mutateAsync({ items });

      setProgress(100); // Complete the progress bar
      void utils.config.invalidate();

      if (result.successCount > 0) {
        toast.success(`${result.successCount} configurazioni importate con successo`);
        onSuccess();
        onOpenChange();
      }

      if (result.errorCount > 0) {
        // Not every message names its key (the kill-switch guard, a database error), so the key goes first.
        toast.error(`${result.errorCount} configurazioni non sono state importate`, {
          description: result.errors.map(e => `${e.key}: ${e.error}`).join('; '),
        });
      }

      // Whatever the outcome: the preview that listed them is gone once the form resets.
      const skipped = preview.filter(p => p.status === 'skipped').map(p => p.key);
      if (skipped.length > 0) {
        toast.info(`Righe saltate: ${skipped.length}`, { description: skipped.join(', ') });
      }

      // Reset form
      setPreview([]);
      setStep('upload');
    } catch (error) {
      debugError("Error during import:", error);
      toast.error("Errore durante l'importazione");
    } finally {
      if (progressInterval !== null) clearInterval(progressInterval);
      setImporting(false);
      // Keep progress at 100% for a moment before resetting
      setTimeout(() => setProgress(0), 1000);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setPreview([]);
      setStep('upload');
      onOpenChange();
    }
  };

  const getStatusIcon = (status: ImportPreview['status']) => {
    switch (status) {
      case 'new':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'update':
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'invalid':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'skipped':
        return <CircleMinus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: ImportPreview['status']) => {
    switch (status) {
      case 'new':
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800">
            Nuova
          </Badge>
        );
      case 'update':
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
            Aggiorna
          </Badge>
        );
      case 'invalid':
        return <Badge variant="destructive">Invalida</Badge>;
      case 'skipped':
        return <Badge variant="secondary">Saltata</Badge>;
    }
  };

  const isPreviewStep = step === 'preview';

  return (
    <Dialog open={true} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] p-0 gap-0 flex flex-col"> {/* vh: no Tailwind scale equivalent for viewport-relative height */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle>Importa Configurazioni</DialogTitle>
          <DialogDescription>
            Importa configurazioni da un file JSON. Le configurazioni esistenti
            verranno aggiornate. I valori cifrati non sono nell&apos;export:
            vanno reinseriti a mano.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-file">Seleziona file JSON</Label>
              {/* eslint-disable-next-line @luke/no-dialog-input-outside-form -- file picker:
                  selecting a file advances the wizard on change, there is nothing to submit. */}
              <Input
                id="import-file"
                type="file"
                accept=".json"
                onChange={e => void handleFileSelect(e)}
                disabled={importing}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Il file deve contenere un array di configurazioni nel formato:
              <br />
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                {`{"configs": [{"key": "...", "value": "...", "encrypt": false}]}`}
              </code>
            </p>
          </div>
        )}

        {isPreviewStep && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Anteprima Importazione</h3>
              <div className="text-sm text-muted-foreground">
                {importable.length} configurazioni da importare
              </div>
            </div>

            <div className="max-h-96 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stato</TableHead>
                    <TableHead>Chiave</TableHead>
                    <TableHead>Valore</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Errore</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(item.status)}
                          {getStatusBadge(item.status)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-sm font-mono bg-muted px-1 py-0.5 rounded">
                          {item.key}
                        </code>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {item.encrypt ? '••••••' : item.value}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {item.encrypt ? 'Cifrato' : 'Normale'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.error && (
                          <span
                            className={cn(
                              'text-sm',
                              item.status === 'skipped' ? 'text-muted-foreground' : 'text-red-600'
                            )}
                          >
                            {item.error}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4">
            <div className="text-center">
              <LoaderCircle className="w-8 h-8 animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-medium">Importazione in corso...</h3>
              <p className="text-sm text-muted-foreground">
                Importazione delle configurazioni
              </p>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}
        </div>

        {isPreviewStep && (
          <DialogFooter className="px-6 py-4 border-t shrink-0">
            <Button variant="outline" onClick={handleClose}>
              Annulla
            </Button>
            <Button
              onClick={handleImport}
              disabled={importable.length === 0}
            >
              Importa Configurazioni
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
