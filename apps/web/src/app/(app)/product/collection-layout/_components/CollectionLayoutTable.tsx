'use client';

import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2, Maximize2, Minimize2, Plus, RotateCcw, Search, Settings2 } from 'lucide-react';
import { useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import {
  COLLECTION_COLUMNS_DEFAULT_HIDDEN,
  COLLECTION_COLUMNS_MAX_VISIBLE,
  COLLECTION_TABLE_COLUMNS,
} from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../../components/ui/dropdown-menu';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../../components/ui/popover';
import { computeWeightedMargin } from '../_hooks/usePricingCalc';

import { CollectionGroupSection } from './CollectionGroupSection';

import type { PricingParameterSet } from '../_hooks/usePricingCalc';

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;

function getHiddenColumns(layout: unknown): string[] {
  const cols = (layout as Record<string, unknown>)?.['hiddenColumns'];
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
  parameterSets: PricingParameterSet[];
  onAddGroup: () => void;
  onAddRow: (groupId: string) => void;
  onEditRow: (row: CollectionRowData) => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string, lineName: string) => void;
  onRenameGroup: (group: CollectionGroupData) => void;
  onDeleteGroup: (groupId: string, groupName: string) => void;
  onUpdateSettings: (settings: { hiddenColumns?: string[] | null }) => void;
  isDeletingRow?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onExportXlsx?: () => void;
  isExportingXlsx?: boolean;
  onExportPdf?: () => void;
  isExportingPdf?: boolean;
}

export function CollectionLayoutTable({
  layout,
  canUpdate,
  parameterSets,
  onAddGroup,
  onAddRow,
  onEditRow,
  onDuplicateRow,
  onDeleteRow,
  onRenameGroup,
  onDeleteGroup,
  onUpdateSettings,
  isDeletingRow = false,
  isFullscreen = false,
  onToggleFullscreen,
  onExportXlsx,
  isExportingXlsx = false,
  onExportPdf,
  isExportingPdf = false,
}: CollectionLayoutTableProps) {
  const [search, setSearch] = useState('');
  const [columnsPopoverOpen, setColumnsPopoverOpen] = useState(false);

  // Columns saved in DB — used for the popover and normal mode rendering
  const hiddenColumns = getHiddenColumns(layout);
  // In fullscreen all columns are visible; normal mode respects saved preferences
  const effectiveHiddenColumns = isFullscreen ? [] : hiddenColumns;

  const maxVisible = isFullscreen ? Infinity : COLLECTION_COLUMNS_MAX_VISIBLE;
  const hasActiveSearch = search !== '';

  const totalRows = layout.groups.reduce((sum, g) => sum + g.rows.length, 0);
  const totalSku = layout.groups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + r.skuForecast, 0),
    0
  );
  const totalQty = layout.groups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + r.qtyForecast, 0),
    0
  );
  const allRows = layout.groups.flatMap(g => g.rows);
  const totalWeightedMargin = computeWeightedMargin(allRows, parameterSets);

  const visibleCount = COLLECTION_TABLE_COLUMNS.length - hiddenColumns.length;

  const layoutSkuBudget = layout.groups.some(g => g.skuBudget != null)
    ? layout.groups.reduce((sum, g) => sum + (g.skuBudget ?? 0), 0)
    : null;

  const toggleColumn = (key: string, checked: boolean) => {
    if (checked && visibleCount >= maxVisible) return;
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
      {/* Summary bar — above toolbar, near the "Collection Layout" card title */}
      <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/30 text-sm flex-wrap">
        <span className="text-muted-foreground">Totale:</span>
        <span className="font-medium">{totalRows} righe</span>
        <span className="text-muted-foreground">·</span>
        {layoutSkuBudget ? (
          <span className={`inline-flex items-center gap-1 ${skuVariantClass}`}>
            {totalSku} / {layoutSkuBudget} SKU
            {skuRatio != null && skuRatio >= 1 && <AlertTriangle className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className="font-medium">{totalSku} SKU</span>
        )}
        <span className="text-muted-foreground">·</span>
        <span className="font-medium">{totalQty} paia</span>
        {totalWeightedMargin !== null && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium">mrg {(totalWeightedMargin * 100).toFixed(1)}%</span>
          </>
        )}

        {hasActiveSearch && (
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">Ricerca attiva</Badge>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSearch('')}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </div>
        )}
      </div>

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

        {/* Column visibility popover — hidden in fullscreen (all columns already visible) */}
        {!isFullscreen && (
          <Popover open={columnsPopoverOpen} onOpenChange={setColumnsPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="h-4 w-4 mr-1" />
                Colonne
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground">Colonne visibili</p>
                <span className={`text-xs font-medium tabular-nums ${visibleCount >= COLLECTION_COLUMNS_MAX_VISIBLE ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  {visibleCount} / {COLLECTION_COLUMNS_MAX_VISIBLE}
                </span>
              </div>
              <div className="space-y-2">
                {COLLECTION_TABLE_COLUMNS.map(col => {
                  const isChecked = !hiddenColumns.includes(col.key);
                  const isDisabled = !canUpdate || (!isChecked && visibleCount >= COLLECTION_COLUMNS_MAX_VISIBLE);
                  return (
                    <div key={col.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`col-${col.key}`}
                        checked={isChecked}
                        onCheckedChange={(checked: boolean) => toggleColumn(col.key, checked)}
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
        )}

        {onToggleFullscreen && (
          <Button variant="outline" size="sm" onClick={onToggleFullscreen}>
            {isFullscreen
              ? <><Minimize2 className="h-4 w-4 mr-1" />Riduci</>
              : <><Maximize2 className="h-4 w-4 mr-1" />Espandi</>}
          </Button>
        )}

        {(onExportXlsx || onExportPdf) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isExportingXlsx || isExportingPdf}>
                {(isExportingXlsx || isExportingPdf)
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Esportando…</>
                  : <><Download className="h-4 w-4 mr-1" />Esporta</>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onExportXlsx && (
                <DropdownMenuItem onClick={onExportXlsx} disabled={isExportingXlsx}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Excel (.xlsx)
                </DropdownMenuItem>
              )}
              {onExportPdf && (
                <DropdownMenuItem onClick={onExportPdf} disabled={isExportingPdf}>
                  <FileText className="h-4 w-4 mr-2" />
                  PDF (A3)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canUpdate && (
          <Button size="sm" onClick={onAddGroup} className="ml-auto">
            <Plus className="h-4 w-4 mr-1" />
            Nuovo gruppo
          </Button>
        )}
      </div>

      {/* Group sections */}
      <div className="space-y-4">
        {layout.groups.map(group => (
          <CollectionGroupSection
            key={group.id}
            group={group}
            canUpdate={canUpdate}
            hiddenColumns={effectiveHiddenColumns}
            parameterSets={parameterSets}
            searchQuery={search}
            onAddRow={onAddRow}
            onEditRow={onEditRow}
            onDuplicateRow={onDuplicateRow}
            onDeleteRow={onDeleteRow}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            isDeletingRow={isDeletingRow}
          />
        ))}

        {layout.groups.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nessun gruppo. Aggiungi il primo gruppo per iniziare.
          </div>
        )}
      </div>
    </div>
  );
}
