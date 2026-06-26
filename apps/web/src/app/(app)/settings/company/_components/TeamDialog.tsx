'use client';

import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

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
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
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

// ── CreateTeamDialog ──────────────────────────────────────────────────────────

interface CreateTeamDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  functionId: string;
}

export function CreateTeamDialog({ open, onClose, onSaved, functionId }: CreateTeamDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) { setName(''); setDescription(''); }
  }, [open]);

  const createMutation = trpc.company.team.create.useMutation({
    onSuccess: () => { toast.success('Team creato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo team</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ct-name">Nome *</Label>
            <Input id="ct-name" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-desc">Descrizione</Label>
            <Textarea id="ct-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>Annulla</Button>
          <Button
            onClick={() => createMutation.mutate({ functionId, name: name.trim(), description: description.trim() || undefined })}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? 'Creazione…' : 'Crea'}
          </Button>
        </DialogFooter>
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

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedBrandIds, setSelectedBrandIds] = useState<Set<string>>(new Set());
  const [localMemberIds, setLocalMemberIds] = useState<string[]>([]);
  const [addMemberValue, setAddMemberValue] = useState('');

  useEffect(() => {
    if (!team) return;
    setName(team.name);
    setDescription(team.description ?? '');
    setSelectedBrandIds(new Set(team.brandScopes.map(s => s.brandId)));
    setLocalMemberIds(team.memberships.map(m => m.userId));
  }, [team]);

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

  const handleSave = async () => {
    if (!name.trim()) return;
    const originalIds = new Set(team?.memberships.map(m => m.userId) ?? []);
    const toAdd = localMemberIds.filter(id => !originalIds.has(id));
    const toRemove = [...originalIds].filter(id => !localMemberIds.includes(id));
    try {
      await updateMutation.mutateAsync({ id: teamId, name: name.trim(), description: description.trim() || undefined, brandIds: [...selectedBrandIds] });
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
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="flex max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{team?.name ?? 'Gestione team'}</DialogTitle>
        </DialogHeader>

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
                  Brand {selectedBrandIds.size > 0 ? `(${selectedBrandIds.size})` : '(tutti)'}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Informazioni ── */}
            <TabsContent value="info" className="px-6 py-4">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="et-name">Nome *</Label>
                  <Input id="et-name" value={name} onChange={e => setName(e.target.value)} disabled={!canUpdate} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="et-desc">Descrizione</Label>
                  <Textarea id="et-desc" value={description} onChange={e => setDescription(e.target.value)} rows={3} disabled={!canUpdate} />
                </div>
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
                    ? 'Nessuna selezione — questo team ha accesso a tutti i brand.'
                    : `${selectedBrandIds.size} brand selezionati. Deseleziona tutto per accesso universale.`}
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
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annulla</Button>
          {canUpdate && (
            <Button onClick={() => void handleSave()} disabled={isPending || !name.trim() || teamLoading}>
              {isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
