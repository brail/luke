/**
 * Dialog per importare configurazioni da file JSON
 * Include validazione, anteprima e applicazione batch
 */

import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Progress } from '../ui/progress';
import { CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  validateConfigKey,
  validateConfigValue,
} from '../../lib/config-helpers';
import { trpc } from '../../lib/trpc';

interface ImportConfig {
  key: string;
  value: string;
  encrypt: boolean;
  category?: string;
}

interface ImportPreview {
  config: ImportConfig;
  status: 'new' | 'update' | 'invalid';
  error?: string;
}

interface ConfigImportDialogProps {
  onOpenChange: () => void;
  onSuccess: () => void;
}

export function ConfigImportDialog({
  onOpenChange,
  onSuccess,
}: ConfigImportDialogProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>(
    'upload'
  );
  const [, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview[]>([]);
  const [progress, setProgress] = useState(0);
  const [importing, setImporting] = useState(false);

  const importMutation = (trpc as any).config.importJson.useMutation();

  const validateConfig = useCallback(
    (config: ImportConfig): { valid: boolean; error?: string } => {
      const keyValidation = validateConfigKey(config.key);
      if (!keyValidation.valid) {
        return { valid: false, error: keyValidation.error };
      }

      const valueValidation = validateConfigValue(config.value);
      if (!valueValidation.valid) {
        return { valid: false, error: valueValidation.error };
      }

      return { valid: true };
    },
    []
  );

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.json')) {
      toast.error('Seleziona un file JSON valido');
      return;
    }

    setFile(selectedFile);

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        if (!data.configs || !Array.isArray(data.configs)) {
          throw new Error('Formato file non valido: manca array "configs"');
        }

        const previewData: ImportPreview[] = data.configs.map((config: any) => {
          const validation = validateConfig(config);
          return {
            config,
            status: validation.valid ? 'new' : 'invalid',
            error: validation.error,
          };
        });

        setPreview(previewData);
        setStep('preview');
      } catch (error) {
        console.error('Errore parsing file:', error);
        toast.error('Errore nel parsing del file JSON');
      }
    };

    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    const validConfigs = preview
      .filter(p => p.status !== 'invalid')
      .map(p => ({
        key: p.config.key,
        value: p.config.value,
        encrypt: p.config.encrypt || false,
      }));

    if (validConfigs.length === 0) {
      toast.error('Nessuna configurazione valida da importare');
      return;
    }

    setStep('importing');
    setImporting(true);
    setProgress(0);

    try {
      const result = await importMutation.mutateAsync({
        items: validConfigs,
      });

      if (result.successCount > 0) {
        toast.success(
          `${result.successCount} configurazioni importate con successo`
        );
        onSuccess();
        onOpenChange();
      }

      if (result.errorCount > 0) {
        toast.error(
          `${result.errorCount} configurazioni non sono state importate`
        );
        // Mostra dettagli errori se disponibili
        if (result.errors && result.errors.length > 0) {
          console.error('Errori di importazione:', result.errors);
        }
      }

      // Reset form
      setFile(null);
      setPreview([]);
      setStep('upload');
    } catch (error) {
      console.error("Errore durante l'import:", error);
      toast.error("Errore durante l'importazione");
    } finally {
      setImporting(false);
      setProgress(0);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setFile(null);
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
        return (
          <Badge variant="outline" className="bg-red-100 text-red-800">
            Invalida
          </Badge>
        );
    }
  };

  return (
    <Dialog open={true} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Importa Configurazioni</DialogTitle>
          <DialogDescription>
            Importa configurazioni da un file JSON. Le configurazioni esistenti
            verranno aggiornate.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-file">Seleziona file JSON</Label>
              <Input
                id="import-file"
                type="file"
                accept=".json"
                onChange={handleFileSelect}
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

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Anteprima Importazione</h3>
              <div className="text-sm text-muted-foreground">
                {preview.filter(p => p.status !== 'invalid').length}{' '}
                configurazioni valide
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
                          {item.config.key}
                        </code>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {item.config.encrypt ? '••••••' : item.config.value}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {item.config.encrypt ? 'Cifrato' : 'Normale'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.error && (
                          <span className="text-sm text-red-600">
                            {item.error}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={handleClose}>
                Annulla
              </Button>
              <Button
                onClick={handleImport}
                disabled={
                  preview.filter(p => p.status !== 'invalid').length === 0
                }
              >
                Importa Configurazioni
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-medium">Importazione in corso...</h3>
              <p className="text-sm text-muted-foreground">
                Importazione delle configurazioni
              </p>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
