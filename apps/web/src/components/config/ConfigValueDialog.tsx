import { Copy, Check, Code } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  formatJsonExpanded,
  formatJsonCompact,
} from '../../lib/config-helpers';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';

interface ConfigValueDialogProps {
  onOpenChange: () => void;
  value: string;
  keyName?: string;
}

/**
 * Read-only dialog that displays the full value of an AppConfig entry.
 *
 * Detects JSON values and offers an expand/compact toggle. Provides a copy-to-clipboard button.
 *
 * @param value - The plain-text config value to display (never an encrypted value).
 * @param keyName - Optional config key shown in the dialog title for context.
 */
export function ConfigValueDialog({
  onOpenChange,
  value,
  keyName,
}: ConfigValueDialogProps) {
  const [copied, setCopied] = useState(false);
  const [isJsonExpanded, setIsJsonExpanded] = useState(false);

  // Verifica se il valore è un JSON
  const isJson = value.startsWith('{') && value.includes('"');
  const displayValue = isJson
    ? isJsonExpanded
      ? formatJsonExpanded(value)
      : formatJsonCompact(value)
    : value;

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
      <DialogContent className="max-w-4xl max-h-[80vh] w-full p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
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

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="bg-muted p-4 rounded-lg">
            <pre className="whitespace-pre-wrap break-all text-sm overflow-auto max-h-96 font-mono">
              {displayValue}
            </pre>
          </div>
        </div>

          <DialogFooter className="flex-row justify-between sm:justify-between sm:space-x-0 px-6 py-4 border-t shrink-0">
            {isJson && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsJsonExpanded(!isJsonExpanded)}
                className="flex items-center gap-2"
              >
                <Code className="w-4 h-4" />
                {isJsonExpanded ? 'Compatto' : 'Espandi'}
              </Button>
            )}

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
          </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
