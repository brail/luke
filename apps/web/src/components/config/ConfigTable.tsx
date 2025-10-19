/**
 * Tabella per visualizzare le configurazioni
 * Include sorting, azioni dropdown e gestione valori cifrati
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  MoreHorizontal,
  Lock,
  FileText,
  Edit,
  Trash2,
  Copy,
  Eye,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { ConfigKeyBadge } from './ConfigKeyBadge';
import {
  formatValue,
  formatDate,
  isCriticalKey,
} from '../../lib/config-helpers';
import { toast } from 'sonner';

interface Config {
  key: string;
  value?: string;
  valuePreview: string | null;
  isEncrypted: boolean;
  category: string;
  updatedAt: string;
}

interface ConfigTableProps {
  configs: Config[];
  onEdit: (config: Config) => void; // eslint-disable-line no-unused-vars
  onDelete: (config: Config) => void; // eslint-disable-line no-unused-vars
  onViewValue: (config: Config) => void; // eslint-disable-line no-unused-vars
  sortBy: 'key' | 'updatedAt';
  sortDir: 'asc' | 'desc';
  onSort: (field: 'key' | 'updatedAt') => void; // eslint-disable-line no-unused-vars
}

export function ConfigTable({
  configs,
  onEdit,
  onDelete,
  onViewValue,
  sortBy,
  sortDir,
  onSort,
}: ConfigTableProps) {
  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success('Chiave copiata negli appunti');
    } catch {
      toast.error('Errore durante la copia');
    }
  };

  const getSortIcon = (field: 'key' | 'updatedAt') => {
    if (sortBy !== field) {
      return <ArrowUpDown className="w-4 h-4" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-4 h-4" />
    ) : (
      <ArrowDown className="w-4 h-4" />
    );
  };

  if (configs.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Nessuna configurazione trovata</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onSort('key')}
            >
              <div className="flex items-center gap-2">
                Chiave
                {getSortIcon('key')}
              </div>
            </TableHead>
            <TableHead>Valore</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onSort('updatedAt')}
            >
              <div className="flex items-center gap-2">
                Aggiornato
                {getSortIcon('updatedAt')}
              </div>
            </TableHead>
            <TableHead className="w-[50px]">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configs.map(config => (
            <TableRow key={config.key}>
              <TableCell>
                <div className="space-y-1">
                  <code className="text-sm font-mono bg-muted px-1 py-0.5 rounded">
                    {config.key}
                  </code>
                  <ConfigKeyBadge category={config.key.split('.')[0]} />
                </div>
              </TableCell>

              <TableCell className="max-w-xs">
                {config.isEncrypted ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2">
                        <span className="truncate">
                          {formatValue(
                            config.valuePreview || config.value,
                            config.isEncrypted
                          )}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>Valore cifrato</TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="truncate">
                      {formatValue(
                        config.valuePreview || config.value,
                        config.isEncrypted
                      )}
                    </span>
                    {(config.valuePreview || config.value) &&
                      (config.valuePreview || config.value || '').length >
                        30 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewValue(config)}
                          className="h-6 w-6 p-0"
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                      )}
                  </div>
                )}
              </TableCell>

              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    config.isEncrypted
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : 'bg-gray-100 text-gray-800 border-gray-200'
                  }
                >
                  {config.isEncrypted ? (
                    <>
                      <Lock className="w-3 h-3 mr-1" />
                      Cifrato
                    </>
                  ) : (
                    <>
                      <FileText className="w-3 h-3 mr-1" />
                      Normale
                    </>
                  )}
                </Badge>
              </TableCell>

              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {formatDate(config.updatedAt)}
                </span>
              </TableCell>

              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(config)}>
                      <Edit className="w-4 h-4 mr-2" />
                      Modifica
                    </DropdownMenuItem>

                    {!config.isEncrypted && (
                      <DropdownMenuItem onClick={() => onViewValue(config)}>
                        <Eye className="w-4 h-4 mr-2" />
                        Vedi valore
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuItem onClick={() => handleCopyKey(config.key)}>
                      <Copy className="w-4 h-4 mr-2" />
                      Copia chiave
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => onDelete(config)}
                      disabled={isCriticalKey(config.key)}
                      className={
                        isCriticalKey(config.key)
                          ? 'text-muted-foreground'
                          : 'text-destructive'
                      }
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {isCriticalKey(config.key)
                        ? 'Elimina (bloccato)'
                        : 'Elimina'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
