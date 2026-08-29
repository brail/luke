'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import type { RouterOutputs } from '@luke/api';
import { PlanningGroupInputSchema } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
import { LastModifiedBy } from '../../../../components/LastModifiedBy';
import { PermissionButton } from '../../../../components/PermissionButton';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../components/ui/form';
import { Input } from '../../../../components/ui/input';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

type PlanningGroup = RouterOutputs['planningGroup']['list'][number];

/**
 * Same shape the create and rename mutations accept. The length message is spelled out here: the
 * core schema carries no copy, and Zod's default for `min(1)` talks about string length rather
 * than about the field being required.
 */
const PlanningGroupFormSchema = PlanningGroupInputSchema.extend({
  name: z.string().min(1, 'Il nome è obbligatorio').max(100, 'Massimo 100 caratteri'),
});

type PlanningGroupFormData = z.infer<typeof PlanningGroupFormSchema>;

interface GroupFormState {
  open: boolean;
  group?: PlanningGroup | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  calendarId: string;
  brandId: string;
  seasonId: string;
}

/**
 * Manages the current calendar's PlanningGroups: create, rename, delete.
 *
 * Every calendar has one default group (auto-created, non-editable/non-deletable); additional
 * groups can be created here to support parallel plans. Deleting a group requires it to have no
 * rows or events assigned — reassign them first.
 */
