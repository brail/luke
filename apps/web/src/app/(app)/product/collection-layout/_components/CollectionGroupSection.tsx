'use client';

import { AlertTriangle, ChevronDown, ChevronRight, Copy, ImageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { RouterOutputs } from '@luke/api';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
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

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;
type CollectionGroupData = CollectionLayoutData['groups'][number];
type CollectionRowData = CollectionGroupData['rows'][number];

interface CollectionGroupSectionProps {
  group: CollectionGroupData;
  canUpdate: boolean;
  hiddenColumns: string[];
  onAddRow: (groupId: string) => void;
  onEditRow: (row: CollectionRowData) => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string, lineName: string) => void;
  onRenameGroup: (group: CollectionGroupData) => void;
  onDeleteGroup: (groupId: string, groupName: string) => void;
  isDeletingRow?: boolean;
}

const PROGRESS_BADGE: Record<string, { label: string; className: string }> = {
  '01 - FASE DI DESIGN': {
    label: 'DESIGN',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  '02 - COSTRUZIONE OK': {
    label: 'COSTR. OK',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  '03 - MODELLERIA OK': {
    label: 'MODELL. OK',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  '04 - RENDERING FATTI': {
    label: 'RENDERING',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  '05 - SPEC SHEETS PRONTE': {
    label: 'SPEC SHEETS',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  '06 - SMS LANCIATI': {
    label: 'SMS LANCIATI',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
};

const STATUS_LABELS: Record<string, string> = {
  CARRY_OVER: 'C/O',
  NEW: 'New',
};

function skuRatioVariant(actual: number, budget: number | null | undefined) {
  if (!budget) return null;
  const ratio = actual / budget;
  if (ratio >= 1) return 'destructive' as const;
  if (ratio >= 0.9) return 'warning' as const;
  return 'muted' as const;
}

export function CollectionGroupSection({
  group,
  canUpdate,
  hiddenColumns,
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

  const skuTotal = group.rows.reduce((sum, r) => sum + r.skuForecast, 0);
  const qtyTotal = group.rows.reduce((sum, r) => sum + r.qtyForecast, 0);
  const skuVariant = skuRatioVariant(skuTotal, group.skuBudget);

  const show = (key: string) => !hiddenColumns.includes(key);

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Group header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
        <button
          className="flex items-center gap-2 text-left flex-1 min-w-0"
          onClick={() => setIsExpanded(v => !v)}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-semibold text-sm">{group.name}</span>
          <span className="text-xs text-muted-foreground">
            {group.rows.length} righe
          </span>
          {/* SKU budget indicator */}
          {skuVariant ? (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${
                skuVariant === 'destructive'
                  ? 'text-destructive'
                  : skuVariant === 'warning'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
              }`}
            >
              · {skuTotal} / {group.skuBudget} SKU
              {skuVariant === 'destructive' && (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              · {skuTotal} SKU
            </span>
          )}
          <span className="text-xs text-muted-foreground">· {qtyTotal} paia</span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {canUpdate && (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onAddRow(group.id)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Aggiungi riga</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRenameGroup(group)}
                    >
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
        <div className="overflow-x-auto">
          {group.rows.length === 0 ? (
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
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/10">
                  <TableHead className="w-8 text-center">#</TableHead>
                  {show('foto') && <TableHead className="w-24">Foto</TableHead>}
                  <TableHead>Linea</TableHead>
                  {show('gender') && <TableHead>Gender</TableHead>}
                  {show('supplier') && <TableHead>Fornitore</TableHead>}
                  {show('productCategory') && <TableHead>Categoria</TableHead>}
                  {show('strategy') && <TableHead>Strategy</TableHead>}
                  {show('status') && <TableHead>Status</TableHead>}
                  {show('styleStatus') && <TableHead>Style St.</TableHead>}
                  {show('progress') && <TableHead>Progress</TableHead>}
                  {show('designer') && <TableHead>Designer</TableHead>}
                  {show('dutyCategory') && <TableHead>Duty</TableHead>}
                  <TableHead className="text-right">SKU</TableHead>
                  {show('qtyForecast') && <TableHead className="text-right">Qty</TableHead>}
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((row, idx) => {
                  const progressBadge = row.progress
                    ? PROGRESS_BADGE[row.progress]
                    : null;

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
                        <TableCell>
                          {row.pictureUrl ? (
                            <img
                              src={row.pictureUrl}
                              alt={row.line}
                              className="h-16 w-20 rounded object-contain border bg-muted/5"
                            />
                          ) : (
                            <div className="h-16 w-20 rounded border border-dashed flex items-center justify-center bg-muted/30">
                              <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="font-medium text-sm">
                        {row.line}
                      </TableCell>
                      {show('gender') && (
                        <TableCell className="text-sm text-muted-foreground">
                          {row.gender}
                        </TableCell>
                      )}
                      {show('supplier') && (
                        <TableCell className="text-sm text-muted-foreground">
                          {row.supplier}
                        </TableCell>
                      )}
                      {show('productCategory') && (
                        <TableCell className="text-sm text-muted-foreground">
                          {row.productCategory}
                        </TableCell>
                      )}
                      {show('strategy') && (
                        <TableCell>
                          {row.strategy && (
                            <Badge
                              variant={
                                row.strategy === 'INNOVATION'
                                  ? 'default'
                                  : 'secondary'
                              }
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
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${progressBadge.className}`}
                            >
                              {progressBadge.label}
                            </span>
                          )}
                        </TableCell>
                      )}
                      {show('designer') && (
                        <TableCell className="text-sm text-muted-foreground">
                          {row.designer}
                        </TableCell>
                      )}
                      {show('dutyCategory') && (
                        <TableCell className="text-sm text-muted-foreground">
                          {row.dutyCategory}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-medium tabular-nums text-sm">
                        {row.skuForecast}
                      </TableCell>
                      {show('qtyForecast') && (
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {row.qtyForecast}
                        </TableCell>
                      )}
                      <TableCell onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canUpdate ? (
                            <>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => onDuplicateRow(row.id)}
                                    >
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
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled
                                    className="opacity-50 cursor-not-allowed"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Non hai i permessi per eliminare righe
                                </TooltipContent>
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

      {/* Confirm delete row */}
      <ConfirmDialog
        open={!!deleteRow}
        onOpenChange={open => {
          if (!open) setDeleteRow(null);
        }}
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

      {/* Confirm delete group */}
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
