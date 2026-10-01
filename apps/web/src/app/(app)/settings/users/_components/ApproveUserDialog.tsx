'use client';

import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { Role } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { trpc } from '../../../../../lib/trpc';

import { SectionAccessList } from './SectionAccessList';
import { type UserForApproval } from './types';
import { useSectionOverridesEditor } from './useSectionOverridesEditor';

interface ApproveUserDialogProps {
  user: UserForApproval;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: () => void;
}

/**
 * Dialog that forces an admin to configure role and section access before approving a pending user.
 *
 * An attempt is the role (only if the administrator changed it), the override edits, then the
 * approval; every control is disabled for its whole length. After any failure the dialog re-reads
 * the stored role, the pending status and the overrides before another attempt (ADR-027): a call
 * that committed but answered with an error is then neither repeated nor mistaken for not done.
 * @param user - Pending user to approve, with current role pre-populated.
 * @param onApproved - Called after the user has been approved, or found no longer pending.
 */
export function ApproveUserDialog({
  user,
  open,
  onOpenChange,
  onApproved,
}: ApproveUserDialogProps) {
  const utils = trpc.useUtils();
  const editor = useSectionOverridesEditor({ userId: user.id, open });

  /** The role stored for the account, from the last read; `null` until the first one answers. */
  const [storedRole, setStoredRole] = useState<Role | null>(null);
  /** The role the administrator chose, while it differs from the stored one. */
  const [roleEdit, setRoleEdit] = useState<Role | null>(null);
  const [roleReadFailed, setRoleReadFailed] = useState(false);
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const { data: functions = [] } = trpc.company.function.list.useQuery(undefined, { enabled: open });
  const { data: teams = [] } = trpc.company.team.listByFunction.useQuery(
    { functionId: selectedFunctionId },
    { enabled: open && !!selectedFunctionId }
  );

  const updateUserMutation = trpc.users.update.useMutation();
  const approveMutation = trpc.users.approvePending.useMutation();

  /**
   * The account as stored, read bypassing the query cache, or `null` when it is no longer in the
   * pending list (approved, rejected or deactivated: `listPending` filters both) — the caller then
   * ends the dialog.
   */
  const readPending = useCallback(async () => {
    const { users } = await utils.users.listPending.fetch(undefined, { staleTime: 0 });
    return users.find(candidate => candidate.id === user.id) ?? null;
  }, [utils, user.id]);

  const endNoLongerPending = useCallback(() => {
    toast.info('Questo account non è più tra le richieste in attesa');
    onApproved();
  }, [onApproved]);

  // A new opening starts from nothing (reset during render, as in `useSectionOverridesEditor`).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setStoredRole(null);
    setRoleEdit(null);
    setRoleReadFailed(false);
  }

  useEffect(() => {
    if (!open) return;
    let current = true;
    readPending().then(
      stored => {
        if (!current) return;
        if (stored) setStoredRole(stored.role);
        else endNoLongerPending();
      },
      () => {
        if (current) setRoleReadFailed(true);
      }
    );
    return () => {
      current = false;
    };
  }, [open, readPending, endNoLongerPending]);

  const shownRole = roleEdit ?? storedRole;
  const stale = editor.stale || roleReadFailed;
  const ready = shownRole !== null && editor.defaults !== undefined && !stale;

  const chooseRole = (role: Role) => {
    setRoleEdit(role === storedRole ? null : role);
    editor.resetToRoleDefaults();
  };

  const handleSaveAndApprove = async () => {
    setIsSaving(true);
    try {
      if (roleEdit) {
        await updateUserMutation.mutateAsync({ id: user.id, role: roleEdit });
      }
      const failures = await editor.save();
      if (failures > 0) throw new Error(`${failures} sezione/i non aggiornata/e`);

      await approveMutation.mutateAsync({ id: user.id, teamId: selectedTeamId });

      toast.success('Utente approvato con accesso configurato');
      onApproved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Errore durante l'approvazione");
      await editor.reconcile();
      try {
        const stored = await readPending();
        if (!stored) {
          endNoLongerPending();
          return;
        }
        setStoredRole(stored.role);
        // A role edit the store already reflects is no edit any more.
        setRoleEdit(roleEdit === stored.role ? null : roleEdit);
      } catch {
        setRoleReadFailed(true);
      }
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
          {stale && (
            <p className="text-sm text-destructive">
              Impossibile verificare lo stato salvato dell&apos;account: chiudi e riapri la finestra.
            </p>
          )}

          <div>
            <h3 className="text-sm font-semibold mb-3">Ruolo</h3>
            <Select
              value={shownRole ?? ''}
              // The items below are exactly the three roles, so the value is one of them.
              onValueChange={v => chooseRole(v as Role)}
              disabled={!ready || isSaving}
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
            {!stale && (
              <SectionAccessList
                role={shownRole ?? user.role}
                defaults={ready ? editor.defaults : undefined}
                overrides={editor.shown}
                onChange={editor.onChange}
                disabled={isSaving}
              />
            )}
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
                disabled={isSaving}
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
                disabled={!selectedFunctionId || isSaving}
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
          <Button onClick={handleSaveAndApprove} disabled={isSaving || !ready || !selectedTeamId}>
            {isSaving ? 'Approvazione...' : 'Salva e approva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
