'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../components/CreateActionButton';
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
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

type PlanningGroup = RouterOutputs['planningGroup']['list'][number];

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

  const [groupForm, setGroupForm] = useState<GroupFormState>({ open: false });
  const [deletingGroup, setDeletingGroup] = useState<PlanningGroup | null>(null);
  const [name, setName] = useState('');

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

  const isEditingGroup = !!groupForm.group;

  const openCreate = () => { setName(''); setGroupForm({ open: true, group: null }); };
  const openRename = (group: PlanningGroup) => { setName(group.name); setGroupForm({ open: true, group }); };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Nome obbligatorio'); return; }
    if (isEditingGroup && groupForm.group) {
      renameMutation.mutate({ id: groupForm.group.id, name: trimmed });
    } else {
      createMutation.mutate({ calendarId, name: trimmed });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-[640px]">
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
                          {g.frozenAt ? (
                            <Badge variant="outline" className="text-xs">Congelato</Badge>
                          ) : (
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

      <Dialog open={groupForm.open} onOpenChange={v => { if (!v) setGroupForm({ open: false }); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isEditingGroup ? 'Rinomina gruppo' : 'Nuovo gruppo di pianificazione'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pg-name">Nome *</Label>
            <Input id="pg-name" value={name} onChange={e => setName(e.target.value)} placeholder="es. Promo estate" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupForm({ open: false })} disabled={createMutation.isPending || renameMutation.isPending}>
              Annulla
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || renameMutation.isPending}>
              {createMutation.isPending || renameMutation.isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingGroup}
        onOpenChange={v => { if (!v) setDeletingGroup(null); }}
        title="Elimina gruppo di pianificazione"
        description={`Sei sicuro di voler eliminare "${deletingGroup?.name}"? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => deletingGroup && deleteMutation.mutate({ id: deletingGroup.id })}
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
