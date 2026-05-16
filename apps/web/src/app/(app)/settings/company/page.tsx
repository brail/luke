'use client';

import { Plus, Users } from 'lucide-react';
import { type ChangeEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';
import { Textarea } from '../../../../components/ui/textarea';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { can } = usePermission();
  const canUpdate = can('company_profile:update');

  const { data: profile, refetch } = trpc.company.profile.get.useQuery();
  const utils = trpc.useUtils();

  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [dirty, setDirty] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (profile && !initialized) {
      setLegalName(profile.legalName ?? '');
      setDisplayName(profile.displayName ?? '');
      setVatNumber((profile.vatNumber as string) ?? '');
      setTaxCode((profile.taxCode as string) ?? '');
      setPhone((profile.phone as string) ?? '');
      setEmail((profile.email as string) ?? '');
      setWebsite((profile.website as string) ?? '');
      setInitialized(true);
    }
  }, [profile?.legalName, initialized]);

  const updateMutation = trpc.company.profile.update.useMutation();

  const field = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!legalName.trim() || !displayName.trim()) {
      toast.error('Ragione sociale e nome visualizzato sono obbligatori');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        legalName: legalName.trim(),
        displayName: displayName.trim(),
        vatNumber: vatNumber.trim() || undefined,
        taxCode: taxCode.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        website: website.trim() || undefined,
      });
      toast.success('Profilo aggiornato');
      setDirty(false);
      await utils.company.profile.get.invalidate();
      void refetch();
    } catch (err) {
      toast.error(getTrpcErrorMessage(err));
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <SectionCard title="Dati aziendali">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="legalName">Ragione sociale *</Label>
              <Input id="legalName" value={legalName} onChange={field(setLegalName)} disabled={!canUpdate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Nome visualizzato *</Label>
              <Input id="displayName" value={displayName} onChange={field(setDisplayName)} disabled={!canUpdate} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vatNumber">Partita IVA</Label>
              <Input id="vatNumber" value={vatNumber} onChange={field(setVatNumber)} disabled={!canUpdate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxCode">Codice fiscale</Label>
              <Input id="taxCode" value={taxCode} onChange={field(setTaxCode)} disabled={!canUpdate} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Telefono</Label>
              <Input id="phone" value={phone} onChange={field(setPhone)} disabled={!canUpdate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={field(setEmail)} disabled={!canUpdate} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website">Sito web</Label>
            <Input id="website" value={website} onChange={field(setWebsite)} disabled={!canUpdate} placeholder="https://…" />
          </div>
        </div>
        {canUpdate && (
          <div className="mt-4 flex justify-end">
            <Button onClick={handleSave} disabled={!dirty || updateMutation.isPending}>
              {updateMutation.isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Structure Tab ────────────────────────────────────────────────────────────

interface FunctionDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  fn?: { id: string; slug: string; name: string; description?: string | null };
}

function FunctionDialog({ open, onClose, onSaved, fn }: FunctionDialogProps) {
  const isEdit = !!fn;
  const [slug, setSlug] = useState(fn?.slug ?? '');
  const [name, setName] = useState(fn?.name ?? '');
  const [description, setDescription] = useState(fn?.description ?? '');

  const createMutation = trpc.company.function.create.useMutation({
    onSuccess: () => { toast.success('Funzione creata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const updateMutation = trpc.company.function.update.useMutation({
    onSuccess: () => { toast.success('Funzione aggiornata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (isEdit) {
      updateMutation.mutate({ id: fn.id, name: name.trim(), description: description.trim() || undefined });
    } else {
      if (!slug.trim()) { toast.error('Slug obbligatorio'); return; }
      createMutation.mutate({ slug: slug.trim(), name: name.trim(), description: description.trim() || undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica funzione' : 'Nuova funzione aziendale'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="fn-slug">Slug *</Label>
              <Input
                id="fn-slug"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="es. product"
              />
              <p className="text-xs text-muted-foreground">Identificatore unico, non modificabile dopo la creazione</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="fn-name">Nome *</Label>
            <Input id="fn-name" value={name} onChange={e => setName(e.target.value)} placeholder="es. Prodotto" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fn-desc">Descrizione</Label>
            <Textarea id="fn-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annulla</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? 'Salvataggio…' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TeamDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  functionId: string;
  team?: { id: string; name: string; description?: string | null };
}

function TeamDialog({ open, onClose, onSaved, functionId, team }: TeamDialogProps) {
  const isEdit = !!team;
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');

  const createMutation = trpc.company.team.create.useMutation({
    onSuccess: () => { toast.success('Team creato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const updateMutation = trpc.company.team.update.useMutation({
    onSuccess: () => { toast.success('Team aggiornato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (isEdit) {
      updateMutation.mutate({ id: team.id, name: name.trim(), description: description.trim() || undefined });
    } else {
      createMutation.mutate({ functionId, name: name.trim(), description: description.trim() || undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica team' : 'Nuovo team'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Nome *</Label>
            <Input id="team-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-desc">Descrizione</Label>
            <Textarea id="team-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annulla</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? 'Salvataggio…' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StructureTab() {
  const { can } = usePermission();
  const canCreateFn = can('company_function:create');
  const canUpdateFn = can('company_function:update');
  const canDeleteFn = can('company_function:delete');
  const canCreateTeam = can('company_team:create');
  const canUpdateTeam = can('company_team:update');
  const canDeleteTeam = can('company_team:delete');

  const { data: functions = [], refetch } = trpc.company.function.list.useQuery({ includeInactive: false });

  const [expandedFnIds, setExpandedFnIds] = useState<Set<string>>(new Set());
  const [fnDialog, setFnDialog] = useState<{ open: boolean; fn?: typeof functions[number] }>({ open: false });
  const [teamDialog, setTeamDialog] = useState<{ open: boolean; functionId: string; team?: { id: string; name: string; description?: string | null } }>({ open: false, functionId: '' });

  const deactivateMutation = trpc.company.function.deactivate.useMutation({
    onSuccess: () => { toast.success('Funzione disattivata'); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteTeamMutation = trpc.company.team.delete.useMutation({
    onSuccess: () => { toast.success('Team eliminato'); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const toggleFn = (id: string) => {
    setExpandedFnIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => setFnDialog({ open: true })}
          disabled={!canCreateFn}
        >
          <Plus size={14} className="mr-1" />
          Nuova funzione
        </Button>
      </div>

      {functions.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nessuna funzione aziendale configurata.
        </p>
      )}

      {functions.map(fn => {
        const expanded = expandedFnIds.has(fn.id);
        return (
          <SectionCard key={fn.id} title="">
            <div className="space-y-3">
              {/* Function header */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => toggleFn(fn.id)}
                >
                  <span className="font-semibold">{fn.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground font-mono">{fn.slug}</span>
                  {fn.description && (
                    <span className="ml-2 text-sm text-muted-foreground">— {fn.description}</span>
                  )}
                </button>
                <div className="flex gap-1 shrink-0">
                  {canUpdateFn && (
                    <Button variant="ghost" size="sm" onClick={() => setFnDialog({ open: true, fn })}>
                      Modifica
                    </Button>
                  )}
                  {canDeleteFn && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deactivateMutation.mutate({ id: fn.id })}
                      disabled={deactivateMutation.isPending}
                    >
                      Disattiva
                    </Button>
                  )}
                </div>
              </div>

              {/* Teams (lazy) */}
              {expanded && (
                <FunctionTeams
                  functionId={fn.id}
                  canCreateTeam={canCreateTeam}
                  canUpdateTeam={canUpdateTeam}
                  canDeleteTeam={canDeleteTeam}
                  onAddTeam={() => setTeamDialog({ open: true, functionId: fn.id })}
                  onEditTeam={team => setTeamDialog({ open: true, functionId: fn.id, team })}
                  onDeleteTeam={teamId => deleteTeamMutation.mutate({ id: teamId })}
                />
              )}

              {!expanded && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => toggleFn(fn.id)}
                >
                  Espandi per vedere i team →
                </button>
              )}
            </div>
          </SectionCard>
        );
      })}

      <FunctionDialog
        open={fnDialog.open}
        fn={fnDialog.fn}
        onClose={() => setFnDialog({ open: false })}
        onSaved={() => { setFnDialog({ open: false }); void refetch(); }}
      />

      <TeamDialog
        open={teamDialog.open}
        functionId={teamDialog.functionId}
        team={teamDialog.team}
        onClose={() => setTeamDialog({ open: false, functionId: '' })}
        onSaved={() => { setTeamDialog({ open: false, functionId: '' }); void refetch(); }}
      />
    </div>
  );
}

interface FunctionTeamsProps {
  functionId: string;
  canCreateTeam: boolean;
  canUpdateTeam: boolean;
  canDeleteTeam: boolean;
  onAddTeam: () => void;
  onEditTeam: (team: { id: string; name: string; description?: string | null }) => void;
  onDeleteTeam: (id: string) => void;
}

function FunctionTeams({ functionId, canCreateTeam, canUpdateTeam, canDeleteTeam, onAddTeam, onEditTeam, onDeleteTeam }: FunctionTeamsProps) {
  const { data: teams = [] } = trpc.company.team.listByFunction.useQuery({ functionId });

  return (
    <div className="border rounded-md divide-y">
      {teams.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-2">Nessun team</p>
      )}
      {teams.map(team => (
        <div key={team.id} className="flex items-center gap-2 px-3 py-2">
          <Users size={14} className="text-muted-foreground shrink-0" />
          <span className="text-sm flex-1">{team.name}</span>
          {team.isMain && <Badge variant="secondary" className="text-xs">main</Badge>}
          <span className="text-xs text-muted-foreground">{(team as any)._count?.memberships ?? 0} membri</span>
          {canUpdateTeam && !team.isMain && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onEditTeam(team)}>
              Modifica
            </Button>
          )}
          {canDeleteTeam && !team.isMain && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive hover:text-destructive"
              onClick={() => onDeleteTeam(team.id)}
            >
              Elimina
            </Button>
          )}
        </div>
      ))}
      {canCreateTeam && (
        <div className="px-3 py-1.5">
          <Button variant="ghost" size="sm" className="text-xs h-6" onClick={onAddTeam}>
            <Plus size={12} className="mr-1" />
            Aggiungi team
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompanySettingsPage() {
  return (
    <>
      <PageHeader
        title="Azienda"
        description="Gestisci il profilo aziendale e la struttura organizzativa"
      />
      <Tabs defaultValue="profile" className="mt-6">
        <TabsList>
          <TabsTrigger value="profile">Profilo</TabsTrigger>
          <TabsTrigger value="structure">Struttura organizzativa</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="structure" className="mt-6">
          <StructureTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
