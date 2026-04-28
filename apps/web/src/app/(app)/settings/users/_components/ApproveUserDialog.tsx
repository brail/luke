'use client';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
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

import {
  ALL_SECTIONS,
  SECTION_LABELS,
  type SeasonAccessMap,
  type SectionOverrideMap,
  type UserForApproval,
} from './types';

// Keys in SectionOverrideMap are always valid Section values
const toSection = (s: string) => s as Section;

interface ApproveUserDialogProps {
  user: UserForApproval;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: () => void;
}

/**
 * Obbliga l'admin a configurare accesso (sezioni/brand/stagioni) prima di approvare.
 * Usato sia per LDAP pending che per utente locale appena creato (pendingApproval: true).
 */
export function ApproveUserDialog({
  user,
  open,
  onOpenChange,
  onApproved,
}: ApproveUserDialogProps) {
  const { data: allBrands } = trpc.brand.list.useQuery(
    { limit: 100 },
    { enabled: open }
  );
  const { data: allSeasons } = trpc.season.list.useQuery(
    { limit: 100 },
    { enabled: open }
  );

  const [pendingSection, setPendingSection] = useState<SectionOverrideMap>({});
  const [pendingBrandIds, setPendingBrandIds] = useState<string[] | null>(null);
  const [pendingSeasonAccess, setPendingSeasonAccess] =
    useState<SeasonAccessMap>({});

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
        delete next[section];
      } else {
        next[section] = checked;
      }
      return next;
    });
  };

  const handleSectionReset = (section: Section) => {
    setPendingSection(prev => {
      const next = { ...prev };
      delete next[section];
      return next;
    });
  };

  const allBrandsAllowed = pendingBrandIds === null;

  const handleAllBrandsToggle = (checked: boolean) => {
    setPendingBrandIds(checked ? null : []);
  };

  const handleBrandToggle = (brandId: string, checked: boolean) => {
    setPendingBrandIds(prev => {
      const current = prev ?? [];
      return checked
        ? [...current, brandId]
        : current.filter(id => id !== brandId);
    });
  };

  const getSeasonAccess = (brandId: string): string[] | null =>
    brandId in pendingSeasonAccess ? pendingSeasonAccess[brandId] : null;

  const handleAllSeasonsToggle = (brandId: string, checked: boolean) => {
    setPendingSeasonAccess(prev => {
      const next = { ...prev };
      if (checked) {
        delete next[brandId];
      } else {
        next[brandId] = allSeasons?.items.map(s => s.id) ?? [];
      }
      return next;
    });
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
  };

  const setSectionMutation = trpc.sectionAccess.set.useMutation();
  const setBrandAccessMutation =
    trpc.context.access.setBrandAccess.useMutation();
  const setSeasonAccessMutation =
    trpc.context.access.setSeasonAccess.useMutation();
  const approveMutation = trpc.users.approvePending.useMutation();

  const [isSaving, setIsSaving] = useState(false);

  const handleSaveAndApprove = async () => {
    setIsSaving(true);
    try {
      // New user: no existing overrides — only send explicit changes, skip no-ops
      await Promise.all(
        Object.keys(pendingSection).map(section =>
          setSectionMutation.mutateAsync({
            userId: user.id,
            section: toSection(section),
            enabled: pendingSection[section]!,
          })
        )
      );

      await setBrandAccessMutation.mutateAsync({
        userId: user.id,
        brandIds: pendingBrandIds ?? [],
      });

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

      await approveMutation.mutateAsync({ id: user.id });

      toast.success('Utente approvato con accesso configurato');
      onApproved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : undefined;
      toast.error(msg ?? "Errore durante l'approvazione");
    } finally {
      setIsSaving(false);
    }
  };

  const activeBrandIds = allBrandsAllowed
    ? (allBrands?.items.map(b => b.id) ?? [])
    : (pendingBrandIds ?? []);

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o && !isSaving) onOpenChange(false);
      }}
    >
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Configura accesso e approva — {user.username}
          </DialogTitle>
          <DialogDescription>
            Configura le sezioni e i brand/stagioni accessibili prima di
            approvare l&apos;account. I valori mostrati riflettono i default del
            ruolo <strong>{user.role}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
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
                                checked={
                                  seasonAccess?.includes(season.id) ?? false
                                }
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

        <DialogFooter className="mt-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Annulla
          </Button>
          <Button onClick={handleSaveAndApprove} disabled={isSaving}>
            {isSaving ? 'Approvazione...' : 'Salva e approva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
