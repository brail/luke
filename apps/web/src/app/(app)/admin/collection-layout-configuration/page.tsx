'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { GripVertical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  COLLECTION_CATALOG_TYPES,
  CollectionCatalogItemInputSchema,
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../components/ui/form';
import { Input } from '../../../../components/ui/input';
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
                      className={!canWrite ? 'opacity-50 cursor-not-allowed' : undefined}
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
                                          size="icon-sm"
                                          variant="ghost"
                                          className={!canWrite ? 'opacity-50 cursor-not-allowed' : undefined}
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
                                            size="icon-sm"
                                            variant="ghost"
                                            className={!canWrite ? 'opacity-50 cursor-not-allowed' : undefined}
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
                                            size="icon-sm"
                                            variant="ghost"
                                            className={cn('text-destructive', !canWrite && 'opacity-50 cursor-not-allowed')}
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
        actionType="disable"
        onConfirm={() => { if (deletingItem) removeMutation.mutate({ id: deletingItem.id }); }}
        isLoading={removeMutation.isPending}
      />
    </>
  );
}

// ─── Item Dialog ──────────────────────────────────────────────────────────────

/**
 * The three fields the dialog collects, out of the catalog item input. The messages are spelled
 * out here: the core schema carries no copy, and Zod's default for `min(1)` talks about string
 * length rather than about the field being required.
 */
const CatalogFormBaseSchema = CollectionCatalogItemInputSchema
  .pick({ value: true, label: true })
  .extend({
    value: z.string().min(1, 'Il valore è obbligatorio').max(100, 'Massimo 100 caratteri'),
    label: z.string().min(1, 'La label è obbligatoria').max(200, 'Massimo 200 caratteri'),
    iso9001Categories: z.array(z.enum(ISO9001_CATEGORIES)),
  });

interface CatalogFormData {
  value: string;
  label: string;
  iso9001Categories: Iso9001Category[];
}

type DialogSubmitData = {
  value: string;
  label: string;
  iso9001Categories?: Iso9001Category[] | null;
};

function CatalogItemDialog({
  state,
  onClose,
  onSubmit,
  isLoading,
}: {
  state: ItemDialogState;
  onClose: () => void;
  onSubmit: (data: DialogSubmitData) => void;
  isLoading: boolean;
}) {
  const initial = state.mode === 'edit' ? state.item : null;
  const activeType = state.mode === 'create' ? state.type : state.item.type;

  const isRevisionType = activeType === 'revisionType';

  // The ISO categories are required only on a revision type; every other catalog type never
  // renders the checkboxes, so validating them would reject a submit with a message that has
  // nowhere to appear.
  const schema = useMemo<z.ZodType<CatalogFormData, CatalogFormData>>(
    () =>
      isRevisionType
        ? CatalogFormBaseSchema.extend({
            iso9001Categories: z
              .array(z.enum(ISO9001_CATEGORIES))
              .min(1, 'Selezionare almeno una categoria'),
          })
        : CatalogFormBaseSchema,
    [isRevisionType]
  );

  // The caller mounts this dialog only while it is open, so the defaults are seeded once per
  // opening and need no reset effect.
  const form = useForm<CatalogFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      value: initial?.value ?? '',
      label: initial?.label ?? '',
      iso9001Categories: (initial?.iso9001Categories ?? []) as Iso9001Category[],
    },
  });

  const selectedCategories = form.watch('iso9001Categories');

  const toggleCategory = (cat: Iso9001Category) => {
    const next = selectedCategories.includes(cat)
      ? selectedCategories.filter(c => c !== cat)
      : [...selectedCategories, cat];
    form.setValue('iso9001Categories', next, { shouldValidate: true });
  };

  const handleSubmit = (data: CatalogFormData) => {
    onSubmit({
      value: data.value.trim(),
      label: data.label.trim(),
      iso9001Categories: isRevisionType ? data.iso9001Categories : null,
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !isLoading) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {state.mode === 'create' ? 'Aggiungi opzione' : 'Modifica opzione'}
            {' '}<span className="text-muted-foreground font-normal text-sm">({TYPE_LABELS[activeType as CollectionCatalogType] ?? activeType})</span>
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Valore (chiave)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. CORE"
                        disabled={state.mode === 'edit' || isLoading}
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    {state.mode === 'create' && (
                      <FormDescription className="text-xs">
                        Stringa identificativa, non modificabile dopo la creazione.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Label visualizzata</FormLabel>
                    <FormControl>
                      <Input placeholder="es. Core" disabled={isLoading} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isRevisionType && (
                <FormField
                  control={form.control}
                  name="iso9001Categories"
                  render={() => (
                    <FormItem className="space-y-2">
                      <FormLabel>Categorie ISO 9001:2015 <span className="text-destructive">*</span></FormLabel>
                      <div className="space-y-1.5">
                        {ISO9001_CATEGORIES.map(cat => (
                          <div key={cat} className="flex items-center gap-2">
                            <Checkbox
                              id={`cat-iso-${cat}`}
                              checked={selectedCategories.includes(cat)}
                              onCheckedChange={() => toggleCategory(cat)}
                              disabled={isLoading}
                            />
                            <label htmlFor={`cat-iso-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                          </div>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Annulla</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Salvataggio…' : state.mode === 'create' ? 'Aggiungi' : 'Salva'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
