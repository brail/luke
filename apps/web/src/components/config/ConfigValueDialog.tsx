/**
 * Dialog per visualizzare il valore completo di una configurazione
 * Read-only con possibilità di copiare il valore
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface ConfigValueDialogProps {
  onOpenChange: () => void;
  value: string;
  keyName?: string;
}

export function ConfigValueDialog({
  onOpenChange,
  value,
  keyName,
}: ConfigValueDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Valore copiato negli appunti');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Errore durante la copia');
    }
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            Valore Configurazione
            {keyName && (
              <span className="text-sm font-mono text-muted-foreground ml-2">
                {keyName}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Visualizza il valore completo della configurazione. Puoi copiarlo
            negli appunti.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted p-4 rounded-lg">
            <pre className="whitespace-pre-wrap break-words text-sm overflow-auto max-h-96">
              {value}
            </pre>
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="flex items-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copiato
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copia
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
