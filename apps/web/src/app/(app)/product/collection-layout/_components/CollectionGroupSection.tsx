'use client';

import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronRight, Copy, FileText, ImageIcon, ListFilter, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import {
  COLLECTION_GENDER,
  COLLECTION_PROGRESS,
  COLLECTION_STATUS,
  COLLECTION_STRATEGY,
} from '@luke/core';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '../../../../../components/ui/command';
import { Input } from '../../../../../components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../../components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip';
import { cn } from '../../../../../lib/utils';
import { computeRowMargin, computeWeightedMargin } from '../_hooks/usePricingCalc';

import type { PricingParameterSet } from '../_hooks/usePricingCalc';

// ─── Types ────────────────────────────────────────────────────────────────────

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;
type CollectionGroupData = CollectionLayoutData['groups'][number];
type CollectionRowData = CollectionGroupData['rows'][number];

// ─── Row photo with fallback ──────────────────────────────────────────────────

function RowPhoto({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return (
    <div className="h-[88px] w-[110px] rounded border border-dashed flex items-center justify-center bg-muted/30">
      <ImageIcon className="h-4 w-4 text-muted-foreground" />
    </div>
  );
  return (
    <img
      src={src}
      alt={alt}
      className="h-[88px] w-[110px] rounded object-contain border bg-muted/5"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Filterable header (sort + filter popover) ────────────────────────────────

interface FilterOption { value: string; label: string; }

interface FilterableHeaderProps {
  col: string;
  label: string;
  type: 'enum' | 'text' | 'number';
  sortCol: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  filterValue?: string;
  onFilter: (col: string, value: string | null) => void;
  options?: FilterOption[];
  allowNone?: boolean;
  className?: string;
  operator?: 'gte' | 'lte';
  onOperatorChange?: (col: string, op: 'gte' | 'lte') => void;
}

function FilterableHeader({
  col, label, type, sortCol, sortDir, onSort,
  filterValue, onFilter, options = [], allowNone, className,
  operator = 'gte', onOperatorChange,
}: FilterableHeaderProps) {
  const [open, setOpen] = useState(false);
  const sortActive = sortCol === col;
  const filterActive = !!filterValue;

  const handleEnumSelect = (value: string | null) => {
    onFilter(col, value);
    setOpen(false);
  };

  return (
    <TableHead className={className}>
      <div className="flex items-center gap-0.5">
        <button
          className={cn(
            'flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground',
            sortActive ? 'text-foreground' : 'text-muted-foreground'
          )}
          onClick={() => onSort(col)}
        >
          {label}
          {sortActive
            ? sortDir === 'asc'
              ? <ArrowUp className="h-3 w-3" />
              : <ArrowDown className="h-3 w-3" />
            : <ArrowUpDown className="h-3 w-3 opacity-40" />}
        </button>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'ml-0.5 h-5 w-5',
                filterActive ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'
              )}
              onClick={e => e.stopPropagation()}
            >
              <ListFilter className="h-3 w-3" />
            </Button>
          </PopoverTrigger>

          {type === 'enum' && (
            <PopoverContent align="start" className="w-44 p-0">
              <Command>
                <CommandList>
                  <CommandGroup>
                    <CommandItem onSelect={() => handleEnumSelect(null)}>
                      <Check className={cn('mr-2 h-4 w-4', !filterValue ? 'opacity-100' : 'opacity-0')} />
                      Tutti
                    </CommandItem>
                    {allowNone && (
                      <CommandItem onSelect={() => handleEnumSelect('_none')}>
                        <Check className={cn('mr-2 h-4 w-4', filterValue === '_none' ? 'opacity-100' : 'opacity-0')} />
                        <span className="text-muted-foreground">— Nessuno —</span>
                      </CommandItem>
                    )}
                    {options.map(opt => (
                      <CommandItem key={opt.value} onSelect={() => handleEnumSelect(opt.value)}>
                        <Check className={cn('mr-2 h-4 w-4', filterValue === opt.value ? 'opacity-100' : 'opacity-0')} />
                        {opt.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          )}

          {type === 'text' && (
            <PopoverContent align="start" className="w-48 p-2">
              <Input
                autoFocus
                placeholder="Filtra…"
                value={filterValue === '_none' ? '' : (filterValue ?? '')}
                onChange={e => onFilter(col, e.target.value || null)}
                className="h-8 text-sm"
              />
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'mt-1 h-7 w-full justify-start px-2 text-xs',
                  filterValue === '_none' ? 'text-primary font-medium' : 'text-muted-foreground'
                )}
                onClick={() => onFilter(col, filterValue === '_none' ? null : '_none')}
              >
                — Nessuno —
              </Button>
              {filterValue && filterValue !== '_none' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                  onClick={() => onFilter(col, null)}
                >
                  Rimuovi filtro
                </Button>
              )}
            </PopoverContent>
          )}

          {type === 'number' && (
            <PopoverContent align="start" className="w-40 p-2">
              <div className="flex items-center gap-1.5">
                {onOperatorChange ? (
                  <button
                    type="button"
                    className="text-xs font-mono text-muted-foreground hover:text-foreground w-5 shrink-0 text-center"
                    onClick={() => onOperatorChange(col, operator === 'gte' ? 'lte' : 'gte')}
                  >
                    {operator === 'gte' ? '≥' : '≤'}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0">≥</span>
                )}
                <Input
                  autoFocus
                  type="number"
                  min={0}
                  placeholder="0"
                  value={filterValue ?? ''}
                  onChange={e => onFilter(col, e.target.value || null)}
                  onFocus={e => e.target.select()}
                  className="h-8 text-sm"
                />
              </div>
              {filterValue && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                  onClick={() => onFilter(col, null)}
                >
                  Rimuovi filtro
                </Button>
              )}
            </PopoverContent>
          )}
        </Popover>
      </div>
    </TableHead>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROGRESS_BADGE: Record<string, { label: string; className: string }> = {
  '01 - FASE DI DESIGN': { label: 'DESIGN', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  '02 - COSTRUZIONE OK': { label: 'COSTR. OK', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  '03 - MODELLERIA OK': { label: 'MODELL. OK', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  '04 - RENDERING FATTI': { label: 'RENDERING', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  '05 - SPEC SHEETS PRONTE': { label: 'SPEC SHEETS', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  '06 - SMS LANCIATI': { label: 'SMS LANCIATI', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
};

const STATUS_LABELS: Record<string, string> = { CARRY_OVER: 'C/O', NEW: 'New' };

const NOTE_FIELDS: { key: keyof CollectionRowData; label: string }[] = [
  { key: 'styleNotes',    label: 'Stile' },
  { key: 'materialNotes', label: 'Materiale' },
  { key: 'colorNotes',    label: 'Colore' },
  { key: 'toolingNotes',  label: 'Tooling' },
];

const GENDER_OPTIONS: FilterOption[] = COLLECTION_GENDER.map(v => ({ value: v, label: v }));
const STRATEGY_OPTIONS: FilterOption[] = COLLECTION_STRATEGY.map(v => ({ value: v, label: v }));
const STATUS_OPTIONS: FilterOption[] = COLLECTION_STATUS.map(v => ({ value: v, label: STATUS_LABELS[v] ?? v }));
const PROGRESS_OPTIONS: FilterOption[] = COLLECTION_PROGRESS.map(v => ({
  value: v,
  label: PROGRESS_BADGE[v]?.label ?? v,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function skuRatioVariant(actual: number, budget: number | null | undefined) {
  if (!budget) return null;
  const ratio = actual / budget;
  if (ratio >= 1) return 'destructive' as const;
  if (ratio >= 0.9) return 'warning' as const;
  return 'muted' as const;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CollectionGroupSectionProps {
  group: CollectionGroupData;
  canUpdate: boolean;
  hiddenColumns: string[];
  parameterSets: PricingParameterSet[];
  searchQuery?: string;
  onAddRow: (groupId: string) => void;
  onEditRow: (row: CollectionRowData) => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string, lineName: string) => void;
  onRenameGroup: (group: CollectionGroupData) => void;
  onDeleteGroup: (groupId: string, groupName: string) => void;
  isDeletingRow?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CollectionGroupSection({
  group,
  canUpdate,
  hiddenColumns,
  parameterSets,
  searchQuery = '',
  onAddRow,
  onEditRow,
  onDuplicateRow,
  onDeleteRow,
  onRenameGroup,
  onDeleteGroup,
  isDeletingRow = false,
}: CollectionGroupSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [deleteRow, setDeleteRow] = useState<CollectionRowData | null>(null);
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(false);

  // Per-group sort/filter state
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [columnFilterOperators, setColumnFilterOperators] = useState<Record<string, 'gte' | 'lte'>>({});

  const hasActiveFilters = !!sortCol || Object.keys(columnFilters).length > 0;

  const resetFilters = () => {
    setSortCol(null);
    setSortDir('asc');
    setColumnFilters({});
    setColumnFilterOperators({});
  };

  const handleOperatorChange = (col: string, op: 'gte' | 'lte') => {
    setColumnFilterOperators(prev => ({ ...prev, [col]: op }));
  };

  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortCol(null);
        setSortDir('asc');
      }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const handleFilter = (col: string, value: string | null) => {
    setColumnFilters(prev => {
      if (!value) {
        const { [col]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [col]: value };
    });
  };

  const filteredRows = useMemo(() => {
    const textMatch = (v: string | null | undefined, f: string) => {
      if (f === '_none') return !v || v.trim() === '';
      return (v ?? '').toLowerCase().includes(f.toLowerCase());
    };
    const enumMatch = (v: string | null | undefined, f: string) =>
      f === '_none' ? !v : v === f;
    const numberMatch = (v: number, f: string, op: 'gte' | 'lte' = 'gte') => {
      const t = Number(f);
      return isNaN(t) || (op === 'gte' ? v >= t : v <= t);
    };

    let rows = group.rows.filter(row => {
      const vendorName = row.vendor?.nickname ?? row.vendor?.name ?? null;
      if (searchQuery && !textMatch(row.line, searchQuery) && !textMatch(vendorName, searchQuery)) return false;
      if (columnFilters.line && !textMatch(row.line, columnFilters.line)) return false;
      if (columnFilters.article && !textMatch(row.article, columnFilters.article)) return false;
      if (columnFilters.supplier && !textMatch(vendorName, columnFilters.supplier)) return false;
      if (columnFilters.productCategory && !textMatch(row.productCategory, columnFilters.productCategory)) return false;
      if (columnFilters.designer && !textMatch(row.designer, columnFilters.designer)) return false;
      if (columnFilters.gender && !enumMatch(row.gender, columnFilters.gender)) return false;
      if (columnFilters.strategy && !enumMatch(row.strategy, columnFilters.strategy)) return false;
      if (columnFilters.status && !enumMatch(row.status, columnFilters.status)) return false;
      if (columnFilters.styleStatus && !enumMatch(row.styleStatus, columnFilters.styleStatus)) return false;
      if (columnFilters.progress && !enumMatch(row.progress, columnFilters.progress)) return false;
      if (columnFilters.skuForecast && !numberMatch(row.skuForecast, columnFilters.skuForecast)) return false;
      if (columnFilters.qtyForecast && !numberMatch(row.qtyForecast, columnFilters.qtyForecast)) return false;
      if (columnFilters.margin) {
        const m = computeRowMargin(row, parameterSets);
        const threshold = Number(columnFilters.margin);
        const op = columnFilterOperators.margin ?? 'gte';
        if (!m || isNaN(threshold)) return false;
        if (op === 'gte' ? m.margin * 100 < threshold : m.margin * 100 > threshold) return false;
      }
      return true;
    });

    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        let va: number | string;
        let vb: number | string;
        if (sortCol === 'margin') {
          va = computeRowMargin(a, parameterSets)?.margin ?? -Infinity;
          vb = computeRowMargin(b, parameterSets)?.margin ?? -Infinity;
        } else {
          va = (a as Record<string, unknown>)[sortCol] as number | string ?? '';
          vb = (b as Record<string, unknown>)[sortCol] as number | string ?? '';
        }
        const cmp = typeof va === 'number'
          ? (va as number) - (vb as number)
          : String(va).localeCompare(String(vb), 'it');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return rows;
  }, [group.rows, searchQuery, columnFilters, columnFilterOperators, sortCol, sortDir, parameterSets]);

  const skuTotal = group.rows.reduce((sum, r) => sum + r.skuForecast, 0);
  const qtyTotal = group.rows.reduce((sum, r) => sum + r.qtyForecast, 0);
  const skuVariant = skuRatioVariant(skuTotal, group.skuBudget);
  const groupWeightedMargin = computeWeightedMargin(group.rows, parameterSets);

  const show = (key: string) => !hiddenColumns.includes(key);

  const sortProps = { sortCol, sortDir, onSort: handleSort };
  const filterProps = { onFilter: handleFilter };
  const operatorProps = { onOperatorChange: handleOperatorChange };

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Group header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
        <button
          className="flex items-center gap-2 text-left flex-1 min-w-0"
          onClick={() => setIsExpanded(v => !v)}
        >
          {isExpanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <span className="font-semibold text-sm">{group.name}</span>
          <span className="text-xs text-muted-foreground">{group.rows.length} righe</span>
          {skuVariant ? (
            <span className={cn(
              'inline-flex items-center gap-1 text-xs font-medium',
              skuVariant === 'destructive' ? 'text-destructive' : skuVariant === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
            )}>
              · {skuTotal} / {group.skuBudget} SKU
              {skuVariant === 'destructive' && <AlertTriangle className="h-3.5 w-3.5" />}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">· {skuTotal} SKU</span>
          )}
          <span className="text-xs text-muted-foreground">· {qtyTotal} paia</span>
          {groupWeightedMargin !== null && (
            <span className="text-xs text-muted-foreground">
              · mrg {(groupWeightedMargin * 100).toFixed(1)}%
            </span>
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {hasActiveFilters && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary gap-1"
                    onClick={e => { e.stopPropagation(); resetFilters(); }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Filtri attivi
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset filtri e ordinamento</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {canUpdate && (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={() => onAddRow(group.id)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Aggiungi riga</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={() => onRenameGroup(group)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Modifica gruppo</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteGroupConfirm(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Elimina gruppo</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      {isExpanded && (
        <div>
          {group.rows.length === 0 && !hasActiveFilters && !searchQuery ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nessuna riga in questo gruppo.{' '}
              {canUpdate && (
                <button
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => onAddRow(group.id)}
                >
                  Aggiungine una.
                </button>
              )}
            </div>
          ) : (
            <Table className="min-w-max">
              <TableHeader>
                <TableRow className="bg-muted/10">
                  <TableHead className="w-8 text-center">#</TableHead>
                  {show('foto') && <TableHead className="w-24">Foto</TableHead>}

                  <FilterableHeader col="line" label="Linea" type="text" {...sortProps} {...filterProps} filterValue={columnFilters.line} />

                  {show('article') && (
                    <FilterableHeader col="article" label="Articolo" type="text" {...sortProps} {...filterProps} filterValue={columnFilters.article} allowNone />
                  )}

                  {show('gender') && (
                    <FilterableHeader col="gender" label="Gender" type="enum" {...sortProps} {...filterProps} filterValue={columnFilters.gender} options={GENDER_OPTIONS} />
                  )}
                  {show('supplier') && (
                    <FilterableHeader col="supplier" label="Fornitore" type="text" {...sortProps} {...filterProps} filterValue={columnFilters.supplier} className="w-36" />
                  )}
                  {show('productCategory') && (
                    <FilterableHeader col="productCategory" label="Categoria" type="text" {...sortProps} {...filterProps} filterValue={columnFilters.productCategory} />
                  )}
                  {show('strategy') && (
                    <FilterableHeader col="strategy" label="Strategy" type="enum" {...sortProps} {...filterProps} filterValue={columnFilters.strategy} options={STRATEGY_OPTIONS} allowNone />
                  )}
                  {show('status') && (
                    <FilterableHeader col="status" label="Status" type="enum" {...sortProps} {...filterProps} filterValue={columnFilters.status} options={STATUS_OPTIONS} />
                  )}
                  {show('styleStatus') && (
                    <FilterableHeader col="styleStatus" label="Style St." type="enum" {...sortProps} {...filterProps} filterValue={columnFilters.styleStatus} options={STATUS_OPTIONS} allowNone />
                  )}
                  {show('progress') && (
                    <FilterableHeader col="progress" label="Progress" type="enum" {...sortProps} {...filterProps} filterValue={columnFilters.progress} options={PROGRESS_OPTIONS} allowNone />
                  )}
                  {show('designer') && (
                    <FilterableHeader col="designer" label="Designer" type="text" {...sortProps} {...filterProps} filterValue={columnFilters.designer} />
                  )}

                  <FilterableHeader col="skuForecast" label="SKU" type="number" {...sortProps} {...filterProps} filterValue={columnFilters.skuForecast} className="text-right" />

                  {show('qtyForecast') && (
                    <FilterableHeader col="qtyForecast" label="Qty" type="number" {...sortProps} {...filterProps} filterValue={columnFilters.qtyForecast} className="text-right" />
                  )}
                  {show('margin') && (
                    <FilterableHeader col="margin" label="Mrg %" type="number" {...sortProps} {...filterProps} filterValue={columnFilters.margin} operator={columnFilterOperators.margin ?? 'gte'} {...operatorProps} className="text-right w-20 whitespace-nowrap" />
                  )}
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={20} className="py-8 text-center text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? 'Nessuna riga corrisponde ai filtri applicati.'
                        : 'Nessuna riga corrisponde alla ricerca.'}
                    </TableCell>
                  </TableRow>
                )}
                {filteredRows.map((row, idx) => {
                  const progressBadge = row.progress ? PROGRESS_BADGE[row.progress] : null;

                  return (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => onEditRow(row)}
                    >
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                      {show('foto') && (
                        <TableCell className="py-1 px-2">
                          {row.pictureUrl ? (
                            <RowPhoto src={row.pictureUrl} alt={row.line} />
                          ) : (
                            <div className="h-[88px] w-[110px] rounded border border-dashed flex items-center justify-center bg-muted/30">
                              <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="font-medium text-sm">{row.line}</TableCell>
                      {show('article') && (
                        <TableCell className="text-sm text-muted-foreground">{row.article ?? '—'}</TableCell>
                      )}
                      {show('gender') && (
                        <TableCell className="text-sm text-muted-foreground">{row.gender}</TableCell>
                      )}
                      {show('supplier') && (
                        <TableCell className="w-36 max-w-[9rem] text-sm text-muted-foreground">
                          <span className="block truncate">
                            {row.vendor?.nickname ?? row.vendor?.name ?? '—'}
                          </span>
                        </TableCell>
                      )}
                      {show('productCategory') && (
                        <TableCell className="text-sm text-muted-foreground">{row.productCategory}</TableCell>
                      )}
                      {show('strategy') && (
                        <TableCell>
                          {row.strategy && (
                            <Badge
                              variant={row.strategy === 'INNOVATION' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {row.strategy === 'INNOVATION' ? 'INNOV.' : 'CORE'}
                            </Badge>
                          )}
                        </TableCell>
                      )}
                      {show('status') && (
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {STATUS_LABELS[row.status] ?? row.status}
                          </Badge>
                        </TableCell>
                      )}
                      {show('styleStatus') && (
                        <TableCell>
                          {row.styleStatus && (
                            <Badge variant="outline" className="text-xs">
                              {STATUS_LABELS[row.styleStatus] ?? row.styleStatus}
                            </Badge>
                          )}
                        </TableCell>
                      )}
                      {show('progress') && (
                        <TableCell>
                          {progressBadge && (
                            <span className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                              progressBadge.className
                            )}>
                              {progressBadge.label}
                            </span>
                          )}
                        </TableCell>
                      )}
                      {show('designer') && (
                        <TableCell className="text-sm text-muted-foreground">{row.designer}</TableCell>
                      )}
                      <TableCell className="text-right font-medium tabular-nums text-sm">
                        {row.skuForecast}
                      </TableCell>
                      {show('qtyForecast') && (
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {row.qtyForecast}
                        </TableCell>
                      )}
                      {show('margin') && (
                        <TableCell className="text-right tabular-nums text-sm w-20">
                          {(() => {
                            const m = computeRowMargin(row, parameterSets);
                            if (!m) return <span className="text-muted-foreground/40">—</span>;
                            return (
                              <span className={
                                m.marginStatus === 'green' ? 'text-green-700 dark:text-green-400'
                                : m.marginStatus === 'yellow' ? 'text-amber-600 dark:text-amber-400'
                                : 'text-destructive'
                              }>
                                {(m.margin * 100).toFixed(1)}%
                              </span>
                            );
                          })()}
                        </TableCell>
                      )}
                      <TableCell onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {(() => {
                            const filledNotes = NOTE_FIELDS.filter(f => !!row[f.key]);
                            if (filledNotes.length === 0) return null;
                            return (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                                    <FileText className="h-3.5 w-3.5" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-72 p-3">
                                  <p className="text-xs font-medium text-muted-foreground mb-2">Note — {row.line}</p>
                                  <div className="space-y-2">
                                    {filledNotes.map(f => (
                                      <div key={f.key}>
                                        <p className="text-xs font-medium">{f.label}</p>
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row[f.key] as string}</p>
                                      </div>
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            );
                          })()}
                          {canUpdate ? (
                            <>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" onClick={() => onDuplicateRow(row.id)}>
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Duplica</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setDeleteRow(row)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Elimina</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="sm" disabled className="opacity-50 cursor-not-allowed">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Non hai i permessi per eliminare righe</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteRow}
        onOpenChange={open => { if (!open) setDeleteRow(null); }}
        title="Elimina riga"
        description={`Sei sicuro di voler eliminare la riga "${deleteRow?.line}"? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => {
          if (deleteRow) onDeleteRow(deleteRow.id, deleteRow.line);
          setDeleteRow(null);
        }}
        isLoading={isDeletingRow}
      />

      <ConfirmDialog
        open={deleteGroupConfirm}
        onOpenChange={setDeleteGroupConfirm}
        title="Elimina gruppo"
        description={`Sei sicuro di voler eliminare il gruppo "${group.name}" e tutte le sue righe (${group.rows.length})? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => {
          onDeleteGroup(group.id, group.name);
          setDeleteGroupConfirm(false);
        }}
      />
    </div>
  );
}
