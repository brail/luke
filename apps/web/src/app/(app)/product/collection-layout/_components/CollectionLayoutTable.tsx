'use client';

import { AlertTriangle, Download, FileSpreadsheet, FileText, Layers, LoaderCircle, Maximize2, Minimize2, Plus, RotateCcw, Search, Settings2 } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import {
  COLLECTION_COLUMNS_DEFAULT_HIDDEN,
  COLLECTION_COLUMNS_MAX_VISIBLE,
  COLLECTION_TABLE_COLUMNS,
  formatMarginPct,
  type CollectionColumnKey,
} from '@luke/core';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../../../components/ui/alert-dialog';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../../components/ui/dropdown-menu';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../../components/ui/popover';
import { bandBadgeStyle } from '../../../../../lib/alertBandStyle';
import { criticalityBandOptions, NO_CRITICALITY } from '../../../../../lib/criticalityBands';
import { trpc } from '../../../../../lib/trpc';
import { computeWeightedMargin } from '../../_shared/pricingCalc';

import { AssignPlanningGroupDialog } from './AssignPlanningGroupDialog';
import { CollectionGroupSection } from './CollectionGroupSection';

import type { PricingParameterSet } from '../../_shared/pricingCalc';

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;

/** The saved hidden columns, or the defaults when none are saved (the API reads an invalid value as none). */
function getHiddenColumns(layout: CollectionLayoutData): CollectionColumnKey[] {
  return layout.hiddenColumns ?? [...COLLECTION_COLUMNS_DEFAULT_HIDDEN];
}

type CollectionGroupData = CollectionLayoutData['groups'][number];
type CollectionRowData = CollectionGroupData['rows'][number];

interface CollectionLayoutTableProps {
  layout: CollectionLayoutData;
  canUpdate: boolean;
  parameterSets: PricingParameterSet[];
  onAddGroup: () => void;
  onAddRow: (groupId: string) => void;
  /** Opens a row, with the ids of the rows shown, in board order: the editor's previous/next. */
  onEditRow: (row: CollectionRowData, rowIds: string[]) => void;
  /** Duplicates a row; `includeQuotations` is asked only when the row has quotations (#56). */
  onDuplicateRow: (rowId: string, includeQuotations: boolean) => void;
  onDeleteRow: (rowId: string, lineName: string) => void;
  onRenameGroup: (group: CollectionGroupData) => void;
  onDeleteGroup: (groupId: string, groupName: string) => void;
  onUpdateSettings: (settings: { hiddenColumns?: CollectionColumnKey[] | null }) => void;
  isDeletingRow?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onExportXlsx?: (filteredRowIds?: string[]) => void;
  isExportingXlsx?: boolean;
  onExportPdf?: (filteredRowIds?: string[]) => void;
  isExportingPdf?: boolean;
  readOnly?: boolean;
  /** Offered beside the empty message when the layout has no groups (hidden in read-only mode). */
  emptyAction?: ReactNode;
}

