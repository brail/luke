'use client';

import { Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { CreateActionButton } from '../../../../../components/CreateActionButton';
import { PermissionButton } from '../../../../../components/PermissionButton';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { useRefresh } from '../../../../../lib/refresh';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

import { CreateTeamDialog, EditTeamDialog } from './TeamDialog';

type TeamSummary = {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  _count: { memberships: number };
  brandScopes: Array<{ brandId: string; brand: { code: string } }>;
};

interface TeamListProps {
  functionId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export function TeamList({ functionId, canCreate, canUpdate, canDelete }: TeamListProps) {
  const refresh = useRefresh();
  const { data: rawTeams = [], isLoading } = trpc.company.team.listByFunction.useQuery({ functionId });
  const teams = rawTeams as unknown as TeamSummary[];

  const [createOpen, setCreateOpen] = useState(false);
  const [editTeamId, setEditTeamId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamSummary | null>(null);

  const deleteMutation = trpc.company.team.delete.useMutation({
    onSuccess: async () => { toast.success('Team eliminato'); await refresh.company(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Caricamento…</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {teams.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <Users size={32} className="text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">Nessun team in questa funzione</p>
            {canCreate && (
              <p className="mt-1 text-xs text-muted-foreground">Crea il primo team usando il pulsante in basso</p>
            )}
          </div>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {teams.map(team => (
            <div key={team.id} className="flex items-center gap-3 px-4 py-3">
              <Users size={15} className="shrink-0 text-muted-foreground" />

              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{team.name}</span>
                {team.description && (
                  <span className="ml-2 truncate text-xs text-muted-foreground">{team.description}</span>
                )}
              </div>

              <span className="shrink-0 text-xs text-muted-foreground">
                {team._count.memberships} {team._count.memberships === 1 ? 'membro' : 'membri'}
              </span>

              <div className="hidden shrink-0 items-center gap-1 sm:flex">
                {team.brandScopes.length === 0 ? (
                  <span className="text-xs italic text-muted-foreground">tutti i brand</span>
                ) : (
                  <>
                    {team.brandScopes.slice(0, 3).map(s => (
                      <Badge key={s.brandId} variant="outline" className="font-mono text-xs">
                        {s.brand.code}
                      </Badge>
                    ))}
                    {team.brandScopes.length > 3 && (
                      <span className="text-xs text-muted-foreground">+{team.brandScopes.length - 3}</span>
                    )}
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setEditTeamId(team.id)}
                >
                  {canUpdate ? 'Gestisci' : 'Visualizza'}
                </Button>

                <PermissionButton
                  hasPermission={canDelete}
                  tooltip="Non hai i permessi per eliminare questo team"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(team)}
                >
                  Elimina
                </PermissionButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-start">
        <CreateActionButton
          label="Nuovo team"
          canCreate={canCreate}
          resourceName="team"
          onClick={() => setCreateOpen(true)}
        />
      </div>

      <CreateTeamDialog
        open={createOpen}
        functionId={functionId}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => { setCreateOpen(false); await refresh.company(); }}
      />

      {editTeamId && (
        <EditTeamDialog
          open={!!editTeamId}
          teamId={editTeamId}
          onClose={() => setEditTeamId(null)}
          onSaved={() => setEditTeamId(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Elimina team"
        description={`Sei sicuro di voler eliminare "${deleteTarget?.name}"? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id }); }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
