import { Download, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { generateExportFileName } from '../../lib/configHelpers';
import { debugError } from '../../lib/debug';
import { triggerBlobDownload } from '../../lib/download';
import { trpc } from '../../lib/trpc';
import { Button } from '../ui/button';

interface ConfigExportButtonProps {
  className?: string;
  disabled?: boolean;
}

/**
 * Button that exports all AppConfig entries as a JSON file download.
 *
 * Encrypted values are replaced with `[ENCRYPTED]` in the export for security.
 * Triggers a browser download via a temporary object URL.
 */
export function ConfigExportButton({ className, disabled }: ConfigExportButtonProps) {
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
        configs: result.configs.map(config => ({
          key: config.key,
          value: config.value,
          encrypt: config.isEncrypted,
          category: config.category,
        })),
        exportedAt: result.exportedAt,
        version: '1.0',
        note: 'I valori cifrati sono sostituiti con [ENCRYPTED] per sicurezza',
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      triggerBlobDownload(blob, generateExportFileName());

      toast.success(`Esportate ${result.count} configurazioni`);
    } catch (error) {
      debugError("Errore durante l'export:", error);
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
      disabled={isExporting || disabled}
      className={className}
    >
      {isExporting ? (
        <>
          <LoaderCircle className="w-4 h-4 mr-2 animate-spin" />
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
