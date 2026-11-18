'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { isSyntheticLdapEmail, MailableEmailSchema, type Role } from '@luke/core';

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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../../components/ui/form';
import { Input } from '../../../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { usePermission } from '../../../../../hooks/usePermission';
import { parseRole, ROLE_LABELS, ROLES_LEAST_FIRST } from '../../../../../lib/roles';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

import { SectionAccessList } from './SectionAccessList';
import { type UserForApproval } from './types';
import { useSectionOverridesEditor } from './useSectionOverridesEditor';

/** What the administrator types: the address, asked for only when the stored one is synthetic (#272). */
interface ApproveFormData {
  email: string;
}

// Annotated `z.ZodType<T, T>` so the conditional resolver below type-checks (Zod v4).
const WITH_EMAIL: z.ZodType<ApproveFormData, ApproveFormData> = z.object({ email: MailableEmailSchema });
const WITHOUT_EMAIL: z.ZodType<ApproveFormData, ApproveFormData> = z.object({ email: z.string() });

interface ApproveUserDialogProps {
  user: UserForApproval;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: () => void;
}

/**
 * Dialog that forces an admin to configure role and section access before approving a pending user,
 * and to give a real address when the stored one is synthetic (#272). Whoever else may approve
 * (`users:update`) approves the account as it stands: address, role and section overrides take `*:*`
 * on the server, so for them the dialog shows the role read-only, reads no section overrides and
 * edits nothing — only the team is chosen.
 *
 * An attempt is one `approvePending` call carrying the address (only if synthetic), the role (only
 * if the administrator changed it), the override edits and the team, applied in one transaction
 * (ADR-044); every control is disabled for its whole length. After a failure nothing of it is
 * stored, and the dialog re-reads the stored role, the pending status and the overrides before
 * another attempt (ADR-027).
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
  const { can } = usePermission();
  const configures = can('*:*');
  const editor = useSectionOverridesEditor({ userId: user.id, open: open && configures });

  /** The role stored for the account, from the last read; `null` until the first one answers. */
  const [storedRole, setStoredRole] = useState<Role | null>(null);
  /** The address stored for the account, from the last read; the list's until the first one answers. */
  const [storedEmail, setStoredEmail] = useState(user.email);
  /** The role the administrator chose, while it differs from the stored one. */
  const [roleEdit, setRoleEdit] = useState<Role | null>(null);
  const [roleReadFailed, setRoleReadFailed] = useState(false);
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  /** The address is asked for, of an administrator, only while the stored one is synthetic. */
  const asksEmail = configures && isSyntheticLdapEmail(storedEmail);
  const form = useForm<ApproveFormData>({
    resolver: zodResolver(asksEmail ? WITH_EMAIL : WITHOUT_EMAIL),
    defaultValues: { email: '' },
  });
  // The dialog stays mounted between openings: each one starts from an empty address.
  useEffect(() => {
    if (open) form.reset({ email: '' });
  }, [open, form]);

  const { data: functions = [] } = trpc.company.function.list.useQuery(undefined, { enabled: open });
  const { data: teams = [] } = trpc.company.team.listByFunction.useQuery(
    { functionId: selectedFunctionId },
    { enabled: open && !!selectedFunctionId }
  );

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
    setStoredEmail(user.email);
    setRoleEdit(null);
    setRoleReadFailed(false);
  }

  useEffect(() => {
    if (!open) return;
    let current = true;
    readPending().then(
      stored => {
        if (!current) return;
        if (stored) {
          setStoredRole(stored.role);
          setStoredEmail(stored.email);
        }
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
  const ready = shownRole !== null && (!configures || editor.defaults !== undefined) && !stale;

  const chooseRole = (role: Role) => {
    setRoleEdit(role === storedRole ? null : role);
    editor.resetToRoleDefaults();
  };

  const handleSaveAndApprove = async ({ email }: ApproveFormData) => {
    setIsSaving(true);
    try {
      await approveMutation.mutateAsync({
        id: user.id,
        teamId: selectedTeamId,
        email: asksEmail ? email : undefined,
        role: roleEdit ?? undefined,
        sectionOverrides: editor.sendable,
      });

      toast.success('Utente approvato con accesso configurato');
      onApproved();
    } catch (e: unknown) {
      toast.error(getTrpcErrorMessage(e));
      if (configures) await editor.reconcile();
      try {
        const stored = await readPending();
        if (!stored) {
          endNoLongerPending();
          return;
        }
        setStoredRole(stored.role);
        // An address the user gave meanwhile ends the field: the next attempt sends none (#272).
        setStoredEmail(stored.email);
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

        <Form {...form}>
          {/* The DialogContent sets its own column layout, so the form takes it over (not `grid gap-4`). */}
          <form onSubmit={form.handleSubmit(handleSaveAndApprove)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-6">
              {stale && (
                <p className="text-sm text-destructive">
                  Impossibile verificare lo stato salvato dell&apos;account: chiudi e riapri la finestra.
                </p>
              )}

              {asksEmail && (
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold">Email *</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        La directory non fornisce un indirizzo per questo utente: inseriscine uno reale:
                        riceverà lì l&apos;avviso di approvazione.
                      </p>
                      <FormControl>
                        <Input type="email" {...field} disabled={isSaving} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div>
                <h3 className="text-sm font-semibold mb-3">Ruolo</h3>
                <Select
                  value={shownRole ?? ''}
                  onValueChange={v => {
                    const role = parseRole(v);
                    if (role) chooseRole(role);
                  }}
                  disabled={!configures || !ready || isSaving}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES_LEAST_FIRST.map(role => (
                      <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Visibilità sezioni</h3>
                {!configures && (
                  <p className="text-sm text-muted-foreground">
                    Ruolo e visibilità sezioni restano quelli dell&apos;account: solo un amministratore
                    può cambiarli.
                  </p>
                )}
                {configures && !stale && (
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
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={isSaving || !ready || !selectedTeamId}>
                {isSaving ? 'Approvazione...' : 'Salva e approva'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
