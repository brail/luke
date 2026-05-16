'use client';

import { Info, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SECTION_ACCESS_DEFAULTS } from '@luke/core';
import type { Section } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Label } from '../../../../../components/ui/label';
import { Switch } from '../../../../../components/ui/switch';
import { trpc } from '../../../../../lib/trpc';

import {
  ALL_SECTIONS,
  SECTION_LABELS,
  type SectionOverrideMap,
  type UserListItem,
} from './types';

interface UserAccessDialogProps {
  user: UserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserAccessDialog({ user, open, onOpenChange }: UserAccessDialogProps) {
  const utils = trpc.useUtils();
  const initialized = useRef(false);

  const { data: serverSectionOverrides, isLoading: loadingSection } =
    trpc.sectionAccess.getByUser.useQuery({ userId: user.id }, { enabled: open });

  const [pendingSection, setPendingSection] = useState<SectionOverrideMap>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    if (loadingSection) return;

    initialized.current = true;

    const sectionMap: SectionOverrideMap = {};
    serverSectionOverrides?.forEach(o => {
      if (o.enabled !== null) sectionMap[o.section] = o.enabled;
    });
    setPendingSection(sectionMap);
    setIsDirty(false);
  }, [open, loadingSection, serverSectionOverrides]);

  const getRoleDefault = (section: Section): boolean =>
    SECTION_ACCESS_DEFAULTS[user.role]?.[section] ?? false;

  const getSectionValue = (section: Section): boolean => {
    if (section in pendingSection) return pendingSection[section]!;
    return getRoleDefault(section);
  };

  const handleSectionToggle = (section: Section, checked: boolean) => {
    setPendingSection(prev => {
      const next = { ...prev };
      if (checked === getRoleDefault(section)) {
        delete next[section];
      } else {
        next[section] = checked;
      }
      return next;
    });
    setIsDirty(true);
  };

  const handleSectionReset = (section: Section) => {
    setPendingSection(prev => {
      const next = { ...prev };
      delete next[section];
      return next;
    });
    setIsDirty(true);
  };

  const setSectionMutation = trpc.sectionAccess.set.useMutation();
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const serverSectionMap: Record<string, boolean | null> = {};
      serverSectionOverrides?.forEach(o => {
        if (o.enabled !== null) serverSectionMap[o.section] = o.enabled;
      });
      const changedSections = ALL_SECTIONS.filter(section => {
        const desired = section in pendingSection ? pendingSection[section]! : null;
        const current = serverSectionMap[section] ?? null;
        return desired !== current;
      });
      await Promise.all(
        changedSections.map(section =>
          setSectionMutation.mutateAsync({
            userId: user.id,
            section,
            enabled: section in pendingSection ? pendingSection[section]! : null,
          })
        )
      );

      await utils.sectionAccess.getByUser.invalidate({ userId: user.id });

      toast.success('Accesso aggiornato');
      setIsDirty(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Errore nel salvataggio');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsDirty(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) handleCancel(); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Gestisci accesso — {user.firstName} {user.lastName}
          </DialogTitle>
          <DialogDescription>
            Configura sezioni visibili. Gli override si applicano sopra i default del ruolo{' '}
            <strong>{user.role}</strong>.
          </DialogDescription>
        </DialogHeader>

        {loadingSection ? (
          <div className="py-8 text-center text-muted-foreground">Caricamento...</div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Section overrides */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Visibilità sezioni</h3>
              <div className="space-y-2">
                {ALL_SECTIONS.map(section => {
                  const isOverridden = section in pendingSection;
                  const effectiveValue = getSectionValue(section);
                  const roleDefault = getRoleDefault(section);

                  return (
                    <div key={section} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`section-${section}`} className="text-sm font-normal">
                          {SECTION_LABELS[section]}
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          {isOverridden
                            ? '(override)'
                            : `(default: ${roleDefault ? 'sì' : 'no'})`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`section-${section}`}
                          checked={effectiveValue}
                          onCheckedChange={checked => handleSectionToggle(section, checked)}
                        />
                        {isOverridden && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1 text-xs text-muted-foreground"
                            onClick={() => handleSectionReset(section)}
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Brand access info */}
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                L'accesso ai brand è gestito tramite la membership ai team aziendali.
                Configura i team dalla pagina <strong>Impostazioni → Azienda</strong>.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            Annulla
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? 'Salvataggio...' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
