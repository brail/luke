'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { CompanyTeamInputSchema } from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../../components/ui/tabs';
import { Textarea } from '../../../../../components/ui/textarea';
import { usePermission } from '../../../../../hooks/usePermission';
import { useRefresh } from '../../../../../lib/refresh';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

// ── helpers ──────────────────────────────────────────────────────────────────

function displayName(u: { firstName?: string | null; lastName?: string | null; username: string }) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ');
  return full || u.username;
}

/**
 * The fields both team dialogs collect by typing. `description` is narrowed to a plain string so
 * the Textarea stays controlled; it is mapped back to `undefined` on submit.
 */
const TeamFormSchema = CompanyTeamInputSchema.pick({ name: true, description: true }).extend({
  name: z.string().min(1, 'Il nome è obbligatorio').max(80, 'Massimo 80 caratteri'),
  description: z.string().max(500, 'Massimo 500 caratteri'),
});

type TeamFormData = z.infer<typeof TeamFormSchema>;

const EMPTY_TEAM: TeamFormData = { name: '', description: '' };

// ── CreateTeamDialog ──────────────────────────────────────────────────────────

interface CreateTeamDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  functionId: string;
}

/**
 * Modal dialog for creating a new team inside a given company function.
 * @param functionId - ID of the parent company function the team will belong to
 */
