'use client';

import { ImageIcon, Trash2, UploadCloud } from 'lucide-react';
import { type CSSProperties, type ChangeEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { buildCompanyLogoUploadUrl, buildCompanyLogoUrl } from '@luke/core';

import { SectionCard } from '../../../../../components/SectionCard';
import { Button } from '../../../../../components/ui/button';
import { FileDropZone } from '../../../../../components/ui/file-drop-zone';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Progress } from '../../../../../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { usePermission } from '../../../../../hooks/usePermission';
import { useStorageUpload } from '../../../../../hooks/useStorageUpload';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

const COUNTRIES = [
  { code: 'IT', name: 'Italia' },
  { code: 'CN', name: 'Cina' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'IN', name: 'India' },
  { code: 'TR', name: 'Turchia' },
  { code: 'DE', name: 'Germania' },
  { code: 'FR', name: 'Francia' },
  { code: 'ES', name: 'Spagna' },
  { code: 'PT', name: 'Portogallo' },
  { code: 'GB', name: 'Regno Unito' },
  { code: 'US', name: 'Stati Uniti' },
  { code: 'JP', name: 'Giappone' },
  { code: 'KR', name: 'Corea del Sud' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'MA', name: 'Marocco' },
  { code: 'RO', name: 'Romania' },
  { code: 'AL', name: 'Albania' },
  { code: 'MK', name: 'Macedonia del Nord' },
];

/**
 * "Profilo" settings tab for editing company identity, registered address, and export/branding settings.
 * Includes logo upload via {@link useStorageUpload} and is gated by the `company_profile:update` permission.
 */
export function ProfileTab() {
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
  const [addrStreet, setAddrStreet] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrZip, setAddrZip] = useState('');
  const [addrProvince, setAddrProvince] = useState('');
  const [addrCountryCode, setAddrCountryCode] = useState('');
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
    const addr: Record<string, string> = (p as any).address ?? {};
    setAddrStreet(addr['street'] ?? '');
    setAddrCity(addr['city'] ?? '');
    setAddrZip(addr['zip'] ?? '');
    setAddrProvince(addr['province'] ?? '');
    setAddrCountryCode(addr['countryCode'] ?? (p as any).countryCode ?? '');
    const es: Record<string, string> = (p as any).exportSettings ?? {}; // tRPC infers exportSettings as unknown Json
    setFooterText(es['footerText'] ?? '');
    setAccentColorHex(es['accentColorHex'] ?? '#000000');
    setLocale((es['locale'] as 'it-IT' | 'en-US') ?? 'it-IT');
    setDateFormat((es['dateFormat'] as 'DD/MM/YYYY' | 'YYYY-MM-DD') ?? 'DD/MM/YYYY');
    setLogoKey((p.logoKey as string | null | undefined) ?? null);
    setDirty(false);
  };

  useEffect(() => { syncFromProfile(profile); }, [profile?.updatedAt]); // intentional: only re-sync when server data changes

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
        address: {
          street: addrStreet.trim() || undefined,
          city: addrCity.trim() || undefined,
          zip: addrZip.trim() || undefined,
          province: addrProvince.trim() || undefined,
          countryCode: addrCountryCode || undefined,
        },
        logoKey,
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
    <div className="space-y-6">
      <SectionCard title="Identità aziendale">
        <div className="flex gap-6">
          <div className="w-36 flex-shrink-0 space-y-3">
            {logoPreviewUrl ? (
              <div className="space-y-2">
                <img
                  src={logoPreviewUrl}
                  alt="Logo aziendale"
                  className="h-20 w-full rounded-md border object-contain p-1"
                />
                {canUpdate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-destructive hover:text-destructive"
                    onClick={handleLogoRemove}
                    disabled={updateMutation.isPending}
                  >
                    <Trash2 size={13} className="mr-1" />
                    Rimuovi
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex h-20 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                <ImageIcon size={20} />
              </div>
            )}
            {canUpdate && (
              <FileDropZone
                onFile={file => void handleLogoUpload(file)}
                accept={['image/png', 'image/jpeg', 'image/webp']}
                maxSizeMB={2}
                disabled={isUploading}
                className="cursor-pointer rounded-md border border-dashed p-2 text-center hover:bg-muted/40"
              >
                <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                  <UploadCloud size={16} />
                  <span>{isUploading ? `${uploadProgress}%` : 'PNG / JPG / WEBP, max 2MB'}</span>
                </div>
              </FileDropZone>
            )}
            {isUploading && <Progress value={uploadProgress} className="h-1" />}
          </div>

          <div className="flex-1 space-y-4">
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
        </div>
      </SectionCard>

      {/* ── Sede legale ── */}
      <SectionCard title="Sede legale">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="addrStreet">Indirizzo</Label>
            <Input id="addrStreet" value={addrStreet} onChange={field(setAddrStreet)} disabled={!canUpdate} placeholder="Via Roma 1" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="addrZip">CAP</Label>
              <Input id="addrZip" value={addrZip} onChange={field(setAddrZip)} disabled={!canUpdate} placeholder="20100" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addrCity">Città</Label>
              <Input id="addrCity" value={addrCity} onChange={field(setAddrCity)} disabled={!canUpdate} placeholder="Milano" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addrProvince">Provincia</Label>
              <Input id="addrProvince" value={addrProvince} onChange={field(setAddrProvince)} disabled={!canUpdate} placeholder="MI" maxLength={5} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Paese</Label>
            <Select
              value={addrCountryCode}
              onValueChange={v => { setAddrCountryCode(v); setDirty(true); }}
              disabled={!canUpdate}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona paese…" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map(c => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Determina il paese di default per l'importazione festività.</p>
          </div>
        </div>
      </SectionCard>

      {/* ── Export & Branding ── */}
      <SectionCard title="Export & Branding">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="footerText">Testo piè di pagina</Label>
            <Textarea
              id="footerText"
              value={footerText}
              onChange={e => { setFooterText(e.target.value); setDirty(true); }}
              disabled={!canUpdate}
              placeholder="es. FEBOS S.r.l. — P.IVA 12345678901"
              maxLength={200}
              rows={2}
            />
            <p className="text-xs text-muted-foreground">{footerText.length}/200 caratteri</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="accentColor">Colore accento</Label>
              <div className="flex items-center gap-2">
                <div
                  className="h-9 w-9 flex-shrink-0 cursor-pointer rounded-md border [background:var(--swatch-color)]"
                  style={{ '--swatch-color': accentColorHex } as CSSProperties}
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
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </SectionCard>

      {canUpdate && (
        <div className="flex justify-end gap-2 border-t pt-4">
          {dirty && (
            <Button variant="outline" onClick={() => syncFromProfile(profile)} disabled={updateMutation.isPending}>
              Annulla
            </Button>
          )}
          <Button
            onClick={() => void handleSave()}
            disabled={updateMutation.isPending || !dirty || !legalName.trim() || !displayName.trim()}
          >
            {updateMutation.isPending ? 'Salvataggio…' : 'Salva modifiche'}
          </Button>
        </div>
      )}
    </div>
  );
}
