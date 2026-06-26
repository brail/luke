'use client';

import { GripVertical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  COLLECTION_CATALOG_TYPES,
  ISO9001_CATEGORIES,
  type CollectionCatalogType,
  type Iso9001Category,
} from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { cn } from '../../../../lib/utils';

const TYPE_LABELS: Record<CollectionCatalogType, string> = {
  strategy:         'Strategy',
  lineStatus:       'Line Status',
  styleStatus:      'Style Status',
  progress:         'Progress',
  revisionType:     'Tipo revisione',
  pricePositioning: 'Posizionamento Prezzo',
};

type CatalogItem = {
  id: string;
  type: string;
  value: string;
  label: string;
  code: string | null;
  order: number;
  isActive: boolean;
  iso9001Categories: Iso9001Category[];
  expectedMinProgress: string | null;
};

type ItemDialogState = { mode: 'create'; type: CollectionCatalogType } | { mode: 'edit'; item: CatalogItem };

export default function CollectionCatalogPage() {
  const { can } = usePermission();
  const canWrite = can('collection_layout:update');

  const [activeTab, setActiveTab] = useState<CollectionCatalogType>('strategy');
  const [itemDialog, setItemDialog] = useState<ItemDialogState | null>(null);
  const [deletingItem, setDeletingItem] = useState<CatalogItem | null>(null);

  const utils = trpc.useUtils();
  const invalidate = (type: CollectionCatalogType) => {
    void utils.collectionCatalog.listAll.invalidate({ type });
  };

  const { data: items = [], isLoading } = trpc.collectionCatalog.listAll.useQuery(
    { type: activeTab },
    { staleTime: 30 * 1000 },
  );

  const { data: progressItems = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'progress' },
    { staleTime: 5 * 60 * 1000 },
  );

  const createMutation = trpc.collectionCatalog.create.useMutation({
    onSuccess: () => {
      invalidate(activeTab);
      setItemDialog(null);
      toast.success('Opzione aggiunta');
    },
    onError: e => toast.error(getTrpcErrorMessage(e, { CONFLICT: 'Valore già esistente per questo tipo' })),
  });

  const updateMutation = trpc.collectionCatalog.update.useMutation({
    onSuccess: () => {
      invalidate(activeTab);
      setItemDialog(null);
      toast.success('Opzione aggiornata');
    },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const removeMutation = trpc.collectionCatalog.remove.useMutation({
    onSuccess: () => {
      invalidate(activeTab);
      setDeletingItem(null);
      toast.success('Opzione disattivata');
    },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const restoreMutation = trpc.collectionCatalog.restore.useMutation({
    onSuccess: () => { invalidate(activeTab); toast.success('Opzione riattivata'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const isMutating =
    createMutation.isPending || updateMutation.isPending || removeMutation.isPending;

  return (
    <>
      <PageHeader
        title="Collection Catalog"
        description="Opzioni configurabili per il Collection Layout"
      />

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as CollectionCatalogType)}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              {COLLECTION_CATALOG_TYPES.map(t => (
                <TabsTrigger key={t} value={t}>{TYPE_LABELS[t]}</TabsTrigger>
              ))}
            </TabsList>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      disabled={!canWrite}
                      className={cn(!canWrite && 'opacity-50 cursor-not-allowed')}
                      onClick={() => canWrite && setItemDialog({ mode: 'create', type: activeTab })}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Aggiungi opzione
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canWrite && (
                  <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>

          {COLLECTION_CATALOG_TYPES.map(type => (
            <TabsContent key={type} value={type}>
              <div className="mt-4 rounded-lg border bg-card">
                {isLoading ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Caricamento…</div>
                ) : items.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Nessuna opzione configurata. Aggiungi la prima.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2 text-left font-medium">Valore (chiave)</th>
                        <th className="px-3 py-2 text-left font-medium">Label</th>
                        {type === 'revisionType' && (
                          <th className="px-3 py-2 text-left font-medium">Categorie ISO</th>
                        )}
                        <th className="px-3 py-2 text-left font-medium">Stato</th>
                        <th className="w-24 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {(items as CatalogItem[]).map(item => (
                        <tr key={item.id} className={cn('border-b last:border-0', !item.isActive && 'opacity-50')}>
                          <td className="px-3 py-2 text-muted-foreground">
                            <GripVertical className="h-4 w-4" />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{item.value}</td>
                          <td className="px-3 py-2">
                            {item.code
                              ? <span>{item.code} — {item.label}</span>
                              : item.label
                            }
                          </td>
                          {type === 'revisionType' && (
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {(item.iso9001Categories ?? []).map(cat => (
                                  <Badge key={cat} variant="secondary" className="text-xs">{cat}</Badge>
                                ))}
                              </div>
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <Badge variant={item.isActive ? 'default' : 'secondary'}>
                              {item.isActive ? 'Attivo' : 'Inattivo'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {!item.isActive ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className={cn('h-7 w-7', !canWrite && 'opacity-50 cursor-not-allowed')}
                                          disabled={!canWrite || restoreMutation.isPending}
                                          onClick={() => canWrite && restoreMutation.mutate({ id: item.id })}
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" />
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>}
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className={cn('h-7 w-7', !canWrite && 'opacity-50 cursor-not-allowed')}
                                            disabled={!canWrite || isMutating}
                                            onClick={() => canWrite && setItemDialog({ mode: 'edit', item })}
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                        </span>
                                      </TooltipTrigger>
                                      {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>}
                                    </Tooltip>
                                  </TooltipProvider>

                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className={cn('h-7 w-7 text-destructive', !canWrite && 'opacity-50 cursor-not-allowed')}
                                            disabled={!canWrite || isMutating}
                                            onClick={() => canWrite && setDeletingItem(item)}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </span>
                                      </TooltipTrigger>
                                      {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>}
                                    </Tooltip>
                                  </TooltipProvider>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Item dialog */}
      {itemDialog && (
        <CatalogItemDialog
          state={itemDialog}
          progressItems={progressItems as CatalogItem[]}
          onClose={() => setItemDialog(null)}
          onSubmit={(data) => {
            if (itemDialog.mode === 'create') {
              createMutation.mutate({ type: itemDialog.type, ...data });
            } else {
              updateMutation.mutate({ id: itemDialog.item.id, data });
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deletingItem}
        onOpenChange={open => { if (!open) setDeletingItem(null); }}
        title="Disattiva opzione"
        description={`Disattivare "${deletingItem?.label}"? Non sarà più disponibile nei nuovi record, ma i dati esistenti non vengono modificati.`}
        confirmText="Disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deletingItem) removeMutation.mutate({ id: deletingItem.id }); }}
        isLoading={removeMutation.isPending}
      />
    </>
  );
}

// ─── Item Dialog ──────────────────────────────────────────────────────────────

type DialogSubmitData = {
  value: string;
  label: string;
  code?: string | null;
  iso9001Categories?: Iso9001Category[] | null;
  expectedMinProgress?: string | null;
};

function CatalogItemDialog({
  state,
  progressItems,
  onClose,
  onSubmit,
  isLoading,
}: {
  state: ItemDialogState;
  progressItems: CatalogItem[];
  onClose: () => void;
  onSubmit: (data: DialogSubmitData) => void;
  isLoading: boolean;
}) {
  const initial = state.mode === 'edit' ? state.item : null;
  const activeType = state.mode === 'create' ? state.type : state.item.type;

  const [value, setValue] = useState(initial?.value ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [selectedCategories, setSelectedCategories] = useState<Iso9001Category[]>(
    (initial?.iso9001Categories ?? []) as Iso9001Category[]
  );
  const [expectedMinProgress, setExpectedMinProgress] = useState<string>(
    initial?.expectedMinProgress ?? ''
  );

  const isProgress     = activeType === 'progress';
  const isRevisionType = activeType === 'revisionType';

  const canSubmit =
    value.trim().length > 0 &&
    label.trim().length > 0 &&
    (!isRevisionType || selectedCategories.length > 0);

  const toggleCategory = (cat: Iso9001Category) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = () => {
    onSubmit({
      value: value.trim(),
      label: label.trim(),
      code: isProgress ? (code.trim() || null) : null,
      iso9001Categories: isRevisionType ? selectedCategories : null,
      expectedMinProgress: isRevisionType ? (expectedMinProgress || null) : null,
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {state.mode === 'create' ? 'Aggiungi opzione' : 'Modifica opzione'}
            {' '}<span className="text-muted-foreground font-normal text-sm">({TYPE_LABELS[activeType as CollectionCatalogType] ?? activeType})</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat-value">Valore (chiave)</Label>
            <Input
              id="cat-value"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="es. CORE"
              disabled={state.mode === 'edit'}
              autoFocus
            />
            {state.mode === 'create' && (
              <p className="text-xs text-muted-foreground">Stringa identificativa, non modificabile dopo la creazione.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-label">Label visualizzata</Label>
            <Input
              id="cat-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="es. Core"
            />
          </div>

          {isProgress && (
            <div className="space-y-1.5">
              <Label htmlFor="cat-code">Codice (es. 01)</Label>
              <Input
                id="cat-code"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="es. 01"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">Mostrato come "{code || '01'} — {label || 'Label'}"</p>
            </div>
          )}

          {isRevisionType && (
            <>
              <div className="space-y-2">
                <Label>Categorie ISO 9001:2015 <span className="text-destructive">*</span></Label>
                <div className="space-y-1.5">
                  {ISO9001_CATEGORIES.map(cat => (
                    <div key={cat} className="flex items-center gap-2">
                      <Checkbox
                        id={`cat-iso-${cat}`}
                        checked={selectedCategories.includes(cat)}
                        onCheckedChange={() => toggleCategory(cat)}
                      />
                      <label htmlFor={`cat-iso-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                    </div>
                  ))}
                </div>
                {selectedCategories.length === 0 && (
                  <p className="text-xs text-destructive">Selezionare almeno una categoria</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cat-progress">Progress minimo atteso (opzionale)</Label>
                <Select
                  value={expectedMinProgress || '_none'}
                  onValueChange={v => setExpectedMinProgress(v === '_none' ? '' : v)}
                >
                  <SelectTrigger id="cat-progress">
                    <SelectValue placeholder="Nessuno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Nessuno</SelectItem>
                    {progressItems.filter(p => p.isActive).map(p => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.code ? `${p.code} — ${p.label}` : p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Se impostato, avvisa il PM se una riga inclusa non ha raggiunto questo progress.</p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Annulla</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || isLoading}
          >
            {isLoading ? 'Salvataggio…' : state.mode === 'create' ? 'Aggiungi' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
