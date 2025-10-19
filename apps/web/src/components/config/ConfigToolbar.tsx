/**
 * Toolbar per la gestione delle configurazioni
 * Include ricerca, filtri e azioni principali
 */

import { Search } from 'lucide-react';

import { CATEGORIES } from '../../lib/config-helpers';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

interface ConfigToolbarProps {
  searchTerm: string;
  onSearchChange: (searchTerm: string) => void;
  filterEncrypted: boolean | undefined;
  onFilterEncryptedChange: (filterEncrypted: boolean | undefined) => void;
  filterCategory: string | undefined;
  onFilterCategoryChange: (filterCategory: string | undefined) => void;
}

export function ConfigToolbar({
  searchTerm,
  onSearchChange,
  filterEncrypted,
  onFilterEncryptedChange,
  filterCategory,
  onFilterCategoryChange,
}: ConfigToolbarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {/* Input Ricerca */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder="Cerca per chiave..."
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Filtro Tipo */}
      <Select
        value={
          filterEncrypted === undefined
            ? 'all'
            : filterEncrypted
              ? 'encrypted'
              : 'plain'
        }
        onValueChange={value => {
          switch (value) {
            case 'encrypted':
              onFilterEncryptedChange(true);
              break;
            case 'plain':
              onFilterEncryptedChange(false);
              break;
            default:
              onFilterEncryptedChange(undefined);
          }
        }}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tutti i tipi</SelectItem>
          <SelectItem value="encrypted">Cifrati</SelectItem>
          <SelectItem value="plain">Normali</SelectItem>
        </SelectContent>
      </Select>

      {/* Filtro Categoria */}
      <Select
        value={filterCategory || 'all'}
        onValueChange={value =>
          onFilterCategoryChange(value === 'all' ? undefined : value)
        }
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tutte le categorie</SelectItem>
          {CATEGORIES.map(category => (
            <SelectItem key={category} value={category}>
              {category}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
