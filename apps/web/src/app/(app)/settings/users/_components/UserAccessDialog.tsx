'use client';

import { Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SECTION_ACCESS_DEFAULTS } from '@luke/core';
import type { Section } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Label } from '../../../../../components/ui/label';
import { Switch } from '../../../../../components/ui/switch';
import { trpc } from '../../../../../lib/trpc';

import type { UserListItem } from './types';

interface UserAccessDialogProps {
  user: UserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Dashboard',
  settings: 'Impostazioni',
  'settings.users': '↳ Utenti',
  'settings.storage': '↳ Storage',
  'settings.mail': '↳ Mail',
  'settings.ldap': '↳ Auth LDAP',
  'settings.nav': '↳ Microsoft NAV',
  maintenance: 'Manutenzione',
  'maintenance.config': '↳ Configurazioni',
  'maintenance.import_export': '↳ Import/Export',
  product: 'Prodotto',
  'product.pricing': '↳ Pricing',
  'product.collection_layout': '↳ Collection Layout',
  admin: 'Amministrazione',
  'admin.brands': '↳ Brand',
  'admin.seasons': '↳ Stagioni',
  'admin.nav_sync': '↳ Sync NAV',
};

const ALL_SECTIONS: Section[] = [
  'dashboard',
  'settings',
  'settings.users',
  'settings.storage',
  'settings.mail',
  'settings.ldap',
  'settings.nav',
  'maintenance',
  'maintenance.config',
  'maintenance.import_export',
  'product',
  'product.pricing',
  'product.collection_layout',
  'admin',
  'admin.brands',
  'admin.seasons',
  'admin.nav_sync',
];

// null = use role default, true/false = explicit override
type SectionOverrideMap = Partial<Record<Section, boolean>>;
// null = all seasons allowed for that brand, string[] = whitelist
type SeasonAccessMap = Record<string, string[] | null>;

/**
 * Dialog per gestione accesso sezioni + brand/season per un utente.
 * Le modifiche sono locali fino al click su "Salva".
 */
