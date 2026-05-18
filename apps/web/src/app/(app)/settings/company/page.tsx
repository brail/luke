'use client';

import { ImageIcon, Plus, Trash2, UploadCloud, Users } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { buildCompanyLogoUploadUrl, buildCompanyLogoUrl } from '@luke/core';

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
import { FileDropZone } from '../../../../components/ui/file-drop-zone';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Progress } from '../../../../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
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
  const { data: session } = useSession();

  const { data: profile, refetch } = trpc.company.profile.get.useQuery();
  const utils = trpc.useUtils();

  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [footerText, setFooterText] = useState('');
  const [accentColorHex, setAccentColorHex] = useState('#000000');
  const [locale, setLocale] = useState<'it-IT' | 'en-US'>('it-IT');
  const [dateFormat, setDateFormat] = useState<'DD/MM/YYYY' | 'YYYY-MM-DD'>('DD/MM/YYYY');
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const colorInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const logoPreviewUrl = logoKey ? buildCompanyLogoUrl(logoKey) : null;

  useEffect(() => {
    if (profile && !initialized) {
      setLegalName(profile.legalName ?? '');
      setDisplayName(profile.displayName ?? '');
      setVatNumber((profile.vatNumber as string) ?? '');
      setTaxCode((profile.taxCode as string) ?? '');
      setPhone((profile.phone as string) ?? '');
      setEmail((profile.email as string) ?? '');
      setWebsite((profile.website as string) ?? '');
      const es: Record<string, string> = (profile as any).exportSettings ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      setFooterText(es['footerText'] ?? '');
      setAccentColorHex(es['accentColorHex'] ?? '#000000');
      setLocale((es['locale'] as 'it-IT' | 'en-US') ?? 'it-IT');
      setDateFormat((es['dateFormat'] as 'DD/MM/YYYY' | 'YYYY-MM-DD') ?? 'DD/MM/YYYY');
      const key = profile.logoKey as string | null | undefined;
      setLogoKey(key ?? null);
      setInitialized(true);
    }
  }, [profile?.legalName, initialized]);

  useEffect(() => () => { xhrRef.current?.abort(); }, []);

  const updateMutation = trpc.company.profile.update.useMutation();

  const field = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  const handleLogoUpload = (file: File) => {
    setIsUploading(true);
    setUploadProgress(0);

    const formData = new globalThis.FormData();
    formData.append('file', file);

    const xhr = new globalThis.XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const result = JSON.parse(xhr.responseText);
          setLogoKey(result.key);
          toast.success('Logo caricato');
        } catch {
          toast.error('Errore durante il parsing della risposta');
        }
      } else {
        try {
          const errorData = JSON.parse(xhr.responseText);
          toast.error(errorData.message || 'Upload fallito');
        } catch {
          toast.error('Upload fallito');
        }
      }
      xhrRef.current = null;
      setIsUploading(false);
      setUploadProgress(0);
    });

    xhr.addEventListener('error', () => {
      toast.error('Errore di rete durante upload');
      xhrRef.current = null;
      setIsUploading(false);
      setUploadProgress(0);
    });

    xhr.open('POST', buildCompanyLogoUploadUrl());
    if (session?.accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${session.accessToken}`);
    }
    xhr.send(formData);
  };

  const handleLogoRemove = async () => {
    try {
      await updateMutation.mutateAsync({
        legalName: legalName.trim(),
        displayName: displayName.trim(),
        logoKey: undefined,
      });
      setLogoKey(null);
      toast.success('Logo rimosso');
      await utils.company.profile.get.invalidate();
    } catch (err) {
      toast.error(getTrpcErrorMessage(err));
    }
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
        exportSettings: {
          footerText: footerText.trim() || undefined,
          accentColorHex,
          locale,
          dateFormat,
        },
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
      <SectionCard title="Logo aziendale">
        <div className="space-y-3">
          {logoPreviewUrl ? (
            <div className="flex items-center gap-4">
              <img src={logoPreviewUrl} alt="Logo aziendale" className="h-16 w-auto rounded border object-contain p-1" />
              {canUpdate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleLogoRemove}
                  disabled={updateMutation.isPending}
                >
                  <Trash2 size={14} className="mr-1" />
                  Rimuovi
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon size={16} />
              <span>Nessun logo caricato</span>
            </div>
          )}
          {canUpdate && (
            <FileDropZone
              onFile={handleLogoUpload}
              accept={['image/png', 'image/jpeg', 'image/webp']}
              maxSizeMB={2}
              disabled={isUploading}
              className="cursor-pointer rounded-md border border-dashed p-4 text-center hover:bg-muted/40"
            >
              <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                <UploadCloud size={20} />
                <span>{isUploading ? `Caricamento… ${uploadProgress}%` : 'Trascina o clicca per caricare (PNG, JPG, WEBP, max 2MB)'}</span>
              </div>
            </FileDropZone>
          )}
          {isUploading && <Progress value={uploadProgress} className="h-1" />}
        </div>
      </SectionCard>

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

      <SectionCard title="Impostazioni export">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="footerText">Testo piè di pagina</Label>
            <Input
              id="footerText"
              value={footerText}
              onChange={field(setFooterText)}
              disabled={!canUpdate}
              placeholder="es. FEBOS S.r.l. — P.IVA 12345678901"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">{footerText.length}/200 caratteri</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="accentColor">Colore accento</Label>
              <div className="flex items-center gap-2">
                <div
                  className="h-9 w-9 cursor-pointer rounded-md border"
                  style={{ backgroundColor: accentColorHex }}
                  onClick={() => canUpdate && colorInputRef.current?.click()}
                />
                <Input
                  value={accentColorHex}
                  onChange={e => { setAccentColorHex(e.target.value); setDirty(true); }}
                  disabled={!canUpdate}
                  className="font-mono uppercase"
                  maxLength={7}
                />
                <input
                  ref={colorInputRef}
                  type="color"
                  className="sr-only"
                  value={accentColorHex}
                  onChange={e => { setAccentColorHex(e.target.value); setDirty(true); }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Lingua</Label>
              <Select
                value={locale}
                onValueChange={v => { setLocale(v as 'it-IT' | 'en-US'); setDirty(true); }}
                disabled={!canUpdate}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="it-IT">Italiano</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Formato data</Label>
              <Select
                value={dateFormat}
                onValueChange={v => { setDateFormat(v as 'DD/MM/YYYY' | 'YYYY-MM-DD'); setDirty(true); }}
                disabled={!canUpdate}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