export function CreateTeamDialog({ open, onClose, onSaved, functionId }: CreateTeamDialogProps) {
  const form = useForm<TeamFormData>({
    resolver: zodResolver(TeamFormSchema),
    defaultValues: EMPTY_TEAM,
  });

  const createMutation = trpc.company.team.create.useMutation({
    onSuccess: () => { toast.success('Team creato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  // The dialog stays mounted, so it reopens on whatever was typed last unless reset.
  useEffect(() => {
    if (open) form.reset(EMPTY_TEAM);
  }, [open, form]);

  const handleCreate = (data: TeamFormData) => {
    createMutation.mutate({
      functionId,
      name: data.name.trim(),
      description: data.description.trim() || undefined,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={v => { if (!v && !createMutation.isPending) onClose(); }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo team</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleCreate)} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Nome *</FormLabel>
                    <FormControl>
                      <Input autoFocus disabled={createMutation.isPending} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Descrizione</FormLabel>
                    <FormControl>
                      <Textarea rows={2} disabled={createMutation.isPending} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={createMutation.isPending}>
                Annulla
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creazione…' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── EditTeamDialog ────────────────────────────────────────────────────────────

interface EditTeamDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  teamId: string;
}

/**
 * Modal dialog for editing an existing team: name/description, member list, and brand access scopes.
 * Uses tabbed layout (Info / Membri / Brand) and batches member add/remove mutations on save.
 * @param teamId - ID of the team to load and edit
 */
export function EditTeamDialog({ open, onClose, onSaved, teamId }: EditTeamDialogProps) {
  const { can } = usePermission();
  const canUpdate = can('company_team:update');
  const refresh = useRefresh();

  const { data: team, isLoading: teamLoading } = trpc.company.team.getById.useQuery(
    { id: teamId },
    { enabled: open },
  );
  const { data: brands = [] } = trpc.company.team.listAllBrands.useQuery(undefined, { enabled: open });
  const { data: usersData } = trpc.users.list.useQuery({ limit: 100 }, { enabled: open });
  const allUsers = usersData?.users ?? [];

  const form = useForm<TeamFormData>({
    resolver: zodResolver(TeamFormSchema),
    defaultValues: EMPTY_TEAM,
  });

  // Brands and members stay outside the form: the brand set feeds the same update call but is
  // driven by checkboxes, and the member list is diffed against the server's into two separate
  // add/remove mutations. The form holds what is typed.
  const [selectedBrandIds, setSelectedBrandIds] = useState<Set<string>>(new Set());
  const [localMemberIds, setLocalMemberIds] = useState<string[]>([]);
  const [addMemberValue, setAddMemberValue] = useState('');

  useEffect(() => {
    if (!team) return;
    form.reset({ name: team.name, description: team.description ?? '' });
    setSelectedBrandIds(new Set(team.brandScopes.map(s => s.brandId)));
    setLocalMemberIds(team.memberships.map(m => m.userId));
  }, [team, form]);

  const userMap = useMemo(() => {
    const map = new Map<string, { id: string; email: string; username: string; firstName?: string | null; lastName?: string | null }>();
    allUsers.forEach(u => map.set(u.id, u));
    team?.memberships.forEach(m => {
      if (!map.has(m.userId)) {
        map.set(m.userId, { id: m.userId, email: m.user.email, username: m.user.username, firstName: null, lastName: null });
      }
    });
    return map;
  }, [allUsers, team]);

  const updateMutation = trpc.company.team.update.useMutation({ onError: err => toast.error(getTrpcErrorMessage(err)) });
  const addMembersMutation = trpc.company.team.addMembers.useMutation({ onError: err => toast.error(getTrpcErrorMessage(err)) });
  const removeMembersMutation = trpc.company.team.removeMembers.useMutation({ onError: err => toast.error(getTrpcErrorMessage(err)) });
  const isPending = updateMutation.isPending || addMembersMutation.isPending || removeMembersMutation.isPending;

  const handleSave = async (data: TeamFormData) => {
    const originalIds = new Set(team?.memberships.map(m => m.userId) ?? []);
    const toAdd = localMemberIds.filter(id => !originalIds.has(id));
    const toRemove = [...originalIds].filter(id => !localMemberIds.includes(id));
    try {
      await updateMutation.mutateAsync({ id: teamId, name: data.name.trim(), description: data.description.trim() || undefined, brandIds: [...selectedBrandIds] });
      const ops: Promise<unknown>[] = [];
      if (toAdd.length > 0) ops.push(addMembersMutation.mutateAsync({ teamId, userIds: toAdd }));
      if (toRemove.length > 0) ops.push(removeMembersMutation.mutateAsync({ teamId, userIds: toRemove }));
      await Promise.all(ops);
      toast.success('Team aggiornato');
      await refresh.company();
      onSaved();
      onClose();
    } catch {
      // errors already toasted
    }
  };

  const toggleBrand = (brandId: string) =>
    setSelectedBrandIds(prev => {
      const next = new Set(prev);
      next.has(brandId) ? next.delete(brandId) : next.add(brandId);
      return next;
    });

  const availableUsers = allUsers.filter(u => u.isActive && !localMemberIds.includes(u.id));

  const memberRole = (userId: string) =>
    team?.memberships.find(m => m.userId === userId)?.role ?? 'MEMBER';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isPending) onClose(); }}>
      <DialogContent className="flex max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{team?.name ?? 'Gestione team'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          {/* flex, not the usual grid: this DialogContent overrides its own layout with
              `flex flex-col gap-0 p-0`, and the form has to stay transparent to it. */}
          <form onSubmit={form.handleSubmit(handleSave)} className="flex min-h-0 flex-1 flex-col">
        {teamLoading ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Caricamento…</div>
        ) : (
          <Tabs defaultValue="info" className="flex-1">
            <div className="border-b px-6">
              <TabsList className="h-10 rounded-none bg-transparent p-0">
                <TabsTrigger value="info" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
                  Informazioni
                </TabsTrigger>
                <TabsTrigger value="members" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
                  Membri ({localMemberIds.length})
                </TabsTrigger>
                <TabsTrigger value="brands" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
                  Brand {selectedBrandIds.size > 0 ? `(${selectedBrandIds.size})` : '(nessuno)'}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Informazioni ── */}
            <TabsContent value="info" className="px-6 py-4">
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Nome *</FormLabel>
                      <FormControl>
                        <Input disabled={!canUpdate || isPending} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Descrizione</FormLabel>
                      <FormControl>
                        <Textarea rows={3} disabled={!canUpdate || isPending} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            {/* ── Membri ── */}
            <TabsContent value="members" className="px-6 py-4">
              <div className="space-y-4">
                {canUpdate && availableUsers.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Select value={addMemberValue} onValueChange={userId => {
                      setLocalMemberIds(prev => prev.includes(userId) ? prev : [...prev, userId]);
                      setAddMemberValue('');
                    }}>
                      <SelectTrigger className="flex-1 text-sm">
                        <SelectValue placeholder="Aggiungi membro…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableUsers.map(u => (
                          <SelectItem key={u.id} value={u.id}>
                            {displayName(u)} — {u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {localMemberIds.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Nessun membro. Aggiungi utenti dal menu sopra.</p>
                ) : (
                  <div className="divide-y rounded-md border">
                    {localMemberIds.map(userId => {
                      const u = userMap.get(userId);
                      const role = memberRole(userId);
                      return (
                        <div key={userId} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{u ? displayName(u) : userId}</span>
                            {u?.email && <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>}
                          </div>
                          <Badge variant={role === 'LEADER' ? 'default' : 'secondary'} className="text-xs shrink-0">
                            {role === 'LEADER' ? 'Leader' : 'Membro'}
                          </Badge>
                          {canUpdate && (
                            <button
                              type="button"
                              className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                              onClick={() => setLocalMemberIds(prev => prev.filter(id => id !== userId))}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Brand Access ── */}
            <TabsContent value="brands" className="px-6 py-4">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {selectedBrandIds.size === 0
                    ? 'Nessun brand selezionato — i membri di questo team non avranno accesso a nessun brand finché non ne assegni almeno uno.'
                    : `${selectedBrandIds.size} brand selezionati — i membri vedranno solo questi.`}
                </p>
                {brands.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nessun brand disponibile</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {brands.map(brand => (
                      <label key={brand.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition-colors hover:bg-muted/40">
                        <Checkbox
                          checked={selectedBrandIds.has(brand.id)}
                          onCheckedChange={() => toggleBrand(brand.id)}
                          disabled={!canUpdate}
                        />
                        <span className="font-mono text-xs font-medium text-muted-foreground">{brand.code}</span>
                        <span className="flex-1 truncate">{brand.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Annulla</Button>
          {canUpdate && (
            <Button type="submit" disabled={isPending || teamLoading}>
              {isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          )}
        </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
