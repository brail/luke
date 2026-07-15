'use client';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { SECTION_ACCESS_DEFAULTS } from '@luke/core';
import type { Role, Section } from '@luke/core';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { Switch } from '../../../../../components/ui/switch';
import { trpc } from '../../../../../lib/trpc';

import {
  ALL_SECTIONS,
  SECTION_LABELS,
  type SectionOverrideMap,
  type UserForApproval,
} from './types';

// Keys in SectionOverrideMap are always valid Section values
const toSection = (s: string) => s as Section;

interface ApproveUserDialogProps {
  user: UserForApproval;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: () => void;
}

/**
 * Dialog that forces an admin to configure role and section access before approving a pending user.
 * @param user - Pending user to approve, with current role pre-populated.
 * @param onApproved - Called after the user has been successfully approved.
 */
export function ApproveUserDialog({
  user,
  open,
  onOpenChange,
  onApproved,
}: ApproveUserDialogProps) {
  const [pendingRole, setPendingRole] = useState<Role>(user.role);
  const [pendingSection, setPendingSection] = useState<SectionOverrideMap>({});

  const getRoleDefault = (section: Section): boolean =>
    SECTION_ACCESS_DEFAULTS[pendingRole]?.[section] ?? false;

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
  };

  const handleSectionReset = (section: Section) => {
    setPendingSection(prev => {
      const next = { ...prev };
      delete next[section];
      return next;
    });
  };

  const updateUserMutation = trpc.users.update.useMutation();
  const setSectionMutation = trpc.sectionAccess.set.useMutation();
  const approveMutation = trpc.users.approvePending.useMutation();

  const [isSaving, setIsSaving] = useState(false);

  const handleSaveAndApprove = async () => {
    setIsSaving(true);
    try {
      if (pendingRole !== user.role) {
        await updateUserMutation.mutateAsync({ id: user.id, role: pendingRole });
      }

      // New user: no existing overrides — only send explicit changes, skip no-ops
      await Promise.all(
        Object.keys(pendingSection).map(section =>
          setSectionMutation.mutateAsync({
            userId: user.id,
            section: toSection(section),
            enabled: pendingSection[section]!,
          })
        )
      );

      await approveMutation.mutateAsync({ id: user.id });

      toast.success('Utente approvato con accesso configurato');
      onApproved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : undefined;
      toast.error(msg ?? "Errore durante l'approvazione");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o && !isSaving) onOpenChange(false);
      }}
    >
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Configura accesso e approva — {user.username}
          </DialogTitle>
          <DialogDescription>
            Configura ruolo e visibilità sezioni prima di approvare l&apos;account.
            L&apos;accesso ai brand è gestito tramite i team in{' '}
            <strong>Impostazioni → Azienda</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-3">Ruolo</h3>
            <Select
              value={pendingRole}
              onValueChange={v => {
                setPendingRole(v as Role);
                setPendingSection({});
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Visibilità sezioni</h3>
            <div className="space-y-2">
              {ALL_SECTIONS.map(section => {
                const isOverridden = section in pendingSection;
                const effectiveValue = getSectionValue(section);
                const roleDefault = getRoleDefault(section);

                return (
                  <div
                    key={section}
                    className="flex items-center justify-between py-1"
                  >
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`section-${section}`}
                        className="text-sm font-normal"
                      >
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
                        onCheckedChange={checked =>
                          handleSectionToggle(section, checked)
                        }
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

          <div className="rounded-md border border-muted p-3 text-sm text-muted-foreground">
            L&apos;accesso ai brand è gestito tramite la membership ai team aziendali.
            Configura i team dalla pagina <strong>Impostazioni → Azienda</strong> dopo l&apos;approvazione.
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Annulla
          </Button>
          <Button onClick={handleSaveAndApprove} disabled={isSaving}>
            {isSaving ? 'Approvazione...' : 'Salva e approva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
