'use client';

import React, { useState } from 'react';

import { SectionCard } from '../../../../../components/SectionCard';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { trpc } from '../../../../../lib/trpc';

type Section = 'dashboard' | 'settings' | 'maintenance';

/**
 * Componente per anteprima accessi effettivi di un utente
 * Replica la logica effectiveSectionAccess client-side per UX
 */
export function EffectivePreview() {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  // Query per lista utenti
  const { data: usersData, isLoading: isLoadingUsers } =
    trpc.users.list.useQuery({
      page: 1,
      limit: 100,
      search: searchTerm || undefined,
    });

  // Query per override utente selezionato
  const { data: userOverrides } = trpc.sectionAccess.getByUser.useQuery(
    { userId: selectedUserId },
    { enabled: !!selectedUserId }
  );

  // Query per default di ruolo
  const { data: roleDefaults } = trpc.rbac.sectionDefaults.get.useQuery();

  const sections: { key: Section; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'settings', label: 'Settings' },
    { key: 'maintenance', label: 'Maintenance' },
  ];

  // Replica logica effectiveSectionAccess client-side
  const calculateEffectiveAccess = (section: Section) => {
    if (!selectedUserId || !usersData?.users) return null;

    const user = usersData.users.find(u => u.id === selectedUserId);
    if (!user) return null;

    // 1) Override utente
    const override = userOverrides?.find(o => o.section === section);
    if (override?.enabled === false)
      return { access: false, reason: 'Override: Disabilitato' };
    if (override?.enabled === true)
      return { access: true, reason: 'Override: Abilitato' };

    // 2) Default di ruolo
    const roleDefault = roleDefaults?.[user.role]?.[section];
    if (roleDefault === 'disabled')
      return { access: false, reason: 'Default ruolo: Disabilitato' };
    if (roleDefault === 'enabled')
      return { access: true, reason: 'Default ruolo: Abilitato' };

    // 3) RBAC di ruolo (simulazione)
    const rolePermissions: Record<string, string[]> = {
      admin: ['*'],
      editor: ['read', 'update'],
      viewer: ['read'],
    };

    const hasPermission =
      rolePermissions[user.role]?.includes('*') ||
      rolePermissions[user.role]?.includes(`${section}:read`);

    if (hasPermission) {
      return { access: true, reason: 'RBAC ruolo: Consentito' };
    }

    return { access: false, reason: 'RBAC ruolo: Negato' };
  };

  return (
    <SectionCard
      title="Anteprima Effettiva"
      description="Visualizza l'accesso effettivo di un utente alle sezioni"
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="user-search-preview">Cerca utente</Label>
          <Input
            id="user-search-preview"
            placeholder="Nome, email o username..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        {isLoadingUsers ? (
          <p>Caricamento utenti...</p>
        ) : (
          <div className="space-y-2">
            <Label>Seleziona utente</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona un utente per l'anteprima" />
              </SelectTrigger>
              <SelectContent>
                {usersData?.users.map(user => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.firstName} {user.lastName} ({user.email}) -{' '}
                    {user.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedUserId && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Accessi Effettivi</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sezione</TableHead>
                  <TableHead>Accesso</TableHead>
                  <TableHead>Motivazione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.map(section => {
                  const result = calculateEffectiveAccess(section.key);
                  return (
                    <TableRow key={section.key}>
                      <TableCell className="font-medium">
                        {section.label}
                      </TableCell>
                      <TableCell>
                        {result ? (
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              result.access
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {result.access ? 'Consentito' : 'Negato'}
                          </span>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {result?.reason || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
