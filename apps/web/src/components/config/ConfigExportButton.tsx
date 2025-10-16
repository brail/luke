/**
 * Componente per esportare le configurazioni in formato JSON
 * Maschera i valori cifrati per sicurezza
 */

import { useState } from 'react';
import { Button } from '../ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { generateExportFileName } from '../../lib/config-helpers';
import { trpc } from '../../lib/trpc';

interface ConfigExportButtonProps {
  className?: string;
}

export function ConfigExportButton({ className }: ConfigExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const exportMutation = trpc.config.exportJson.useMutation();

  const handleExport = async () => {
    setIsExporting(true);

    try {
      // Usa il nuovo endpoint exportJson
      const result = await exportMutation.mutateAsync({
        includeValues: true, // Include valori ma i cifrati mostrano [ENCRYPTED]
      });

      // Prepara i dati per l'export
      const exportData = {
        configs: result.configs.map((config: any) => ({
          key: config.key,
          value: config.value,
          encrypt: config.isEncrypted,
          category: config.category,
        })),
        exportedAt: result.exportedAt,
        version: '1.0',
        note: 'I valori cifrati sono sostituiti con [ENCRYPTED] per sicurezza',
      };

      // Crea e scarica il file
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = generateExportFileName();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Esportate ${result.count} configurazioni`);
    } catch (error) {
      console.error("Errore durante l'export:", error);
      toast.error("Errore durante l'esportazione");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isExporting}
      className={className}
    >
      {isExporting ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Esportazione...
        </>
      ) : (
        <>
          <Download className="w-4 h-4 mr-2" />
          Esporta
        </>
      )}
    </Button>
  );
}
