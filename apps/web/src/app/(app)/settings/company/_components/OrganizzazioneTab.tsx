'use client';

import { Building2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Switch } from '../../../../../components/ui/switch';
import { usePermission } from '../../../../../hooks/usePermission';
import { useRefresh } from '../../../../../lib/refresh';
import { trpc } from '../../../../../lib/trpc';

import { FunctionSidebar } from './FunctionSidebar';
import { TeamList } from './TeamList';

/**
 * "Organizzazione" settings tab showing the two-level company structure:
 * a sidebar of company functions on the left and the team list for the selected function on the right.
 * Respects `company_function:*` and `company_team:*` permissions for all CRUD actions.
 */
export function OrganizzazioneTab() {
  const { can } = usePermission();
  const refresh = useRefresh();

  const canCreateFn = can('company_function:create');
  const canUpdateFn = can('company_function:update');
  const canDeleteFn = can('company_function:delete');
  const canCreateTeam = can('company_team:create');
  const canUpdateTeam = can('company_team:update');
  const canDeleteTeam = can('company_team:delete');

  const [showInactive, setShowInactive] = useState(false);
  const { data: functions = [] } = trpc.company.function.list.useQuery({ includeInactive: showInactive });

  const [selectedFunctionId, setSelectedFunctionId] = useState<string | null>(null);

  useEffect(() => {
    if (functions.length > 0 && !selectedFunctionId) {
      setSelectedFunctionId(functions[0].id);
    }
  }, [functions]);

  const selectedFunction = functions.find(f => f.id === selectedFunctionId);

  return (
    <div className="flex gap-6">
      <div className="w-64 shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funzioni</p>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} className="scale-75" />
            Disattivate
          </label>
        </div>
        <FunctionSidebar
          functions={functions}
          selectedId={selectedFunctionId}
          canCreate={canCreateFn}
          canUpdate={canUpdateFn}
          canDelete={canDeleteFn}
          onSelect={setSelectedFunctionId}
          onRefresh={refresh.company}
        />
      </div>

      <div className="w-px shrink-0 bg-border" />

      <div className="flex-1 min-w-0">
        {!selectedFunction ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <Building2 size={36} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {functions.length === 0
                ? 'Nessuna funzione configurata. Creane una dalla colonna sinistra.'
                : 'Seleziona una funzione per gestire i team.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold">{selectedFunction.name}</h3>
              {selectedFunction.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{selectedFunction.description}</p>
              )}
            </div>

            <TeamList
              functionId={selectedFunction.id}
              canCreate={canCreateTeam}
              canUpdate={canUpdateTeam}
              canDelete={canDeleteTeam}
            />
          </div>
        )}
      </div>
    </div>
  );
}