export function UserAccessDialog({
  user,
  open,
  onOpenChange,
}: UserAccessDialogProps) {
  const utils = trpc.useUtils();
  const initialized = useRef(false);

  // --- Server data ---
  const { data: serverSectionOverrides, isLoading: loadingSection } =
    trpc.sectionAccess.getByUser.useQuery({ userId: user.id }, { enabled: open });

  const { data: serverAccess, isLoading: loadingAccess } =
    trpc.context.access.getByUser.useQuery({ userId: user.id }, { enabled: open });

  // Admin sees ALL brands/seasons (not filtered by whitelist)
  const { data: allBrands } = trpc.brand.list.useQuery(
    { limit: 100 },
    { enabled: open }
  );
  const { data: allSeasons } = trpc.season.list.useQuery(
    { limit: 100 },
    { enabled: open }
  );

  // --- Local pending state ---
  const [pendingSection, setPendingSection] = useState<SectionOverrideMap>({});
  const [pendingBrandIds, setPendingBrandIds] = useState<string[] | null>(null);
  const [pendingSeasonAccess, setPendingSeasonAccess] = useState<SeasonAccessMap>({});
  const [isDirty, setIsDirty] = useState(false);

  // Initialize local state from server when data loads (only once per open)
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    if (loadingSection || loadingAccess) return;

    initialized.current = true;

    // Section overrides
    const sectionMap: SectionOverrideMap = {};
    serverSectionOverrides?.forEach(o => {
      if (o.enabled !== null) sectionMap[o.section as Section] = o.enabled;
    });
    setPendingSection(sectionMap);
    setIsDirty(false);

    // Brand access
    setPendingBrandIds(serverAccess?.brandIds ?? null);

    // Season access
    const seasonMap: SeasonAccessMap = {};
    const byBrand: Record<string, string[]> = {};
    serverAccess?.brandSeasonRows.forEach(r => {
      if (!byBrand[r.brandId]) byBrand[r.brandId] = [];
      byBrand[r.brandId].push(r.seasonId);
    });
    Object.entries(byBrand).forEach(([brandId, ids]) => {
      seasonMap[brandId] = ids;
    });
    setPendingSeasonAccess(seasonMap);
  }, [open, loadingSection, loadingAccess, serverSectionOverrides, serverAccess]);

  // --- Section handlers ---
  const getRoleDefault = (section: Section): boolean =>
    SECTION_ACCESS_DEFAULTS[user.role]?.[section] ?? false;

  const getSectionValue = (section: Section): boolean => {
    if (section in pendingSection) return pendingSection[section]!;
    return getRoleDefault(section);
  };

  const handleSectionToggle = (section: Section, checked: boolean) => {
    setPendingSection(prev => {
      const next = { ...prev };
      if (checked === getRoleDefault(section)) {
        delete next[section]; // remove override — matches role default
      } else {
        next[section] = checked;
      }
      return next;
    });
    setIsDirty(true);
  };

  const handleSectionReset = (section: Section) => {
    setPendingSection(prev => {
      const next = { ...prev };
      delete next[section];
      return next;
    });
    setIsDirty(true);
  };

  // --- Brand handlers ---
  const allBrandsAllowed = pendingBrandIds === null;

  const handleAllBrandsToggle = (checked: boolean) => {
    setPendingBrandIds(checked ? null : []);
    setIsDirty(true);
  };

  const handleBrandToggle = (brandId: string, checked: boolean) => {
    setPendingBrandIds(prev => {
      const current = prev ?? [];
      return checked
        ? [...current, brandId]
        : current.filter(id => id !== brandId);
    });
    setIsDirty(true);
  };

  // --- Season handlers ---
  const getSeasonAccess = (brandId: string): string[] | null => {
    return brandId in pendingSeasonAccess ? pendingSeasonAccess[brandId] : null;
  };

  const handleAllSeasonsToggle = (brandId: string, checked: boolean) => {
    setPendingSeasonAccess(prev => {
      const next = { ...prev };
      if (checked) {
        // "tutte le stagioni" → rimuovi restrizione
        delete next[brandId];
      } else {
        // inizio selezione manuale → inizializza con TUTTE selezionate
        next[brandId] = allSeasons?.items.map(s => s.id) ?? [];
      }
      return next;
    });
    setIsDirty(true);
  };

  const handleSeasonToggle = (
    brandId: string,
    seasonId: string,
    checked: boolean
  ) => {
    setPendingSeasonAccess(prev => {
      const current = prev[brandId] ?? [];
      return {
        ...prev,
        [brandId]: checked
          ? [...current, seasonId]
          : current.filter(id => id !== seasonId),
      };
    });
    setIsDirty(true);
  };

  // --- Save ---
  const setSectionMutation = trpc.sectionAccess.set.useMutation();
  const setBrandAccessMutation = trpc.context.access.setBrandAccess.useMutation();
  const setSeasonAccessMutation = trpc.context.access.setSeasonAccess.useMutation();

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 1. Section overrides: apply for all sections
      // Sections with pending override → set it; missing → remove override (null)
      await Promise.all(
        ALL_SECTIONS.map(section =>
          setSectionMutation.mutateAsync({
            userId: user.id,
            section,
            enabled: section in pendingSection ? pendingSection[section]! : null,
          })
        )
      );

      // 2. Brand access
      await setBrandAccessMutation.mutateAsync({
        userId: user.id,
        brandIds: pendingBrandIds ?? [],
      });

      // 3. Season access for each active brand
      const activeBrands = allBrandsAllowed
        ? (allBrands?.items.map(b => b.id) ?? [])
        : (pendingBrandIds ?? []);

      await Promise.all(
        activeBrands.map(brandId =>
          setSeasonAccessMutation.mutateAsync({
            userId: user.id,
            brandId,
            seasonIds: pendingSeasonAccess[brandId] ?? [],
          })
        )
      );

      await Promise.all([
        utils.sectionAccess.getByUser.invalidate({ userId: user.id }),
        utils.context.access.getByUser.invalidate({ userId: user.id }),
      ]);

      toast.success('Accesso aggiornato');
      setIsDirty(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Errore nel salvataggio');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsDirty(false);
    onOpenChange(false);
  };

  const isLoading = loadingSection || loadingAccess;
  const activeBrandIds = allBrandsAllowed
    ? (allBrands?.items.map(b => b.id) ?? [])
    : (pendingBrandIds ?? []);

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) handleCancel(); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Gestisci accesso — {user.firstName} {user.lastName}
          </DialogTitle>
          <DialogDescription>
            Configura sezioni visibili e brand/stagioni accessibili. Gli override
            si applicano sopra i default del ruolo <strong>{user.role}</strong>.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            Caricamento...
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Sezioni */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Visibilità sezioni</h3>
              <div className="space-y-2">
                {ALL_SECTIONS.map(section => {
                  const isOverridden = section in pendingSection;
                  const effectiveValue = getSectionValue(section);
                  const roleDefault = getRoleDefault(section);

                  return (
                    <div
                      key={section}
                      className="flex items-center justify-between py-1"
                    >
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`section-${section}`}
                          className="text-sm font-normal"
                        >
                          {SECTION_LABELS[section]}
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          {isOverridden
                            ? '(override)'
                            : `(default: ${roleDefault ? 'sì' : 'no'})`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`section-${section}`}
                          checked={effectiveValue}
                          onCheckedChange={checked =>
                            handleSectionToggle(section, checked)
                          }
                        />
                        {isOverridden && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1 text-xs text-muted-foreground"
                            onClick={() => handleSectionReset(section)}
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Brand */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Brand accessibili</h3>
              <div className="flex items-center gap-2 mb-3">
                <Checkbox
                  id="all-brands"
                  checked={allBrandsAllowed}
                  onCheckedChange={checked =>
                    handleAllBrandsToggle(checked === true)
                  }
                />
                <Label htmlFor="all-brands" className="text-sm font-normal">
                  Tutti i brand (nessuna restrizione)
                </Label>
              </div>
              {!allBrandsAllowed && (
                <div className="grid grid-cols-2 gap-1 ml-6">
                  {(allBrands?.items ?? []).map(brand => (
                    <div key={brand.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`brand-${brand.id}`}
                        checked={pendingBrandIds?.includes(brand.id) ?? false}
                        onCheckedChange={checked =>
                          handleBrandToggle(brand.id, checked === true)
                        }
                      />
                      <Label
                        htmlFor={`brand-${brand.id}`}
                        className="text-sm font-normal"
                      >
                        {brand.name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stagioni per brand */}
            {activeBrandIds.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3">
                  Stagioni accessibili per brand
                </h3>
                <div className="space-y-4">
                  {activeBrandIds.map(brandId => {
                    const brand = allBrands?.items.find(b => b.id === brandId);
                    if (!brand) return null;
                    const seasonAccess = getSeasonAccess(brandId);
                    const allSeasonsAllowed = seasonAccess === null;

                    return (
                      <div key={brandId}>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          {brand.name}
                        </p>
                        <div className="flex items-center gap-2 mb-1">
                          <Checkbox
                            id={`all-seasons-${brandId}`}
                            checked={allSeasonsAllowed}
                            onCheckedChange={checked =>
                              handleAllSeasonsToggle(brandId, checked === true)
                            }
                          />
                          <Label
                            htmlFor={`all-seasons-${brandId}`}
                            className="text-xs font-normal"
                          >
                            Tutte le stagioni
                          </Label>
                        </div>
                        {!allSeasonsAllowed && (
                          <div className="grid grid-cols-2 gap-1 ml-6">
                            {(allSeasons?.items ?? []).map(season => (
                              <div
                                key={season.id}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  id={`season-${brandId}-${season.id}`}
                                  checked={seasonAccess?.includes(season.id) ?? false}
                                  onCheckedChange={checked =>
                                    handleSeasonToggle(
                                      brandId,
                                      season.id,
                                      checked === true
                                    )
                                  }
                                />
                                <Label
                                  htmlFor={`season-${brandId}-${season.id}`}
                                  className="text-xs font-normal"
                                >
                                  {season.name}
                                </Label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            Annulla
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? 'Salvataggio...' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