export function ManagePlanningGroupsDialog({ open, onClose, calendarId, brandId, seasonId }: Props) {
  const { can } = usePermission();
  const canWrite = can('season_calendar:update');
  const canFreeze = can('season_calendar:freeze');

  const [groupForm, setGroupForm] = useState<GroupFormState>({ open: false });
  const [deletingGroup, setDeletingGroup] = useState<PlanningGroup | null>(null);

  const form = useForm<PlanningGroupFormData>({
    resolver: zodResolver(PlanningGroupFormSchema),
    defaultValues: { name: '' },
  });

  const { data: groups = [], isLoading, refetch } = trpc.planningGroup.list.useQuery(
    { brandId, seasonId },
    { enabled: open }
  );

  const createMutation = trpc.planningGroup.create.useMutation({
    onSuccess: () => { toast.success('Gruppo creato'); setGroupForm({ open: false }); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const renameMutation = trpc.planningGroup.rename.useMutation({
    onSuccess: () => { toast.success('Gruppo rinominato'); setGroupForm({ open: false }); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const deleteMutation = trpc.planningGroup.delete.useMutation({
    onSuccess: () => { toast.success('Gruppo eliminato'); setDeletingGroup(null); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err, { CONFLICT: 'Il gruppo contiene ancora righe o eventi — riassegnali prima di eliminarlo' })),
  });
  const amendMutation = trpc.seasonCalendar.amendPlanningGroupFreeze.useMutation({
    onSuccess: result => { toast.success(`Freeze esteso — ${result.amendedCount} eventi aggiornati`); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const isEditingGroup = !!groupForm.group;
  const isSavingGroup = createMutation.isPending || renameMutation.isPending;

  const openCreate = () => setGroupForm({ open: true, group: null });
  const openRename = (group: PlanningGroup) => setGroupForm({ open: true, group });

  // The inner dialog stays mounted, so it has to be seeded on every open: with the group's name
  // when renaming, empty when creating.
  useEffect(() => {
    if (groupForm.open) form.reset({ name: groupForm.group?.name ?? '' });
  }, [groupForm, form]);

  const handleSave = (data: PlanningGroupFormData) => {
    const name = data.name.trim();
    if (groupForm.group) {
      renameMutation.mutate({ id: groupForm.group.id, name });
    } else {
      createMutation.mutate({ calendarId, name });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-[640px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
          <DialogHeader>
            <DialogTitle>Gruppi di pianificazione</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Disaccoppiano eventi e righe di collezione: ogni riga e ogni evento appartengono a un
            gruppo, e un evento si applica solo alle righe del proprio gruppo.
          </p>

          <div className="flex justify-end">
            <CreateActionButton
              label="Nuovo gruppo"
              canCreate={canWrite}
              resourceName="gruppo di pianificazione"
              onClick={openCreate}
            />
          </div>

          <div className="rounded-md border">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Caricamento…</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">Nome</th>
                    <th className="px-4 py-2 text-left font-medium">Righe CL</th>
                    <th className="px-4 py-2 text-left font-medium">Eventi</th>
                    <th className="px-4 py-2 text-left font-medium">Stato</th>
                    <th className="w-20 px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => {
                    const canDeleteGroup = canWrite && !g.isDefault && g._count.events === 0 && g._count.rows === 0;
                    const canRenameGroup = canWrite && !g.isDefault;
                    return (
                      <tr key={g.id} className="border-b last:border-0">
                        <td className="px-4 py-2 font-medium">
                          {g.name}
                          {g.isDefault && <Badge variant="secondary" className="ml-2 text-xs">predefinito</Badge>}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground tabular-nums">{g._count.rows}</td>
                        <td className="px-4 py-2 text-muted-foreground tabular-nums">{g._count.events}</td>
                        <td className="px-4 py-2">
                          {g.freezeState === 'frozen' && (
                            <div className="space-y-0.5">
                              <Badge variant="outline" className="text-xs">Congelato</Badge>
                              {/* 11px: below Tailwind's text-xs (12px) floor; dense freeze-status caption */}
                              <LastModifiedBy targetType="PlanningGroup" targetId={g.id} className="text-[11px] text-muted-foreground" />
                            </div>
                          )}
                          {g.freezeState === 'frozen-partial' && (
                            <div className="space-y-1">
                              <Badge
                                variant="outline"
                                className="text-xs border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400"
                              >
                                Freeze parziale
                              </Badge>
                              <div>
                                <PermissionButton
                                  hasPermission={canFreeze}
                                  tooltip="Non hai i permessi per estendere il freeze"
                                  size="sm"
                                  variant="outline"
                                  // 11px: below Tailwind's text-xs (12px) floor; compact inline action button
                                  className="h-6 text-[11px] px-2"
                                  onClick={() => amendMutation.mutate({ planningGroupId: g.id })}
                                >
                                  {amendMutation.isPending ? 'Estensione…' : 'Estendi freeze'}
                                </PermissionButton>
                              </div>
                            </div>
                          )}
                          {g.freezeState === 'unfrozen' && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">—</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <PermissionButton
                              hasPermission={canRenameGroup}
                              tooltip={g.isDefault ? 'Il gruppo predefinito non può essere rinominato' : 'Non hai i permessi per rinominare'}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => openRename(g)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </PermissionButton>
                            <PermissionButton
                              hasPermission={canDeleteGroup}
                              tooltip={
                                g.isDefault
                                  ? 'Il gruppo predefinito non può essere eliminato'
                                  : g._count.events > 0 || g._count.rows > 0
                                    ? 'Riassegna righe ed eventi prima di eliminare'
                                    : 'Non hai i permessi per eliminare'
                              }
                              size="icon-sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setDeletingGroup(g)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </PermissionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {groups.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">
                        Nessun gruppo di pianificazione
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={groupForm.open}
        onOpenChange={v => { if (!v && !isSavingGroup) setGroupForm({ open: false }); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isEditingGroup ? 'Rinomina gruppo' : 'Nuovo gruppo di pianificazione'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSave)} className="grid gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Nome *</FormLabel>
                    <FormControl>
                      <Input placeholder="es. Promo estate" disabled={isSavingGroup} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGroupForm({ open: false })}
                  disabled={isSavingGroup}
                >
                  Annulla
                </Button>
                <Button type="submit" disabled={isSavingGroup}>
                  {isSavingGroup ? 'Salvataggio…' : 'Salva'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingGroup}
        onOpenChange={v => { if (!v) setDeletingGroup(null); }}
        title="Elimina gruppo di pianificazione"
        description={`Sei sicuro di voler eliminare "${deletingGroup?.name}"? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        actionType="delete"
        onConfirm={() => deletingGroup && deleteMutation.mutate({ id: deletingGroup.id })}
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
