'use client';

import {
  ChevronDown,
  ChevronUp,
  Star,
  Pencil,
  Trash2,
  Plus,
} from 'lucide-react';
import { useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import type { PricingParameterSetInput } from '@luke/core';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '../../../../../components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip';
import { usePermission } from '../../../../../hooks/usePermission';

import { ParameterSetDialog } from './ParameterSetDialog';

type PricingParameterSet =
  RouterOutputs['pricing']['parameterSets']['list'][number];

interface ParameterSetPanelProps {
  sets: PricingParameterSet[];
  selectedSetId: string | null;
  onSelectSet: (id: string) => void;
  onCreateSet: (data: PricingParameterSetInput) => void;
  onUpdateSet: (id: string, data: PricingParameterSetInput) => void;
  onDeleteSet: (id: string) => void;
  onSetDefault: (id: string) => void;
  isLoading?: boolean;
}

function calculateCompanyMultiplier(optimalMargin: number) {
  if (optimalMargin <= 0 || optimalMargin >= 100) return 0;
  return Math.round((1 / (1 - optimalMargin / 100)) * 100) / 100;
}

function buildRows(set: PricingParameterSet) {
  return [
    { label: 'Valuta acquisto', value: set.purchaseCurrency },
    { label: 'Valuta vendita', value: set.sellingCurrency },
    { label: 'Controllo qualità', value: `${set.qualityControlPercent}%` },
    {
      label: 'Trasporto + assicurazione',
      value: `${set.transportInsuranceCost.toFixed(2)} ${set.purchaseCurrency}`,
    },
    { label: 'Dazio', value: `${set.duty}%` },
    { label: 'Tasso di cambio', value: set.exchangeRate.toFixed(4) },
    {
      label: 'Costi accessori Italia',
      value: `${set.italyAccessoryCosts.toFixed(2)} ${set.sellingCurrency}`,
    },
    {
      label: 'Stampi',
      value: `${set.tools.toFixed(2)} ${set.purchaseCurrency}`,
    },
    {
      label: 'Moltiplicatore retail',
      value: `×${set.retailMultiplier.toFixed(2)}`,
    },
    { label: 'Margine target', value: `${set.optimalMargin}%` },
    {
      label: 'Moltiplicatore aziendale',
      value: `×${calculateCompanyMultiplier(set.optimalMargin).toFixed(2)}`,
    },
  ];
}

export function ParameterSetPanel({
  sets,
  selectedSetId,
  onSelectSet,
  onCreateSet,
  onUpdateSet,
  onDeleteSet,
  onSetDefault,
  isLoading = false,
}: ParameterSetPanelProps) {
  const { can } = usePermission();
  const canUpdate = can('pricing:update');

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<PricingParameterSet | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<PricingParameterSet | null>(
    null
  );

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Pulsante nuova variante */}
      <div className="flex justify-end">
        {canUpdate ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreateDialogOpen(true)}
            disabled={isLoading}
          >
            <Plus className="h-4 w-4 mr-1" />
            Nuova variante
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  className="opacity-50 cursor-not-allowed"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Nuova variante
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Non hai i permessi per creare parametri
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Lista set */}
      <div className="space-y-2">
        {sets.map(set => {
          const isSelected = set.id === selectedSetId;
          const isExpanded = expandedIds.has(set.id);
          const rows = buildRows(set);

          return (
            <div
              key={set.id}
              className={`border rounded-md transition-colors ${
                isSelected ? 'border-primary/40 bg-primary/5' : ''
              }`}
            >
              {/* Riga header del set */}
              <div
                className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-accent/40 rounded-md"
                onClick={() => onSelectSet(set.id)}
              >
                <span className="font-medium text-sm flex-1">{set.name}</span>

                <div className="flex items-center gap-1.5">
                  {set.isDefault && (
                    <Badge variant="secondary" className="text-xs">
                      Default
                    </Badge>
                  )}
                  {isSelected && (
                    <Badge
                      variant="outline"
                      className="text-xs text-primary border-primary/40"
                    >
                      In uso
                    </Badge>
                  )}
                </div>

                {/* Azioni: stopPropagation per non triggerare onSelectSet */}
                <div
                  className="flex items-center gap-1"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Imposta default */}
                  {canUpdate && !set.isDefault && sets.length > 1 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onSetDefault(set.id)}
                            disabled={isLoading}
                          >
                            <Star className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Imposta come default</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Modifica */}
                  {canUpdate ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditingSet(set)}
                      disabled={isLoading}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-50 cursor-not-allowed"
                            disabled
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Non hai i permessi per modificare i parametri
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Elimina (solo se più di un set) */}
                  {sets.length > 1 &&
                    (canUpdate ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(set)}
                              disabled={isLoading}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Elimina variante</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-50 cursor-not-allowed"
                              disabled
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Non hai i permessi per eliminare le varianti
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                </div>

                {/* Expand toggle */}
                <button
                  type="button"
                  className="flex items-center justify-center h-7 w-7 rounded hover:bg-accent"
                  onClick={e => {
                    e.stopPropagation();
                    toggleExpand(set.id);
                  }}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>

              {/* Dettagli espandibili */}
              {isExpanded && (
                <div className="border-t px-2 pb-2">
                  <Table>
                    <TableBody>
                      {rows.map(row => (
                        <TableRow key={row.label}>
                          <TableCell className="text-muted-foreground text-sm w-1/2 py-2">
                            {row.label}
                          </TableCell>
                          <TableCell className="font-medium text-sm py-2">
                            {row.value}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Dialog creazione */}
      <ParameterSetDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        mode="create"
        onSubmit={data => {
          onCreateSet(data);
          setIsCreateDialogOpen(false);
        }}
        isLoading={isLoading}
      />

      {/* Dialog modifica */}
      {editingSet && (
        <ParameterSetDialog
          open={!!editingSet}
          onOpenChange={open => {
            if (!open) setEditingSet(null);
          }}
          mode="edit"
          initialData={editingSet}
          onSubmit={(data, makeDefault) => {
            onUpdateSet(editingSet.id, data);
            if (makeDefault && !editingSet.isDefault) onSetDefault(editingSet.id);
            setEditingSet(null);
          }}
          isLoading={isLoading}
        />
      )}
      {/* Dialog conferma eliminazione */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}
        title="Elimina variante"
        description={`Sei sicuro di voler eliminare la variante "${deleteTarget?.name}"? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => {
          if (deleteTarget) onDeleteSet(deleteTarget.id);
        }}
        isLoading={isLoading}
      />
    </div>
  );
}
