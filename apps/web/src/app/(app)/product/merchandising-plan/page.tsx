'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

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

type MerchandisingRow = RouterOutputs['merchandisingPlan']['listRows'][number];

export default function MerchandisingPlanPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const { can } = usePermission();
  const canUpdate = can('merchandising_plan:update');

  const enabled = !!brand?.id && !!season?.id;

  const { data: plan, isLoading: planLoading } =
    trpc.merchandisingPlan.getOrCreate.useQuery(
      { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
      { enabled }
    );

  const { data: rows = [], isLoading: rowsLoading } =
    trpc.merchandisingPlan.listRows.useQuery(
      { planId: plan?.id ?? '' },
      { enabled: !!plan?.id }
    );

  const utils = trpc.useUtils();

  const invalidateRows = () => {
    if (!plan?.id) return;
    utils.merchandisingPlan.listRows.invalidate({ planId: plan.id });
  };

  const invalidatePlan = () => {
    if (!brand?.id || !season?.id) return;
    utils.merchandisingPlan.getOrCreate.invalidate({
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
  const isLoading = contextLoading || planLoading || rowsLoading;

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
      ) : null}

      {/* Form aggiunta / modifica riga */}
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

      {/* Specsheet modal — aperto dal click su riga */}
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
