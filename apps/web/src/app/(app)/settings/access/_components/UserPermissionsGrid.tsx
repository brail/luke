'use client';

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Switch } from '../../../../../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { trpc } from '../../../../../lib/trpc';

type ResourceKey =
  | 'brands'
  | 'users'
  | 'config'
  | 'settings'
  | 'maintenance'
  | 'dashboard';

type Level = 'none' | 'read' | 'write';

interface UserSection {
  resource: ResourceKey;
  label: string;
  roleRead: boolean;
  roleWrite: boolean;
  grantRead: boolean;
  grantWrite: boolean;
  effectiveRead: boolean;
  effectiveWrite: boolean;
  hasWrite: boolean;
}

interface UserPermissionsGridProps {
  userId: string;
  userRole: string;
}

/**
 * Calcola il livello di accesso esplicito (da grants, non dal ruolo)
 */
function getGrantLevel(section: UserSection): Level {
  if (section.grantWrite) return 'write';
  if (section.grantRead) return 'read';
  return 'none';
}

/**
 * Griglia permessi per risorsa — mostra Consultazione / Modifica per sezione
 *
 * - Checkbox grigio/disabilitato = permesso dal ruolo (non modificabile)
 * - Checkbox attivo = grant esplicito (modificabile)
 */
export function UserPermissionsGrid({
  userId,
  userRole,
}: UserPermissionsGridProps) {
  const [pendingChanges, setPendingChanges] = useState<
    Record<ResourceKey, Level>
  >({} as Record<ResourceKey, Level>);
  const [isSaving, setIsSaving] = useState(false);

  const { data, isLoading, refetch } = trpc.rbac.userPermissions.get.useQuery(
    { userId },
    { enabled: !!userId }
  );

  const setPermission = trpc.rbac.userPermissions.set.useMutation();

  // Reset pending changes when user changes
  useEffect(() => {
    setPendingChanges({} as Record<ResourceKey, Level>);
  }, [userId]);

  const handleChange = (
    resource: ResourceKey,
    type: 'read' | 'write',
    checked: boolean
  ) => {
    const section = data?.sections.find(s => s.resource === resource);
    if (!section) return;

    // Don't allow changing role-based permissions
    if (type === 'read' && section.roleRead) return;
    if (type === 'write' && section.roleWrite) return;

    const currentGrant = pendingChanges[resource] ?? getGrantLevel(section);

    let newLevel: Level;
    if (type === 'write') {
      newLevel = checked
        ? 'write'
        : section.roleRead || currentGrant === 'read'
          ? 'read'
          : 'none';
    } else {
      // type === 'read'
      if (checked) {
        newLevel = currentGrant === 'write' ? 'write' : 'read';
      } else {
        newLevel = 'none';
      }
    }

    setPendingChanges(prev => ({ ...prev, [resource]: newLevel }));
  };

  const handleSave = async () => {
    if (Object.keys(pendingChanges).length === 0) {
      toast.info('Nessuna modifica da salvare');
      return;
    }

    setIsSaving(true);
    try {
      const promises = Object.entries(pendingChanges).map(([resource, level]) =>
        setPermission.mutateAsync({
          userId,
          resource: resource as ResourceKey,
          level: level as Level,
        })
      );

      await Promise.all(promises);
      await refetch();
      setPendingChanges({} as Record<ResourceKey, Level>);
      toast.success('Permessi aggiornati con successo');
    } catch (error: any) {
      toast.error(error?.message || 'Errore durante il salvataggio');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPendingChanges({} as Record<ResourceKey, Level>);
  };

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Caricamento permessi...</p>
    );
  }

  if (!data) return null;

  const hasChanges = Object.keys(pendingChanges).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Ruolo base:</span>
        <Badge variant="outline" className="capitalize">
          {userRole}
        </Badge>
        <span className="ml-4">
          I permessi grigi derivano dal ruolo e non possono essere rimossi. I
          permessi colorati sono grant espliciti.
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Sezione</TableHead>
            <TableHead className="w-36 text-center">Consultazione</TableHead>
            <TableHead className="w-36 text-center">Modifica</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.sections.map(section => {
            const currentLevel =
              pendingChanges[section.resource] ?? getGrantLevel(section);
            const effectiveRead =
              section.roleRead ||
              currentLevel === 'read' ||
              currentLevel === 'write';
            const effectiveWrite =
              section.roleWrite || currentLevel === 'write';
            const hasPendingChange = section.resource in pendingChanges;

            const readChecked = effectiveRead;
            const writeChecked = effectiveWrite;

            return (
              <TableRow
                key={section.resource}
                className={hasPendingChange ? 'bg-yellow-50' : ''}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {section.label}
                    {hasPendingChange && (
                      <Badge
                        variant="outline"
                        className="text-xs border-yellow-400 text-yellow-700"
                      >
                        modificato
                      </Badge>
                    )}
                  </div>
                </TableCell>

                {/* Consultazione (read) */}
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Switch
                      checked={readChecked}
                      disabled={section.roleRead}
                      onCheckedChange={checked =>
                        handleChange(section.resource, 'read', checked)
                      }
                      className={section.roleRead ? 'opacity-50' : ''}
                    />
                    {section.roleRead && (
                      <span className="text-xs text-muted-foreground">
                        da ruolo
                      </span>
                    )}
                  </div>
                </TableCell>

                {/* Modifica (write) */}
                <TableCell className="text-center">
                  {section.hasWrite ? (
                    <div className="flex flex-col items-center gap-1">
                      <Switch
                        checked={writeChecked}
                        disabled={section.roleWrite}
                        onCheckedChange={checked =>
                          handleChange(section.resource, 'write', checked)
                        }
                        className={section.roleWrite ? 'opacity-50' : ''}
                      />
                      {section.roleWrite && (
                        <span className="text-xs text-muted-foreground">
                          da ruolo
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* Note */}
                <TableCell className="text-sm text-muted-foreground">
                  {!effectiveRead && !effectiveWrite && 'Nessun accesso'}
                  {effectiveRead && !effectiveWrite && 'Solo lettura'}
                  {effectiveWrite && 'Lettura e modifica'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {hasChanges && (
        <div className="flex items-center justify-between rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-sm text-yellow-800">
            Hai {Object.keys(pendingChanges).length} modifica/he non salvata/e
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={isSaving}
            >
              Annulla
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Salvataggio...' : 'Salva permessi'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
