'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { CreateActionButton } from '../../../../components/CreateActionButton';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Card, CardContent } from '../../../../components/ui/card';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { MerchandisingPlanTable } from './_components/MerchandisingPlanTable';
import { MerchandisingRowDialog } from './_components/MerchandisingRowDialog';
import { SpecsheetModal } from './_components/SpecsheetModal';
import { useEnsurePlan, type PlanPair } from './useEnsurePlan';

type MerchandisingRow = RouterOutputs['merchandisingPlan']['listRows'][number];

export default function MerchandisingPlanPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const { can } = usePermission();
  const canUpdate = can('merchandising_plan:update');

  const enabled = !!brand?.id && !!season?.id;

  const { data: plan, isLoading: planLoading } =
    trpc.merchandisingPlan.get.useQuery(
      { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
      { enabled }
    );

  const { data: rows = [], isLoading: rowsLoading } =
    trpc.merchandisingPlan.listRows.useQuery(
      { planId: plan?.id ?? '' },
      { enabled: !!plan?.id }
    );

  const utils = trpc.useUtils();

  // A season without a plan gets one on the first visit of a user who may create it (#146); the
  // empty state's button retries a creation that failed.
  const ensurePlanMutation = trpc.merchandisingPlan.getOrCreate.useMutation();
  const storePlan = (pair: PlanPair, created: NonNullable<typeof plan>) =>
    utils.merchandisingPlan.get.setData(pair, created);
  const notifyPlanError = (err: unknown) => toast.error(getTrpcErrorMessage(err));
  useEnsurePlan(brand?.id, season?.id, plan, canUpdate, {
    create: ensurePlanMutation.mutateAsync,
    store: storePlan,
    onError: notifyPlanError,
  });

  const invalidateRows = () => {
    if (!plan?.id) return;
    utils.merchandisingPlan.listRows.invalidate({ planId: plan.id });
  };

  const invalidatePlan = () => {
    if (!brand?.id || !season?.id) return;
    utils.merchandisingPlan.get.invalidate({
      brandId: brand.id,
      seasonId: season.id,
    });
  };

  // ─── UI state ───────────────────────────────────────────────────
  const [rowDialog, setRowDialog] = useState<{
    mode: 'create' | 'edit';
    row?: MerchandisingRow;
  } | null>(null);

  const [specsheetRow, setSpecsheetRow] = useState<MerchandisingRow | null>(null);

  // ─── Mutations ──────────────────────────────────────────────────
  const createRowMutation = trpc.merchandisingPlan.createRow.useMutation({
    onSuccess: () => {
      toast.success('Riga creata');
      setRowDialog(null);
      invalidateRows();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const updateRowMutation = trpc.merchandisingPlan.updateRow.useMutation({
    onSuccess: () => {
      toast.success('Riga aggiornata');
      setRowDialog(null);
      invalidateRows();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteRowMutation = trpc.merchandisingPlan.deleteRow.useMutation({
    onSuccess: () => {
      toast.success('Riga eliminata');
      invalidateRows();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const updateStatusMutation = trpc.merchandisingPlan.updateStatus.useMutation({
    onSuccess: () => {
      toast.success('Stato piano aggiornato');
      invalidatePlan();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  // ─── Render ─────────────────────────────────────────────────────
  const isLoading = contextLoading || planLoading || rowsLoading || ensurePlanMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Merchandising Plan" description="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Merchandising Plan"
        description={
          brand && season
            ? `Piano ${brand.name} — ${season.code} ${season.year ?? ''}`
            : 'Piano merchandising stagionale'
        }
      />

      {!brand || !season ? (
        <SectionCard title="Contesto non selezionato">
          <p className="text-sm text-muted-foreground">
            Seleziona un brand e una stagione dalla barra in alto per visualizzare
            o creare un Merchandising Plan.
          </p>
        </SectionCard>
      ) : plan ? (
        <Card>
          <CardContent className="pt-6">
            <MerchandisingPlanTable
              plan={plan}
              rows={rows}
              canUpdate={canUpdate}
              onAddRow={() => setRowDialog({ mode: 'create' })}
              onRowClick={row => setSpecsheetRow(row)}
              onUpdateStatus={status =>
                updateStatusMutation.mutate({ planId: plan.id, status })
              }
              isUpdatingStatus={updateStatusMutation.isPending}
            />
          </CardContent>
        </Card>
      ) : plan === null ? (
        <SectionCard title="Nessun piano per questa stagione">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Il Merchandising Plan di questo brand e stagione non è ancora stato creato.
            </p>
            <CreateActionButton
              label="Crea piano"
              resourceName="il piano"
              canCreate={canUpdate}
              isLoading={ensurePlanMutation.isPending}
              onClick={() =>
                ensurePlanMutation.mutate(
                  { brandId: brand.id, seasonId: season.id },
                  { onSuccess: (created, pair) => storePlan(pair, created), onError: notifyPlanError }
                )
              }
            />
          </div>
        </SectionCard>
      ) : null}

      {/* Add / edit row form */}
      {plan && (
        <MerchandisingRowDialog
          open={!!rowDialog}
          onOpenChange={open => { if (!open) setRowDialog(null); }}
          mode={rowDialog?.mode ?? 'create'}
          row={rowDialog?.row}
          planId={plan.id}
          brandId={brand?.id ?? ''}
          seasonId={season?.id ?? ''}
          onSubmit={data => {
            if (rowDialog?.mode === 'create') {
              createRowMutation.mutate({ ...data, planId: plan.id });
            } else if (rowDialog?.row) {
              updateRowMutation.mutate({ id: rowDialog.row.id, data });
            }
          }}
          onDelete={rowDialog?.row
            ? () => {
                deleteRowMutation.mutate({ id: rowDialog.row!.id });
                setRowDialog(null);
              }
            : undefined
          }
          isLoading={createRowMutation.isPending || updateRowMutation.isPending}
          canUpdate={canUpdate}
        />
      )}

      {/* Specsheet modal — opened by clicking a row */}
      {specsheetRow && (
        <SpecsheetModal
          open={!!specsheetRow}
          onOpenChange={open => { if (!open) setSpecsheetRow(null); }}
          row={specsheetRow}
          canUpdate={canUpdate}
          onSaved={() => invalidateRows()}
        />
      )}
    </div>
  );
}
