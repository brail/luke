'use client';

import { Plus, Trash2, Star } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import {
  SPECSHEET_COMPONENT_SECTIONS,
  type SpecsheetComponentSection,
  buildSpecsheetImageUploadUrl,
} from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../../../components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { FileDropZone } from '../../../../../components/ui/file-drop-zone';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

type MerchandisingRow = RouterOutputs['merchandisingPlan']['listRows'][number];

const SECTION_LABELS: Record<SpecsheetComponentSection, string> = {
  UPPER: 'Upper',
  LINING: 'Lining',
  ACCESSORIES: 'Accessories',
  SOLE: 'Sole',
  OTHER: 'Altro',
};

interface EditableComponent {
  id?: string;
  partNumber: string;
  component: string;
  material: string;
  color: string;
  pantoneNotes: string;
  order: number;
  section: SpecsheetComponentSection;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: MerchandisingRow;
  canUpdate: boolean;
  onSaved: () => void;
}

export function SpecsheetModal({ open, onOpenChange, row, canUpdate, onSaved }: Props) {
  const utils = trpc.useUtils();

  const { data: specsheet, isLoading } = trpc.merchandisingPlan.getSpecsheet.useQuery(
    { rowId: row.id },
    { enabled: open }
  );

  // Header state
  const [madeIn, setMadeIn] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [headerNotes, setHeaderNotes] = useState('');

  // Components state (flat list, gruppati per section nel render)
  const [components, setComponents] = useState<EditableComponent[]>([]);

  // Sections collapsed state
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [uploadingImage, setUploadingImage] = useState(false);

  // Sincronizza lo stato locale quando i dati arrivano
  useEffect(() => {
    if (specsheet) {
      setMadeIn(specsheet.madeIn ?? '');
      setSupplierName(specsheet.supplierName ?? '');
      setHeaderNotes(specsheet.notes ?? '');
      setComponents(
        specsheet.components.map(c => ({
          id: c.id,
          partNumber: c.partNumber ?? '',
          component: c.component,
          material: c.material ?? '',
          color: c.color ?? '',
          pantoneNotes: c.pantoneNotes ?? '',
          order: c.order,
          section: c.section as SpecsheetComponentSection,
        }))
      );
    } else if (!isLoading) {
      // Specsheet non ancora esistente
      setMadeIn('');
      setSupplierName('');
      setHeaderNotes('');
      setComponents([]);
    }
  }, [specsheet, isLoading]);

  const upsertSpecsheetMutation = trpc.merchandisingPlan.upsertSpecsheet.useMutation({
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const upsertComponentsMutation = trpc.merchandisingPlan.upsertComponents.useMutation({
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const setDefaultImageMutation = trpc.merchandisingPlan.setDefaultImage.useMutation({
    onSuccess: () => utils.merchandisingPlan.getSpecsheet.invalidate({ rowId: row.id }),
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteImageMutation = trpc.merchandisingPlan.deleteImage.useMutation({
    onSuccess: () => {
      utils.merchandisingPlan.getSpecsheet.invalidate({ rowId: row.id });
      onSaved();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const handleSave = async () => {
    // 1. Upsert specsheet header
    const ss = await upsertSpecsheetMutation.mutateAsync({
      rowId: row.id,
      madeIn: madeIn || null,
      supplierName: supplierName || null,
      notes: headerNotes || null,
    });

    // 2. Sostituisci componenti
    await upsertComponentsMutation.mutateAsync({
      specsheetId: ss.id,
      components: components.map((c, i) => ({
        section: c.section,
        partNumber: c.partNumber || null,
        component: c.component,
        material: c.material || null,
        color: c.color || null,
        pantoneNotes: c.pantoneNotes || null,
        order: i,
      })),
    });

    toast.success('Specsheet salvata');
    utils.merchandisingPlan.getSpecsheet.invalidate({ rowId: row.id });
    onSaved();
    onOpenChange(false);
  };

  const addComponent = (section: SpecsheetComponentSection) => {
    const sectionComponents = components.filter(c => c.section === section);
    setComponents(prev => [
      ...prev,
      {
        partNumber: '',
        component: '',
        material: '',
        color: '',
        pantoneNotes: '',
        order: sectionComponents.length,
        section,
      },
    ]);
  };

  const removeComponent = (index: number) => {
    setComponents(prev => prev.filter((_, i) => i !== index));
  };

  const updateComponent = (index: number, field: keyof EditableComponent, value: string) => {
    setComponents(prev =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  };

  const handleImageUpload = async (file: File) => {
    if (!specsheet) return;
    setUploadingImage(true);
    try {
      const formData = new globalThis.FormData();
      formData.append('file', file);
      const url = buildSpecsheetImageUploadUrl(specsheet.id);
      const res = await fetch(url, { method: 'POST', body: formData, credentials: 'include' });
      if (!res.ok) throw new Error('Upload fallito');
      utils.merchandisingPlan.getSpecsheet.invalidate({ rowId: row.id });
      onSaved();
      toast.success('Immagine caricata');
    } catch (err: any) {
      toast.error(err.message ?? 'Errore upload immagine');
    } finally {
      setUploadingImage(false);
    }
  };

  const isSaving =
    upsertSpecsheetMutation.isPending || upsertComponentsMutation.isPending;

  // Raggruppa componenti per section
  const componentsBySection = SPECSHEET_COMPONENT_SECTIONS.reduce(
    (acc, section) => {
      acc[section] = components
        .map((c, originalIndex) => ({ ...c, originalIndex }))
        .filter(c => c.section === section);
      return acc;
    },
    {} as Record<SpecsheetComponentSection, (EditableComponent & { originalIndex: number })[]>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        {/* Header fisso */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="text-base">
            <span className="font-mono">{row.articleCode}</span>
            {' · '}
            <span>{row.styleDescription}</span>
            {' · '}
            <span className="text-muted-foreground">
              {row.colorCode} {row.colorDescription}
            </span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {row.productCategory}
            {row.pricingParameterSet && ` · ${row.pricingParameterSet.name}`}
          </p>
        </DialogHeader>

        {/* Corpo scrollabile */}
        <div className="flex-1 overflow-y-auto">
          {/* Footer info + note generali */}
          <div className="px-6 py-4 border-b grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Made In</Label>
              <Input
                value={madeIn}
                onChange={e => setMadeIn(e.target.value)}
                placeholder="es. Italy"
                disabled={!canUpdate}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fornitore</Label>
              <Input
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                disabled={!canUpdate}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note specsheet</Label>
              <Input
                value={headerNotes}
                onChange={e => setHeaderNotes(e.target.value)}
                disabled={!canUpdate}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Colonne: Galleria | BOM */}
          <div className="grid grid-cols-[280px_1fr] divide-x">
            {/* Galleria immagini */}
            <div className="p-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Immagini
              </p>

              {specsheet && specsheet.images.length > 0 ? (
                <div className="space-y-2">
                  {specsheet.images.map(img => (
                    <div key={img.id} className="relative group rounded-md overflow-hidden border">
                      <img
                        src={img.url ?? ''}
                        alt={img.caption ?? ''}
                        className="w-full object-cover max-h-40"
                      />
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!img.isDefault && canUpdate && (
                          <button
                            title="Imposta come default"
                            onClick={() => setDefaultImageMutation.mutate({ id: img.id })}
                            className="bg-background/90 rounded p-1 hover:bg-background"
                          >
                            <Star className="h-3 w-3" />
                          </button>
                        )}
                        {canUpdate && (
                          <button
                            title="Elimina immagine"
                            onClick={() => deleteImageMutation.mutate({ id: img.id })}
                            className="bg-background/90 rounded p-1 hover:bg-background text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {img.isDefault && (
                        <div className="absolute top-1 left-1">
                          <Badge variant="default" className="text-xs py-0 px-1">
                            <Star className="h-2.5 w-2.5 mr-0.5" />
                            Default
                          </Badge>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nessuna immagine</p>
              )}

              {canUpdate && specsheet && (
                <FileDropZone
                  onFile={handleImageUpload}
                  accept={['image/png', 'image/jpeg', 'image/webp']}
                  maxSizeMB={10}
                  disabled={uploadingImage}
                  className="w-full"
                >
                  <div className="flex items-center justify-center rounded-md border border-dashed py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/30 transition-colors">
                    {uploadingImage ? 'Caricamento…' : '+ Aggiungi immagine'}
                  </div>
                </FileDropZone>
              )}

              {!specsheet && canUpdate && (
                <p className="text-xs text-muted-foreground">
                  Salva prima la specsheet per abilitare l&apos;upload immagini.
                </p>
              )}
            </div>

            {/* BOM per sezione */}
            <div className="p-4 space-y-2 overflow-y-auto">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                BOM
              </p>

              {SPECSHEET_COMPONENT_SECTIONS.map(section => {
                const sectionComponents = componentsBySection[section];
                const isOpen = !collapsed[section];

                return (
                  <Collapsible
                    key={section}
                    open={isOpen}
                    onOpenChange={open =>
                      setCollapsed(prev => ({ ...prev, [section]: !open }))
                    }
                  >
                    <div className="border rounded-md">
                      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-md">
                        <div className="flex items-center gap-2">
                          <span>{SECTION_LABELS[section]}</span>
                          <Badge variant="secondary" className="text-xs">
                            {sectionComponents.length}
                          </Badge>
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {isOpen ? '▲' : '▼'}
                        </span>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="border-t">
                          {sectionComponents.length > 0 && (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b bg-muted/30">
                                    <th className="text-left px-2 py-1 font-medium w-12">Part</th>
                                    <th className="text-left px-2 py-1 font-medium">Component *</th>
                                    <th className="text-left px-2 py-1 font-medium">Material</th>
                                    <th className="text-left px-2 py-1 font-medium">Color</th>
                                    <th className="text-left px-2 py-1 font-medium">Pantone</th>
                                    {canUpdate && <th className="w-8" />}
                                  </tr>
                                </thead>
                                <tbody>
                                  {sectionComponents.map(c => (
                                    <tr key={c.originalIndex} className="border-b last:border-0">
                                      <td className="px-1 py-0.5">
                                        <Input
                                          className="h-6 text-xs px-1"
                                          value={c.partNumber}
                                          onChange={e =>
                                            updateComponent(c.originalIndex, 'partNumber', e.target.value)
                                          }
                                          disabled={!canUpdate}
                                        />
                                      </td>
                                      <td className="px-1 py-0.5">
                                        <Input
                                          className="h-6 text-xs px-1 min-w-[120px]"
                                          value={c.component}
                                          onChange={e =>
                                            updateComponent(c.originalIndex, 'component', e.target.value)
                                          }
                                          disabled={!canUpdate}
                                        />
                                      </td>
                                      <td className="px-1 py-0.5">
                                        <Input
                                          className="h-6 text-xs px-1"
                                          value={c.material}
                                          onChange={e =>
                                            updateComponent(c.originalIndex, 'material', e.target.value)
                                          }
                                          disabled={!canUpdate}
                                        />
                                      </td>
                                      <td className="px-1 py-0.5">
                                        <Input
                                          className="h-6 text-xs px-1"
                                          value={c.color}
                                          onChange={e =>
                                            updateComponent(c.originalIndex, 'color', e.target.value)
                                          }
                                          disabled={!canUpdate}
                                        />
                                      </td>
                                      <td className="px-1 py-0.5">
                                        <Input
                                          className="h-6 text-xs px-1"
                                          value={c.pantoneNotes}
                                          onChange={e =>
                                            updateComponent(c.originalIndex, 'pantoneNotes', e.target.value)
                                          }
                                          disabled={!canUpdate}
                                        />
                                      </td>
                                      {canUpdate && (
                                        <td className="px-1 py-0.5">
                                          <button
                                            type="button"
                                            onClick={() => removeComponent(c.originalIndex)}
                                            className="text-destructive hover:text-destructive/80"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {canUpdate && (
                            <div className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => addComponent(section)}
                                className="text-xs text-primary flex items-center gap-1 hover:underline"
                              >
                                <Plus className="h-3 w-3" />
                                Aggiungi componente
                              </button>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer fisso */}
        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          {canUpdate && (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Salvataggio…' : 'Salva'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
