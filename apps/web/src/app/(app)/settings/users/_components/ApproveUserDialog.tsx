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
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  const { data: functions = [] } = trpc.company.function.list.useQuery(undefined, { enabled: open });
  const { data: teams = [] } = trpc.company.team.listByFunction.useQuery(
    { functionId: selectedFunctionId },
    { enabled: open && !!selectedFunctionId }
  );

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

      await approveMutation.mutateAsync({ id: user.id, teamId: selectedTeamId });

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
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] p-0 gap-0 flex flex-col"> {/* px/vh: dialog width tuned to content, vh cap has no Tailwind scale equivalent */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Configura accesso e approva — {user.username}
          </DialogTitle>
          <DialogDescription>
            Configura ruolo, visibilità sezioni e team prima di approvare l&apos;account —
            il team determina a quali brand l&apos;utente avrà accesso.
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

          <div>
            <h3 className="text-sm font-semibold mb-3">Team *</h3>
            <p className="text-xs text-muted-foreground mb-3">
              L&apos;accesso ai brand dipende dal team: l&apos;utente vedrà esattamente i brand
              assegnati al team scelto qui, non tutti quelli dell&apos;azienda.
            </p>
            <div className="flex gap-2">
              <Select
                value={selectedFunctionId}
                onValueChange={v => { setSelectedFunctionId(v); setSelectedTeamId(''); }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Funzione…" />
                </SelectTrigger>
                <SelectContent>
                  {functions.map(fn => (
                    <SelectItem key={fn.id} value={fn.id}>{fn.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedTeamId}
                onValueChange={setSelectedTeamId}
                disabled={!selectedFunctionId}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Team…" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map(team => (
                    <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedTeamId && (() => {
              const team = teams.find(t => t.id === selectedTeamId);
              const brandCodes = team?.brandScopes.map(s => s.brand.code) ?? [];
              return (
                <p className="mt-2 text-xs text-muted-foreground">
                  {brandCodes.length > 0
                    ? `Brand: ${brandCodes.join(', ')}`
                    : 'Nessun brand assegnato a questo team — l’utente non vedrà alcun brand finché il team non ne riceve uno (Impostazioni → Azienda).'}
                </p>
              );
            })()}
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
          <Button onClick={handleSaveAndApprove} disabled={isSaving || !selectedTeamId}>
            {isSaving ? 'Approvazione...' : 'Salva e approva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
