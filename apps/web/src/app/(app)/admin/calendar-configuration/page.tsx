'use client';

import { ChevronDown, ChevronRight, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
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

import { TemplateDialog } from './_components/TemplateDialog';
import { TemplateItemDialog } from './_components/TemplateItemDialog';

type Template = RouterOutputs['seasonCalendar']['listTemplates'][number];
type TemplateItem = Template['items'][number];

// ─── Catalog types ────────────────────────────────────────────────────────────

type CatalogItem = RouterOutputs['calendarCatalog']['listAll'][number];

type CatalogDialogState = { mode: 'create' } | { mode: 'edit'; item: CatalogItem };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarConfigurationPage() {
  const { can } = usePermission();
  const canCreate = can('milestone_template:create');
  const canUpdate = can('milestone_template:update');
  const canDelete = can('milestone_template:delete');
  const canWriteCatalog = can('calendar_catalog:update');

  // ── Template state ──────────────────────────────────────────────────────────

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; template?: Template | null }>({ open: false });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; templateId: string; item?: TemplateItem | null }>({ open: false, templateId: '' });
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [deletingItem, setDeletingItem] = useState<TemplateItem | null>(null);

  const { data: templates = [], isLoading: templatesLoading, refetch: refetchTemplates } = trpc.seasonCalendar.listTemplates.useQuery();
  const { data: functionsData = [] } = trpc.company.function.list.useQuery();
  const availableFunctions = functionsData.map(f => ({ id: f.id, name: f.name }));
  const functionsById = Object.fromEntries(availableFunctions.map(f => [f.id, f.name]));

  const deleteTemplateMutation = trpc.seasonCalendar.deleteTemplate.useMutation({
    onSuccess: () => { toast.success('Template eliminato'); setDeletingTemplate(null); void refetchTemplates(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteItemMutation = trpc.seasonCalendar.deleteTemplateItem.useMutation({
    onSuccess: () => { toast.success('Item eliminato'); setDeletingItem(null); void refetchTemplates(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Catalog state ───────────────────────────────────────────────────────────

  const [catalogDialog, setCatalogDialog] = useState<CatalogDialogState | null>(null);
  const [removingCatalogItem, setRemovingCatalogItem] = useState<CatalogItem | null>(null);

  const utils = trpc.useUtils();
  const invalidateCatalog = () => void utils.calendarCatalog.listAll.invalidate({ type: 'eventType' });

  const { data: catalogItems = [], isLoading: catalogLoading } = trpc.calendarCatalog.listAll.useQuery(
    { type: 'eventType' },
    { staleTime: 30 * 1000 }
  );

  const createCatalogMutation = trpc.calendarCatalog.create.useMutation({
    onSuccess: () => { invalidateCatalog(); setCatalogDialog(null); toast.success('Tipo aggiunto'); },
    onError: e => toast.error(getTrpcErrorMessage(e, { CONFLICT: 'Valore già esistente' })),
  });

  const updateCatalogMutation = trpc.calendarCatalog.update.useMutation({
    onSuccess: () => { invalidateCatalog(); setCatalogDialog(null); toast.success('Tipo aggiornato'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const removeCatalogMutation = trpc.calendarCatalog.remove.useMutation({
    onSuccess: () => { invalidateCatalog(); setRemovingCatalogItem(null); toast.success('Tipo disattivato'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const restoreCatalogMutation = trpc.calendarCatalog.restore.useMutation({
    onSuccess: () => { invalidateCatalog(); toast.success('Tipo riattivato'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const isCatalogMutating =
    createCatalogMutation.isPending || updateCatalogMutation.isPending || removeCatalogMutation.isPending;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Configurazione Calendario</h1>
        <p className="text-muted-foreground mt-2">Template riutilizzabili e tipi di evento configurabili</p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList className="mb-6">
          <TabsTrigger value="templates">Template</TabsTrigger>
          <TabsTrigger value="event-types">Tipi evento</TabsTrigger>
        </TabsList>

        {/* ── Templates tab ── */}
        <TabsContent value="templates">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">Template riutilizzabili di milestone per le stagioni</p>
            <CreateActionButton
              label="Nuovo template"
              canCreate={canCreate}
              resourceName="template"
              onClick={() => setTemplateDialog({ open: true, template: null })}
            />
          </div>

          <div className="space-y-3">
            {templatesLoading && <p className="text-muted-foreground text-sm">Caricamento…</p>}
            {!templatesLoading && templates.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nessun template. Crea il primo template per iniziare.
                </CardContent>
              </Card>
            )}
            {templates.map(t => {
              const expanded = expandedIds.has(t.id);
              return (
                <Card key={t.id}>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleExpand(t.id)}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className="font-medium">{t.name}</span>
                        <span className="text-xs text-muted-foreground ml-1">
                          {t.items.length} item{t.items.length !== 1 ? 's' : ''}
                        </span>
                        {t.description && (
                          <span className="text-xs text-muted-foreground truncate max-w-xs">
                            — {t.description}
                          </span>
                        )}
                      </button>
                      <div className="flex gap-1 shrink-0">
                        {canUpdate && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setTemplateDialog({ open: true, template: t })}
                          >
                            <Pencil size={14} />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeletingTemplate(t)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                              <th className="text-left px-4 py-2 font-medium">Titolo</th>
                              <th className="text-left px-4 py-2 font-medium">Tipo</th>
                              <th className="text-left px-4 py-2 font-medium">Funzione</th>
                              <th className="text-right px-4 py-2 font-medium">Offset</th>
                              <th className="text-right px-4 py-2 font-medium">Durata</th>
                              <th className="px-4 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {t.items.map((item, i) => (
                              <tr
                                key={item.id}
                                className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                              >
                                <td className="px-4 py-2">{item.title}</td>
                                <td className="px-4 py-2 text-muted-foreground">{item.type}</td>
                                <td className="px-4 py-2 text-muted-foreground">
                                  {functionsById[item.ownerFunctionId] ?? item.ownerFunctionId}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                  {item.offsetDays > 0 ? `+${item.offsetDays}` : item.offsetDays}g
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                                  {item.durationDays > 0 ? `${item.durationDays}g` : '—'}
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex gap-1 justify-end">
                                    {canUpdate && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => setItemDialog({ open: true, templateId: t.id, item })}
                                      >
                                        <Pencil size={12} />
                                      </Button>
                                    )}
                                    {canDelete && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-destructive hover:text-destructive"
                                        onClick={() => setDeletingItem(item)}
                                      >
                                        <Trash2 size={12} />
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {t.items.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">
                                  Nessun item — aggiungi la prima milestone al template
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {canCreate && (
                          <div className="px-4 py-2 border-t">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={() => setItemDialog({ open: true, templateId: t.id, item: null })}
                            >
                              <Plus size={12} className="mr-1" />
                              Aggiungi item
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Event types tab ── */}
        <TabsContent value="event-types">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">Tipi di evento disponibili nel calendario</p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      disabled={!canWriteCatalog}
                      className={cn(!canWriteCatalog && 'opacity-50 cursor-not-allowed')}
                      onClick={() => canWriteCatalog && setCatalogDialog({ mode: 'create' })}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Nuovo tipo
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canWriteCatalog && (
                  <TooltipContent>Non hai i permessi per modificare i tipi evento</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="rounded-lg border bg-card">
            {catalogLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Caricamento…</div>
            ) : catalogItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Nessun tipo configurato.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">Valore</th>
                    <th className="px-4 py-2 text-left font-medium">Label</th>
                    <th className="px-4 py-2 text-left font-medium">Colore</th>
                    <th className="px-4 py-2 text-left font-medium">Stato</th>
                    <th className="w-24 px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {catalogItems.map(item => (
                    <tr key={item.id} className={cn('border-b last:border-0', !item.isActive && 'opacity-50')}>
                      <td className="px-4 py-2 font-mono text-xs">{item.value}</td>
                      <td className="px-4 py-2">{item.label}</td>
                      <td className="px-4 py-2">
                        {item.color ? (
                          <span className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ background: item.color }}
                            />
                            <span className="text-xs text-muted-foreground">{item.color}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={item.isActive ? 'default' : 'secondary'}>
                          {item.isActive ? 'Attivo' : 'Inattivo'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {!item.isActive ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className={cn('h-7 w-7', !canWriteCatalog && 'opacity-50 cursor-not-allowed')}
                                      disabled={!canWriteCatalog || restoreCatalogMutation.isPending}
                                      onClick={() => canWriteCatalog && restoreCatalogMutation.mutate({ id: item.id })}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {!canWriteCatalog && <TooltipContent>Non hai i permessi</TooltipContent>}
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
                                        className={cn('h-7 w-7', !canWriteCatalog && 'opacity-50 cursor-not-allowed')}
                                        disabled={!canWriteCatalog || isCatalogMutating}
                                        onClick={() => canWriteCatalog && setCatalogDialog({ mode: 'edit', item })}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  {!canWriteCatalog && <TooltipContent>Non hai i permessi</TooltipContent>}
                                </Tooltip>
                              </TooltipProvider>

                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className={cn('h-7 w-7 text-destructive', !canWriteCatalog && 'opacity-50 cursor-not-allowed')}
                                        disabled={!canWriteCatalog || isCatalogMutating}
                                        onClick={() => canWriteCatalog && setRemovingCatalogItem(item)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  {!canWriteCatalog && <TooltipContent>Non hai i permessi</TooltipContent>}
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
      </Tabs>

      {/* ── Template dialogs ── */}
      <TemplateDialog
        open={templateDialog.open}
        template={templateDialog.template}
        onClose={() => setTemplateDialog({ open: false })}
        onSaved={() => { setTemplateDialog({ open: false }); void refetchTemplates(); }}
      />

      <TemplateItemDialog
        open={itemDialog.open}
        templateId={itemDialog.templateId}
        item={itemDialog.item}
        onClose={() => setItemDialog({ open: false, templateId: '' })}
        onSaved={() => { setItemDialog({ open: false, templateId: '' }); void refetchTemplates(); }}
        availableFunctions={availableFunctions}
      />

      <ConfirmDialog
        open={!!deletingTemplate}
        onOpenChange={open => { if (!open) setDeletingTemplate(null); }}
        title="Elimina template"
        description={`Eliminare "${deletingTemplate?.name}"? Tutti gli item verranno rimossi. Operazione irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deletingTemplate) deleteTemplateMutation.mutate({ id: deletingTemplate.id }); }}
        isLoading={deleteTemplateMutation.isPending}
      />

      <ConfirmDialog
        open={!!deletingItem}
        onOpenChange={open => { if (!open) setDeletingItem(null); }}
        title="Elimina item"
        description={`Eliminare "${deletingItem?.title}"?`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deletingItem) deleteItemMutation.mutate({ id: deletingItem.id }); }}
        isLoading={deleteItemMutation.isPending}
      />

      {/* ── Catalog dialogs ── */}
      {catalogDialog && (
        <CatalogEventTypeDialog
          state={catalogDialog}
          onClose={() => setCatalogDialog(null)}
          onSubmit={data => {
            if (catalogDialog.mode === 'create') {
              createCatalogMutation.mutate({ type: 'eventType', value: data.value, label: data.label, color: data.color ?? undefined });
            } else {
              updateCatalogMutation.mutate({ id: catalogDialog.item.id, label: data.label, color: data.color });
            }
          }}
          isLoading={createCatalogMutation.isPending || updateCatalogMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={!!removingCatalogItem}
        onOpenChange={open => { if (!open) setRemovingCatalogItem(null); }}
        title="Disattiva tipo evento"
        description={`Disattivare "${removingCatalogItem?.label}"? Non sarà più disponibile per i nuovi eventi.`}
        confirmText="Disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (removingCatalogItem) removeCatalogMutation.mutate({ id: removingCatalogItem.id }); }}
        isLoading={removeCatalogMutation.isPending}
      />
    </>
  );
}

// ─── Catalog event type dialog ────────────────────────────────────────────────

type CatalogSubmitData = { value: string; label: string; color?: string | null };

function CatalogEventTypeDialog({
  state,
  onClose,
  onSubmit,
  isLoading,
}: {
  state: CatalogDialogState;
  onClose: () => void;
  onSubmit: (data: CatalogSubmitData) => void;
  isLoading: boolean;
}) {
  const initial = state.mode === 'edit' ? state.item : null;

  const [value, setValue] = useState(initial?.value ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [color, setColor] = useState(initial?.color ?? '');

  const canSubmit = value.trim().length > 0 && label.trim().length > 0;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {state.mode === 'create' ? 'Nuovo tipo evento' : 'Modifica tipo evento'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ev-value">Valore (chiave)</Label>
            <Input
              id="ev-value"
              value={value}
              onChange={e => setValue(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
              placeholder="es. KICKOFF"
              disabled={state.mode === 'edit'}
              autoFocus
            />
            {state.mode === 'create' && (
              <p className="text-xs text-muted-foreground">Stringa identificativa, non modificabile dopo la creazione.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-label">Label visualizzata</Label>
            <Input
              id="ev-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="es. Kickoff"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-color">Colore (opzionale)</Label>
            <Input
              id="ev-color"
              value={color}
              onChange={e => setColor(e.target.value)}
              placeholder="es. #3b82f6"
            />
            <p className="text-xs text-muted-foreground">Valore hex o CSS color per il badge del tipo.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Annulla</Button>
          <Button
            onClick={() => onSubmit({ value: value.trim(), label: label.trim(), color: color.trim() || null })}
            disabled={!canSubmit || isLoading}
          >
            {isLoading ? 'Salvataggio…' : state.mode === 'create' ? 'Aggiungi' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
