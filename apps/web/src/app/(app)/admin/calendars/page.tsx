'use client';

import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { SECTION_LABELS, TYPE_LABELS } from '../../calendar/constants';

import { TemplateDialog } from './_components/TemplateDialog';
import { TemplateItemDialog } from './_components/TemplateItemDialog';

type Template = RouterOutputs['seasonCalendar']['listTemplates'][number];
type TemplateItem = Template['items'][number];

export default function CalendarTemplatesPage() {
  const { can } = usePermission();
  const canCreate = can('milestone_template:create');
  const canUpdate = can('milestone_template:update');
  const canDelete = can('milestone_template:delete');

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; template?: Template | null }>({ open: false });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; templateId: string; item?: TemplateItem | null }>({ open: false, templateId: '' });
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [deletingItem, setDeletingItem] = useState<TemplateItem | null>(null);

  const { data: templates = [], isLoading, refetch } = trpc.seasonCalendar.listTemplates.useQuery();

  const deleteTemplateMutation = trpc.seasonCalendar.deleteTemplate.useMutation({
    onSuccess: () => { toast.success('Template eliminato'); setDeletingTemplate(null); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteItemMutation = trpc.seasonCalendar.deleteTemplateItem.useMutation({
    onSuccess: () => { toast.success('Item eliminato'); setDeletingItem(null); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Template Calendario</h1>
          <p className="text-muted-foreground mt-2">Definisci template riutilizzabili di milestone per le stagioni</p>
        </div>
        <CreateActionButton
          label="Nuovo template"
          canCreate={canCreate}
          resourceName="template"
          onClick={() => setTemplateDialog({ open: true, template: null })}
        />
      </div>

      <div className="space-y-3 mt-6">
        {isLoading && (
          <p className="text-muted-foreground text-sm">Caricamento…</p>
        )}
        {!isLoading && templates.length === 0 && (
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
                          <th className="text-left px-4 py-2 font-medium">Sezione</th>
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
                            <td className="px-4 py-2 text-muted-foreground">
                              {TYPE_LABELS[item.type] ?? item.type}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {SECTION_LABELS[item.ownerSectionKey] ?? item.ownerSectionKey}
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

      <TemplateDialog
        open={templateDialog.open}
        template={templateDialog.template}
        onClose={() => setTemplateDialog({ open: false })}
        onSaved={() => { setTemplateDialog({ open: false }); void refetch(); }}
      />

      <TemplateItemDialog
        open={itemDialog.open}
        templateId={itemDialog.templateId}
        item={itemDialog.item}
        onClose={() => setItemDialog({ open: false, templateId: '' })}
        onSaved={() => { setItemDialog({ open: false, templateId: '' }); void refetch(); }}
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
    </>
  );
}
