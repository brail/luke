'use client';

import { ImageIcon, Plus, Trash2, UploadCloud, Users, X } from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import { Checkbox } from '../../../../components/ui/checkbox';
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
import { Separator } from '../../../../components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../../../components/ui/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';
import { Textarea } from '../../../../components/ui/textarea';
import { usePermission } from '../../../../hooks/usePermission';
import { useStorageUpload } from '../../../../hooks/useStorageUpload';
import { useRefresh } from '../../../../lib/refresh';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { can } = usePermission();
  const canUpdate = can('company_profile:update');

  const { data: profile } = trpc.company.profile.get.useQuery();
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
  const [dirty, setDirty] = useState(false);

  const colorInputRef = useRef<HTMLInputElement>(null);

  const logoPreviewUrl = logoKey ? buildCompanyLogoUrl(logoKey) : null;

  const { upload, isUploading, progress: uploadProgress } = useStorageUpload({
    fallbackProxyUrl: buildCompanyLogoUploadUrl(),
  });

  const syncFromProfile = (p: typeof profile) => {
    if (!p) return;
    setLegalName(p.legalName ?? '');
    setDisplayName(p.displayName ?? '');
    setVatNumber((p.vatNumber as string) ?? '');
    setTaxCode((p.taxCode as string) ?? '');
    setPhone((p.phone as string) ?? '');
    setEmail((p.email as string) ?? '');
    setWebsite((p.website as string) ?? '');
    const es: Record<string, string> = (p as any).exportSettings ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    setFooterText(es['footerText'] ?? '');
    setAccentColorHex(es['accentColorHex'] ?? '#000000');
    setLocale((es['locale'] as 'it-IT' | 'en-US') ?? 'it-IT');
    setDateFormat((es['dateFormat'] as 'DD/MM/YYYY' | 'YYYY-MM-DD') ?? 'DD/MM/YYYY');
    setLogoKey((p.logoKey as string | null | undefined) ?? null);
    setDirty(false);
  };

  useEffect(() => { syncFromProfile(profile); }, [profile?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = () => syncFromProfile(profile);

  const updateMutation = trpc.company.profile.update.useMutation();

  const field = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  const handleLogoUpload = async (file: File) => {
    try {
      const result = await upload(file, 'company-assets');
      setLogoKey(result.key ?? null);
      setDirty(true);
      toast.success('Logo caricato — clicca Salva per confermare');
    } catch (err) {
      toast.error(getTrpcErrorMessage(err));
    }
  };

  const handleLogoRemove = () => {
    setLogoKey(null);
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
        logoKey: logoKey,
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
      </SectionCard>

      {canUpdate && dirty && (
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background py-3">
          <Button variant="outline" onClick={handleReset} disabled={updateMutation.isPending}>
            Annulla
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={updateMutation.isPending || !legalName.trim() || !displayName.trim()}
          >
            {updateMutation.isPending ? 'Salvataggio…' : 'Salva modifiche'}
          </Button>
        </div>
      )}
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
}

function TeamDialog({ open, onClose, onSaved, functionId }: TeamDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = trpc.company.team.create.useMutation({
    onSuccess: () => { toast.success('Team creato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = createMutation.isPending;

  const handleSubmit = () => {
    if (!name.trim()) return;
    createMutation.mutate({ functionId, name: name.trim(), description: description.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo team</DialogTitle>
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
            {isPending ? 'Creazione…' : 'Crea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Team Sheet (edit existing team: info + brand scopes + members) ───────────

interface TeamSheetProps {
  open: boolean;
  teamId: string | null;
  canUpdate: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function TeamSheet({ open, teamId, canUpdate, onClose, onSaved }: TeamSheetProps) {
  const refresh = useRefresh();
  const { data: team, isLoading: teamLoading } = trpc.company.team.getById.useQuery(
    { id: teamId! },
    { enabled: !!teamId && open },
  );
  const { data: brands = [] } = trpc.company.team.listAllBrands.useQuery(undefined, { enabled: open });
  const { data: usersData } = trpc.users.list.useQuery(
    { limit: 100 },
    { enabled: open },
  );

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
      if (!map.has(m.userId)) map.set(m.userId, { id: m.userId, email: m.user.email, username: m.user.username, firstName: null, lastName: null });
    });
    return map;
  }, [allUsers, team]);

  const updateMutation = trpc.company.team.update.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const addMembersMutation = trpc.company.team.addMembers.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const removeMembersMutation = trpc.company.team.removeMembers.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = updateMutation.isPending || addMembersMutation.isPending || removeMembersMutation.isPending;

  const handleSave = async () => {
    if (!teamId || !name.trim()) return;
    const originalIds = new Set(team?.memberships.map(m => m.userId) ?? []);
    const currentIds = new Set(localMemberIds);
    const toAdd = [...currentIds].filter(id => !originalIds.has(id));
    const toRemove = [...originalIds].filter(id => !currentIds.has(id));
    try {
      await updateMutation.mutateAsync({
        id: teamId,
        name: name.trim(),
        description: description.trim() || undefined,
        brandIds: [...selectedBrandIds],
      });
      if (toAdd.length > 0) await addMembersMutation.mutateAsync({ teamId, userIds: toAdd });
      if (toRemove.length > 0) await removeMembersMutation.mutateAsync({ teamId, userIds: toRemove });
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

  const handleAddMember = (userId: string) => {
    setLocalMemberIds(prev => prev.includes(userId) ? prev : [...prev, userId]);
    setAddMemberValue('');
  };

  const handleRemoveMember = (userId: string) =>
    setLocalMemberIds(prev => prev.filter(id => id !== userId));

  const availableUsers = allUsers.filter(u => u.isActive && !localMemberIds.includes(u.id));

  const displayName = (u: { firstName?: string | null; lastName?: string | null; username: string }) => {
    const full = [u.firstName, u.lastName].filter(Boolean).join(' ');
    return full || u.username;
  };

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {team ? `${team.name}${team.isMain ? ' (main)' : ''}` : 'Gestione team'}
          </SheetTitle>
        </SheetHeader>

        {teamLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Caricamento…</div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto py-4">

            {/* Informazioni */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Informazioni</h3>
              <div className="space-y-1.5">
                <Label htmlFor="ts-name">Nome *</Label>
                <Input id="ts-name" value={name} onChange={e => setName(e.target.value)} disabled={!canUpdate} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ts-desc">Descrizione</Label>
                <Textarea id="ts-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2} disabled={!canUpdate} />
              </div>
            </div>

            <Separator />

            {/* Brand scopes */}
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Accesso ai brand</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Nessuna selezione = accesso a tutti i brand</p>
              </div>
              {brands.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nessun brand disponibile</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {brands.map(brand => (
                    <label key={brand.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedBrandIds.has(brand.id)}
                        onCheckedChange={() => toggleBrand(brand.id)}
                        disabled={!canUpdate}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{brand.code}</span>
                      <span className="truncate">{brand.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Membri */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Membri ({localMemberIds.length})</h3>

              {localMemberIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nessun membro</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {localMemberIds.map(userId => {
                    const u = userMap.get(userId);
                    return (
                      <div key={userId} className="flex items-center gap-2 px-3 py-2">
                        <span className="flex-1 text-sm">{u ? displayName(u) : userId}</span>
                        <span className="text-xs text-muted-foreground">{u?.email}</span>
                        {canUpdate && (
                          <button
                            type="button"
                            className="text-muted-foreground transition-colors hover:text-destructive"
                            onClick={() => handleRemoveMember(userId)}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {canUpdate && availableUsers.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Aggiungi membro</Label>
                  <Select value={addMemberValue} onValueChange={handleAddMember}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Seleziona utente…" />
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
            </div>
          </div>
        )}

        {canUpdate && (
          <SheetFooter className="border-t pt-4">
            <Button variant="outline" onClick={onClose} disabled={isPending}>Annulla</Button>
            <Button onClick={() => void handleSave()} disabled={isPending || !name.trim() || teamLoading}>
              {isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FunzioniTab() {
  const { can } = usePermission();
  const refresh = useRefresh();
  const canCreateFn = can('company_function:create');
  const canUpdateFn = can('company_function:update');
  const canDeleteFn = can('company_function:delete');

  const { data: functions = [] } = trpc.company.function.list.useQuery({ includeInactive: false });

  const [fnDialog, setFnDialog] = useState<{ open: boolean; fn?: typeof functions[number] }>({ open: false });

  const deactivateMutation = trpc.company.function.delete.useMutation({
    onSuccess: async () => { toast.success('Funzione disattivata'); await refresh.company(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

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

      {functions.map(fn => (
        <SectionCard key={fn.id} title="">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <span className="font-semibold">{fn.name}</span>
              <span className="ml-2 text-xs text-muted-foreground font-mono">{fn.slug}</span>
              {fn.description && (
                <span className="ml-2 text-sm text-muted-foreground">— {fn.description}</span>
              )}
            </div>
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
        </SectionCard>
      ))}

      <FunctionDialog
        open={fnDialog.open}
        fn={fnDialog.fn}
        onClose={() => setFnDialog({ open: false })}
        onSaved={async () => { setFnDialog({ open: false }); await refresh.company(); }}
      />
    </div>
  );
}

function TeamTab() {
  const { can } = usePermission();
  const refresh = useRefresh();
  const canCreateTeam = can('company_team:create');
  const canUpdateTeam = can('company_team:update');
  const canDeleteTeam = can('company_team:delete');

  const { data: functions = [] } = trpc.company.function.list.useQuery({ includeInactive: false });

  const [selectedFunctionId, setSelectedFunctionId] = useState<string>('');
  const [teamCreateDialog, setTeamCreateDialog] = useState<{ open: boolean; functionId: string }>({ open: false, functionId: '' });
  const [teamSheetId, setTeamSheetId] = useState<string | null>(null);

  const effectiveFunctionId = selectedFunctionId || functions[0]?.id || '';

  const deleteTeamMutation = trpc.company.team.delete.useMutation({
    onSuccess: async () => { toast.success('Team eliminato'); await refresh.company(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={effectiveFunctionId} onValueChange={setSelectedFunctionId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Seleziona funzione..." />
          </SelectTrigger>
          <SelectContent>
            {functions.map(fn => (
              <SelectItem key={fn.id} value={fn.id}>{fn.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canCreateTeam && effectiveFunctionId && (
          <Button size="sm" onClick={() => setTeamCreateDialog({ open: true, functionId: effectiveFunctionId })}>
            <Plus size={14} className="mr-1" />
            Nuovo team
          </Button>
        )}
      </div>

      {effectiveFunctionId ? (
        <FunctionTeams
          functionId={effectiveFunctionId}
          canCreateTeam={canCreateTeam}
          canUpdateTeam={canUpdateTeam}
          canDeleteTeam={canDeleteTeam}
          onAddTeam={() => setTeamCreateDialog({ open: true, functionId: effectiveFunctionId })}
          onEditTeam={teamId => setTeamSheetId(teamId)}
          onDeleteTeam={teamId => deleteTeamMutation.mutate({ id: teamId })}
        />
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          Seleziona una funzione per visualizzare i team.
        </p>
      )}

      <TeamDialog
        open={teamCreateDialog.open}
        functionId={teamCreateDialog.functionId}
        onClose={() => setTeamCreateDialog({ open: false, functionId: '' })}
        onSaved={async () => { setTeamCreateDialog({ open: false, functionId: '' }); await refresh.company(); }}
      />

      <TeamSheet
        open={!!teamSheetId}
        teamId={teamSheetId}
        canUpdate={canUpdateTeam}
        onClose={() => setTeamSheetId(null)}
        onSaved={() => setTeamSheetId(null)}
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
  onEditTeam: (teamId: string) => void;
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
          <span className="text-sm font-medium">{team.name}</span>
          {team.isMain && <Badge variant="secondary" className="text-xs">main</Badge>}
          <span className="text-xs text-muted-foreground">{(team as any)._count?.memberships ?? 0} membri</span>
          <div className="flex flex-1 flex-wrap gap-1">
            {(team as any).brandScopes?.length === 0 ? (
              <span className="text-xs text-muted-foreground">tutti i brand</span>
            ) : (
              (team as any).brandScopes?.slice(0, 3).map((s: { brandId: string; brand: { code: string } }) => (
                <Badge key={s.brandId} variant="outline" className="font-mono text-xs">{s.brand.code}</Badge>
              ))
            )}
            {(team as any).brandScopes?.length > 3 && (
              <span className="text-xs text-muted-foreground">+{(team as any).brandScopes.length - 3}</span>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={() => onEditTeam(team.id)}>
            {canUpdateTeam ? 'Gestisci' : 'Visualizza'}
          </Button>
          {canDeleteTeam && !team.isMain && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive hover:text-destructive shrink-0"
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
          <TabsTrigger value="functions">Funzioni</TabsTrigger>
          <TabsTrigger value="teams">Team</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="functions" className="mt-6">
          <FunzioniTab />
        </TabsContent>
        <TabsContent value="teams" className="mt-6">
          <TeamTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
