'use client';

import React, { useState, useEffect } from 'react';

import { SectionCard } from '../../../../../components/SectionCard';
import { Button } from '../../../../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { trpc } from '../../../../../lib/trpc';
import { useStandardMutation } from '../../../../../lib/useStandardMutation';

type Section = 'dashboard' | 'settings' | 'maintenance';
type Role = 'admin' | 'editor' | 'viewer';
type SectionDefault = 'auto' | 'enabled' | 'disabled';

const sections = [
  { key: 'dashboard' as Section, label: 'Dashboard' },
  { key: 'settings' as Section, label: 'Settings' },
  { key: 'maintenance' as Section, label: 'Maintenance' },
];

const roles = [
  { key: 'admin' as Role, label: 'Admin' },
  { key: 'editor' as Role, label: 'Editor' },
  { key: 'viewer' as Role, label: 'Viewer' },
];

/**
 * Componente matrice per gestire default di accesso alle sezioni per ruolo
 * Struttura pivotata: sezioni come righe, ruoli come colonne
 */
export function RoleSectionDefaultsMatrix() {
  const [defaults, setDefaults] = useState<
    Record<Role, Record<Section, SectionDefault>>
  >({
    admin: { dashboard: 'auto', settings: 'auto', maintenance: 'auto' },
    editor: { dashboard: 'auto', settings: 'auto', maintenance: 'auto' },
    viewer: { dashboard: 'auto', settings: 'auto', maintenance: 'auto' },
  });

  // Query per recuperare i default attuali
  const { data: currentDefaults } = trpc.rbac.sectionDefaults.get.useQuery();

  // Mutation per salvare i default
  const saveMutation = trpc.rbac.sectionDefaults.save.useMutation();

  const utils = trpc.useUtils();

  const { mutate: saveDefaults, isPending: isSaving } = useStandardMutation({
    mutateFn: saveMutation.mutateAsync,
    onSuccessMessage: 'Default salvati con successo',
    onErrorMessage: 'Errore durante il salvataggio',
    onSuccess: () => {
      // Invalida query per aggiornare i dati
      utils.rbac.sectionDefaults.get.invalidate();
    },
  });

  // Carica i default quando arrivano i dati
  useEffect(() => {
    if (currentDefaults) {
      const newDefaults: Record<Role, Record<Section, SectionDefault>> = {
        admin: { dashboard: 'auto', settings: 'auto', maintenance: 'auto' },
        editor: { dashboard: 'auto', settings: 'auto', maintenance: 'auto' },
        viewer: { dashboard: 'auto', settings: 'auto', maintenance: 'auto' },
      };

      // Popola con i dati dal server
      Object.entries(currentDefaults).forEach(([role, sectionDefaults]) => {
        if (role in newDefaults) {
          Object.entries(sectionDefaults).forEach(([section, value]) => {
            if (section in newDefaults[role as Role]) {
              newDefaults[role as Role][section as Section] =
                value as SectionDefault;
            }
          });
        }
      });

      setDefaults(newDefaults);
    }
  }, [currentDefaults]);

  const handleDefaultChange = (
    role: Role,
    section: Section,
    value: SectionDefault
  ) => {
    setDefaults(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        [section]: value,
      },
    }));
  };

  const handleBulkAction = (
    action: 'setAllAuto' | 'setAllEnabled' | 'setAllDisabled'
  ) => {
    const newValue: SectionDefault =
      action === 'setAllAuto'
        ? 'auto'
        : action === 'setAllEnabled'
          ? 'enabled'
          : 'disabled';

    const newDefaults: Record<Role, Record<Section, SectionDefault>> = {
      admin: { dashboard: newValue, settings: newValue, maintenance: newValue },
      editor: {
        dashboard: newValue,
        settings: newValue,
        maintenance: newValue,
      },
      viewer: {
        dashboard: newValue,
        settings: newValue,
        maintenance: newValue,
      },
    };

    setDefaults(newDefaults);
  };

  const handleRoleBulkAction = (
    role: Role,
    action: 'setAuto' | 'setEnabled' | 'setDisabled'
  ) => {
    const newValue: SectionDefault =
      action === 'setAuto'
        ? 'auto'
        : action === 'setEnabled'
          ? 'enabled'
          : 'disabled';

    setDefaults(prev => ({
      ...prev,
      [role]: {
        dashboard: newValue,
        settings: newValue,
        maintenance: newValue,
      },
    }));
  };

  const handleSave = () => {
    // Converte i dati nel formato atteso dal server
    const payload = {
      sectionAccessDefaults: defaults,
    };

    saveDefaults(payload);
  };

  return (
    <SectionCard
      title="Default per Ruolo"
      description="Configura i default di accesso alle sezioni per ogni ruolo. Gli utenti possono sempre essere sovrascritti individualmente."
    >
      <div className="space-y-4">
        {/* Azioni bulk globali */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction('setAllAuto')}
          >
            Tutto Auto
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction('setAllEnabled')}
          >
            Tutto Abilitato
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction('setAllDisabled')}
          >
            Tutto Disabilitato
          </Button>
        </div>

        {/* Tabella matrice (sezioni x ruoli) */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sezione</TableHead>
              {roles.map(role => (
                <TableHead key={role.key} className="text-center">
                  <div className="space-y-1">
                    <div>{role.label}</div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() =>
                          handleRoleBulkAction(role.key, 'setAuto')
                        }
                      >
                        Auto
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() =>
                          handleRoleBulkAction(role.key, 'setEnabled')
                        }
                      >
                        On
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() =>
                          handleRoleBulkAction(role.key, 'setDisabled')
                        }
                      >
                        Off
                      </Button>
                    </div>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.map(section => (
              <TableRow key={section.key}>
                <TableCell className="font-medium">{section.label}</TableCell>
                {roles.map(role => (
                  <TableCell key={role.key} className="text-center">
                    <Select
                      value={defaults[role.key][section.key]}
                      onValueChange={(value: SectionDefault) =>
                        handleDefaultChange(role.key, section.key, value)
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="enabled">Abilitata</SelectItem>
                        <SelectItem value="disabled">Disabilitata</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Pulsante salva */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Salvataggio...' : 'Salva Default'}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