/**
 * Top-level collection layout table that orchestrates groups, toolbar, and exports.
 *
 * Renders a `CollectionGroupSection` for each group and a persistent toolbar
 * with column-visibility controls, full-screen toggle, search, and export
 * buttons (XLSX and PDF). Column visibility is persisted via `onUpdateSettings`.
 *
 * @param layout - Full collection layout including groups and hiddenColumns setting.
 * @param parameterSets - Pricing parameter sets forwarded to each group section.
 * @param onUpdateSettings - Called when the user changes column visibility.
 * @param readOnly - Disables all mutation controls when true.
 */
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
  readOnly = false,
  emptyAction,
}: CollectionLayoutTableProps) {
  const [search, setSearch] = useState('');
  const [criticalityFilter, setCriticalityFilter] = useState<string[]>([]);
  // Same staleness as the rows' bands (`criticalityForLayout`), so a renamed band reaches both together.
  const { data: thresholds } = trpc.phaseAlert.thresholds.useQuery(undefined, { staleTime: 60 * 1000 });
  const criticalityOptions = useMemo(() => (thresholds ? criticalityBandOptions(thresholds) : []), [thresholds]);
  // A chosen band renamed or removed since would hide every row with no box left to untick: it drops out.
  const activeCriticalityFilter = useMemo(
    () => criticalityFilter.filter(label => label === NO_CRITICALITY || criticalityOptions.some(o => o.label === label)),
    [criticalityFilter, criticalityOptions],
  );
  const criticalityItem = (label: string, content: ReactNode) => (
    <DropdownMenuCheckboxItem
      key={label}
      checked={activeCriticalityFilter.includes(label)}
      onCheckedChange={checked => setCriticalityFilter(prev => (checked ? [...prev, label] : prev.filter(l => l !== label)))}
      // Keep the menu open: several bands are chosen in a row.
      onSelect={e => e.preventDefault()}
    >
      {content}
    </DropdownMenuCheckboxItem>
  );
  const [columnsPopoverOpen, setColumnsPopoverOpen] = useState(false);
  const [exportFilteredOnly, setExportFilteredOnly] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const filteredRowIdsByGroup = useRef<Map<string, string[]>>(new Map());
  // A row with quotations asks whether its copy takes them (#56); one without duplicates at once.
  // The row outlives the question, so the closing dialog keeps its text.
  const [duplicateAsk, setDuplicateAsk] = useState<CollectionRowData | null>(null);
  const [isDuplicateAskOpen, setIsDuplicateAskOpen] = useState(false);
  const withQuotationsRef = useRef<HTMLButtonElement>(null);
  const duplicateRow = (row: CollectionRowData) => {
    if (row.quotations.length === 0) return onDuplicateRow(row.id, true);
    setDuplicateAsk(row);
    setIsDuplicateAskOpen(true);
  };
  const answerDuplicate = (includeQuotations: boolean) => {
    if (duplicateAsk) onDuplicateRow(duplicateAsk.id, includeQuotations);
    setIsDuplicateAskOpen(false);
  };

  const toggleRowSelection = useCallback((rowId: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const selectAllRows = useCallback((ids: string[], checked: boolean) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const handleFilteredRowIdsChange = useCallback((groupId: string, ids: string[]) => {
    filteredRowIdsByGroup.current.set(groupId, ids);
  }, []);

  // In board order: the groups' order, then each group's filter and sort.
  const getAllFilteredRowIds = () => layout.groups.flatMap(g => filteredRowIdsByGroup.current.get(g.id) ?? []);

  // Columns saved in DB — used for the popover and normal mode rendering
  const hiddenColumns = getHiddenColumns(layout);
  // In fullscreen all columns are visible; normal mode respects saved preferences
  const effectiveHiddenColumns = isFullscreen ? [] : hiddenColumns;

  const hasActiveToolbarFilters = search !== '' || activeCriticalityFilter.length > 0;

  const totalRows = layout.groups.reduce((sum, g) => sum + g.rows.length, 0);
  const totalSku = layout.groups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + (r.skuForecast ?? 0), 0),
    0
  );
  const totalQty = layout.groups.reduce(
    (sum, g) => sum + g.rows.reduce((s, r) => s + (r.qtyForecast ?? 0), 0),
    0
  );
  const allRows = layout.groups.flatMap(g => g.rows);
  const totalWeightedMargin = computeWeightedMargin(allRows, parameterSets);

  const visibleCount = COLLECTION_TABLE_COLUMNS.length - hiddenColumns.length;

  const layoutSkuBudget = layout.groups.some(g => g.skuBudget != null)
    ? layout.groups.reduce((sum, g) => sum + (g.skuBudget ?? 0), 0)
    : null;

  const toggleColumn = (key: CollectionColumnKey, checked: boolean) => {
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
            <span className="font-medium">mrg {formatMarginPct(totalWeightedMargin)}</span>
          </>
        )}

        {hasActiveToolbarFilters && (
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">Filtri attivi</Badge>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => { setSearch(''); setCriticalityFilter([]); }}>
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

        {/* Criticality filter (#53): the configured bands by name, plus rows with no band; OR within, AND with the rest. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <AlertTriangle className="h-4 w-4 mr-1" />
              Criticità{activeCriticalityFilter.length > 0 && ` (${activeCriticalityFilter.length})`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {criticalityOptions.map(band => criticalityItem(
              band.label,
              // Band color and emphasis come from AppConfig (admin-configured hex), not from design tokens.
              <Badge variant="outline" style={bandBadgeStyle(band)}>{band.label}</Badge>,
            ))}
            {criticalityItem(NO_CRITICALITY, 'Senza criticità')}
          </DropdownMenuContent>
        </DropdownMenu>

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
                  Massimo {COLLECTION_COLUMNS_MAX_VISIBLE} colonne. Deselezionane una per aggiungerne un&apos;altra.
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
                  ? <><LoaderCircle className="h-4 w-4 mr-1 animate-spin" />Esportando…</>
                  : <><Download className="h-4 w-4 mr-1" />Esporta</>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={exportFilteredOnly}
                onCheckedChange={setExportFilteredOnly}
              >
                Solo selezione filtrata
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {onExportXlsx && (
                <DropdownMenuItem
                  onClick={() => onExportXlsx(exportFilteredOnly ? getAllFilteredRowIds() : undefined)}
                  disabled={isExportingXlsx}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Excel (.xlsx)
                </DropdownMenuItem>
              )}
              {onExportPdf && (
                <DropdownMenuItem
                  onClick={() => onExportPdf(exportFilteredOnly ? getAllFilteredRowIds() : undefined)}
                  disabled={isExportingPdf}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  PDF (A3)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canUpdate && !readOnly && selectedRowIds.size > 0 && (
          <Button variant="outline" size="sm" onClick={() => setAssignDialogOpen(true)}>
            <Layers className="h-4 w-4 mr-1" />
            Assegna a gruppo di pianificazione ({selectedRowIds.size})
          </Button>
        )}

        {canUpdate && !readOnly && (
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
            canUpdate={canUpdate && !readOnly}
            hiddenColumns={effectiveHiddenColumns}
            parameterSets={parameterSets}
            searchQuery={search}
            criticalityFilter={activeCriticalityFilter}
            onAddRow={onAddRow}
            onEditRow={row => onEditRow(row, getAllFilteredRowIds())}
            onDuplicateRow={duplicateRow}
            onDeleteRow={onDeleteRow}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            isDeletingRow={isDeletingRow}
            onFilteredRowIdsChange={ids => handleFilteredRowIdsChange(group.id, ids)}
            selectedRowIds={selectedRowIds}
            onToggleRowSelection={toggleRowSelection}
            onSelectAllRows={selectAllRows}
          />
        ))}

        {layout.groups.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground space-y-4">
            <p>Nessun gruppo. Aggiungi il primo gruppo per iniziare.</p>
            {!readOnly && emptyAction}
          </div>
        )}
      </div>

      <AssignPlanningGroupDialog
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        onAssigned={() => { setAssignDialogOpen(false); setSelectedRowIds(new Set()); }}
        brandId={layout.brandId}
        seasonId={layout.seasonId}
        collectionLayoutId={layout.id}
        rowIds={[...selectedRowIds]}
      />

      <AlertDialog open={isDuplicateAskOpen} onOpenChange={setIsDuplicateAskOpen}>
        <AlertDialogContent
          // The default answer is the copy with its quotations: Enter takes it.
          onOpenAutoFocus={e => { e.preventDefault(); withQuotationsRef.current?.focus(); }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Duplica riga</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicateAsk?.quotations.length === 1
                ? 'La riga ha 1 quotazione. Duplicarla insieme alla riga?'
                : `La riga ha ${duplicateAsk?.quotations.length ?? 0} quotazioni. Duplicarle insieme alla riga?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <Button type="button" variant="outline" onClick={() => answerDuplicate(false)}>
              Senza quotazioni
            </Button>
            <Button type="button" ref={withQuotationsRef} onClick={() => answerDuplicate(true)}>
              Con le quotazioni
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
