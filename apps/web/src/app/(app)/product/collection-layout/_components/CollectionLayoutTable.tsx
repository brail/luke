'use client';

import { AlertTriangle, Plus, Search, Settings2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import {
  COLLECTION_COLUMNS_DEFAULT_HIDDEN,
  COLLECTION_COLUMNS_MAX_VISIBLE,
  COLLECTION_GENDER,
  COLLECTION_PROGRESS,
  COLLECTION_STATUS,
  COLLECTION_STRATEGY,
  COLLECTION_TABLE_COLUMNS,
} from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';

import { CollectionGroupSection } from './CollectionGroupSection';

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;

function getHiddenColumns(layout: unknown): string[] {
  const cols = (layout as Record<string, unknown>)?.['hiddenColumns'];
  // null = never set → use defaults so new columns are hidden and exactly 7 are visible
  if (cols === null || cols === undefined) {
    return [...COLLECTION_COLUMNS_DEFAULT_HIDDEN];
  }
  return Array.isArray(cols) ? (cols as string[]) : [];
}
type CollectionGroupData = CollectionLayoutData['groups'][number];
type CollectionRowData = CollectionGroupData['rows'][number];

interface CollectionLayoutTableProps {
  layout: CollectionLayoutData;
  canUpdate: boolean;
  onAddGroup: () => void;
  onAddRow: (groupId: string) => void;
  onEditRow: (row: CollectionRowData) => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string, lineName: string) => void;
  onRenameGroup: (group: CollectionGroupData) => void;
  onDeleteGroup: (groupId: string, groupName: string) => void;
  onUpdateSettings: (settings: { hiddenColumns?: string[] | null }) => void;
  isDeletingRow?: boolean;
}

export function CollectionLayoutTable({
  layout,
  canUpdate,
  onAddGroup,
  onAddRow,
  onEditRow,
  onDuplicateRow,
  onDeleteRow,
  onRenameGroup,
  onDeleteGroup,
  onUpdateSettings,
  isDeletingRow = false,
}: CollectionLayoutTableProps) {
  const [search, setSearch] = useState('');
  const [filterGender, setFilterGender] = useState('_all');
  const [filterStrategy, setFilterStrategy] = useState('_all');
  const [filterStatus, setFilterStatus] = useState('_all');
  const [filterProgress, setFilterProgress] = useState('_all');
  const [columnsPopoverOpen, setColumnsPopoverOpen] = useState(false);

  const hiddenColumns = getHiddenColumns(layout);

  const hasFilters =
    search !== '' ||
    filterGender !== '_all' ||
    filterStrategy !== '_all' ||
    filterStatus !== '_all' ||
    filterProgress !== '_all';

  const filteredGroups = useMemo((): CollectionGroupData[] => {
    return layout.groups.map(group => ({
      ...group,
      rows: group.rows.filter(row => {
        if (
          search &&
          !row.line.toLowerCase().includes(search.toLowerCase()) &&
          !row.supplier.toLowerCase().includes(search.toLowerCase())
        ) {
          return false;
        }
        if (filterGender !== '_all' && row.gender !== filterGender) return false;
        if (filterStrategy !== '_all') {
          if (filterStrategy === '_none' && row.strategy) return false;
          if (filterStrategy !== '_none' && row.strategy !== filterStrategy)
            return false;
        }
        if (filterStatus !== '_all' && row.status !== filterStatus) return false;
        if (filterProgress !== '_all') {
          if (filterProgress === '_none' && row.progress) return false;
          if (filterProgress !== '_none' && row.progress !== filterProgress)
            return false;
        }
        return true;
      }),
    }));
  }, [layout.groups, search, filterGender, filterStrategy, filterStatus, filterProgress]);

  const totalRows = filteredGroups.reduce((sum, g) => sum + g.rows.length, 0);
  const totalSku = filteredGroups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + r.skuForecast, 0),
    0
  );
  const totalQty = filteredGroups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + r.qtyForecast, 0),
    0
  );

  const clearFilters = () => {
    setSearch('');
    setFilterGender('_all');
    setFilterStrategy('_all');
    setFilterStatus('_all');
    setFilterProgress('_all');
  };

  const visibleCount = COLLECTION_TABLE_COLUMNS.length - hiddenColumns.length;

  // Layout SKU budget = sum of all group budgets (only when at least one group has a budget)
  const layoutSkuBudget = layout.groups.some(g => g.skuBudget != null)
    ? layout.groups.reduce((sum, g) => sum + (g.skuBudget ?? 0), 0)
    : null;

  const toggleColumn = (key: string, checked: boolean) => {
    if (checked && visibleCount >= COLLECTION_COLUMNS_MAX_VISIBLE) return;
    const next = checked
      ? hiddenColumns.filter(c => c !== key)
      : [...hiddenColumns, key];
    onUpdateSettings({ hiddenColumns: next });
  };

const skuRatio = layoutSkuBudget ? totalSku / layoutSkuBudget : null;
  const skuVariantClass =
    skuRatio == null
      ? ''
      : skuRatio >= 1
        ? 'text-destructive font-semibold'
        : skuRatio >= 0.9
          ? 'text-amber-600 dark:text-amber-400 font-semibold'
          : 'text-muted-foreground';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cerca linea o fornitore…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={filterGender} onValueChange={setFilterGender}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Tutti gender</SelectItem>
            {COLLECTION_GENDER.map(g => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStrategy} onValueChange={setFilterStrategy}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Strategy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Tutte strategy</SelectItem>
            <SelectItem value="_none">— Nessuna —</SelectItem>
            {COLLECTION_STRATEGY.map(s => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Tutti status</SelectItem>
            {COLLECTION_STATUS.map(s => (
              <SelectItem key={s} value={s}>
                {s === 'CARRY_OVER' ? 'C/O' : 'New'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterProgress} onValueChange={setFilterProgress}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Progress" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Tutti progress</SelectItem>
            <SelectItem value="_none">— Nessuno —</SelectItem>
            {COLLECTION_PROGRESS.map(p => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Reset
          </Button>
        )}

        {/* Column visibility popover */}
        <Popover open={columnsPopoverOpen} onOpenChange={setColumnsPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings2 className="h-4 w-4 mr-1" />
              Colonne
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">
                Colonne visibili
              </p>
              <span
                className={`text-xs font-medium tabular-nums ${
                  visibleCount >= COLLECTION_COLUMNS_MAX_VISIBLE
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
                }`}
              >
                {visibleCount} / {COLLECTION_COLUMNS_MAX_VISIBLE}
              </span>
            </div>
            <div className="space-y-2">
              {COLLECTION_TABLE_COLUMNS.map(col => {
                const isChecked = !hiddenColumns.includes(col.key);
                const isDisabled =
                  !canUpdate ||
                  (!isChecked && visibleCount >= COLLECTION_COLUMNS_MAX_VISIBLE);
                return (
                  <div key={col.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`col-${col.key}`}
                      checked={isChecked}
                      onCheckedChange={(checked: boolean) =>
                        toggleColumn(col.key, checked)
                      }
                      disabled={isDisabled}
                    />
                    <Label
                      htmlFor={`col-${col.key}`}
                      className={`text-sm ${isDisabled && !isChecked ? 'text-muted-foreground/50' : 'cursor-pointer'}`}
                    >
                      {col.label}
                    </Label>
                  </div>
                );
              })}
            </div>
            {visibleCount >= COLLECTION_COLUMNS_MAX_VISIBLE && (
              <p className="text-xs text-muted-foreground mt-2">
                Massimo {COLLECTION_COLUMNS_MAX_VISIBLE} colonne. Deselezionane una per aggiungerne un'altra.
              </p>
            )}
          </PopoverContent>
        </Popover>

        {canUpdate && (
          <Button size="sm" onClick={onAddGroup} className="ml-auto">
            <Plus className="h-4 w-4 mr-1" />
            Nuovo gruppo
          </Button>
        )}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/30 text-sm flex-wrap">
        <span className="text-muted-foreground">Totale:</span>
        <span className="font-medium">{totalRows} righe</span>
        <span className="text-muted-foreground">·</span>
        {layoutSkuBudget ? (
          <span className={`inline-flex items-center gap-1 ${skuVariantClass}`}>
            {totalSku} / {layoutSkuBudget} SKU
            {skuRatio != null && skuRatio >= 1 && (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
          </span>
        ) : (
          <span className="font-medium">{totalSku} SKU</span>
        )}
        <span className="text-muted-foreground">·</span>
        <span className="font-medium">{totalQty} paia</span>

{hasFilters && (
          <Badge variant="secondary" className="ml-auto text-xs">
            Filtri attivi
          </Badge>
        )}
      </div>

      {/* Group sections */}
      <div className="space-y-4">
        {filteredGroups.map(group => (
          <CollectionGroupSection
            key={group.id}
            group={group}
            canUpdate={canUpdate}
            hiddenColumns={hiddenColumns}
            onAddRow={onAddRow}
            onEditRow={onEditRow}
            onDuplicateRow={onDuplicateRow}
            onDeleteRow={onDeleteRow}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            isDeletingRow={isDeletingRow}
          />
        ))}

        {filteredGroups.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {hasFilters
              ? 'Nessuna riga corrisponde ai filtri applicati.'
              : 'Nessun gruppo. Aggiungi il primo gruppo per iniziare.'}
          </div>
        )}
      </div>
    </div>
  );
}
