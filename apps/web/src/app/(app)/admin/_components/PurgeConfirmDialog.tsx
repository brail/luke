'use client';

import type { RouterOutputs } from '@luke/api';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

type PurgePreview = RouterOutputs['brand']['purgePreview'];

type PurgeCount = keyof PurgePreview['counts'];

/** Italian names of what a purge deletes, keyed by the preview's counts: a new count needs a label. */
const COUNT_LABELS: Record<PurgeCount, string> = {
  layouts: 'collection layout',
  groups: 'gruppi',
  rows: 'righe',
  quotations: 'quotazioni',
  revisions: 'revisioni',
  calendars: 'calendari',
  planningGroups: 'gruppi di pianificazione',
  events: 'eventi',
  merchandisingPlans: 'piani merchandising',
  merchandisingRows: 'righe merchandising',
  parameterSets: 'set di pricing',
  teamBrandScopes: 'scope brand dei team',
  vendorClosures: 'chiusure fornitori',
};

// The keys of a literal typed `Record<PurgeCount, string>`, in its order; `Object.keys` types them `string`.
const PURGE_COUNTS = Object.keys(COUNT_LABELS) as PurgeCount[];

const KIND = {
  brand: { title: 'Elimina brand con i suoi dati', involved: 'Stagioni coinvolte' },
  season: { title: 'Elimina stagione con i suoi dati', involved: 'Brand coinvolti' },
} as const;

// Every field, as the server's refusal sums them: a new kind of outside reference blocks here too.
const outsideCount = (preview: PurgePreview) => Object.values(preview.outside).reduce((a, n) => a + n, 0);

function purgeDescription(kind: keyof typeof KIND, preview: PurgePreview | undefined, previewError: unknown): string {
  if (previewError) return `Impossibile calcolare cosa verrà eliminato: ${getTrpcErrorMessage(previewError)}`;
  if (!preview) return 'Calcolo di cosa verrà eliminato…';
  const outside = outsideCount(preview);
  if (outside > 0) {
    return (
      `"${preview.name}" non può essere eliminato: altri brand o stagioni usano i suoi gruppi di ` +
      `pianificazione o set di pricing (${outside} record). Spostali prima di riprovare.`
    );
  }
  const counts = PURGE_COUNTS.flatMap(key => {
    const n = preview.counts[key] ?? 0;
    return n > 0 ? [`${COUNT_LABELS[key]}: ${n}`] : [];
  });
  return [
    `Elimina "${preview.name}" e tutti i suoi dati${counts.length > 0 ? ` (${counts.join(', ')})` : ''}.`,
    preview.involved.length > 0 ? `${KIND[kind].involved}: ${preview.involved.join(', ')}.` : '',
    preview.keptPictureReferences > 0
      ? `${preview.keptPictureReferences} foto delle revisioni restano nel registro immutabile.`
      : '',
    'Operazione irreversibile: digita il nome per confermare.',
  ]
    .filter(Boolean)
    .join(' ');
}

interface PurgeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: keyof typeof KIND;
  /**
   * The row's name, typed to confirm until the preview brings the stored one. Never empty: an empty
   * `confirmPhrase` turns `ConfirmDialog` into an ungated confirmation.
   */
  name: string;
  /** The server's preview; absent while it loads or after it failed. */
  preview: PurgePreview | undefined;
  previewError?: unknown;
  /** Receives the typed name, which the server compares with the stored one. */
  onConfirm: (confirmName: string) => void;
  isLoading?: boolean;
}

/**
 * Confirms the purge of an inactive, NAV-free brand or season. The action unlocks only on the
 * server's preview with nothing outside in the way, and on the stored name typed; the dialog stays
 * open while the purge runs, so the caller closes it on success.
 */
export function PurgeConfirmDialog({
  open,
  onOpenChange,
  kind,
  name,
  preview,
  previewError,
  onConfirm,
  isLoading,
}: PurgeConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={KIND[kind].title}
      description={purgeDescription(kind, preview, previewError)}
      confirmText="Elimina con i dati"
      cancelText="Annulla"
      actionType="hardDelete"
      confirmPhrase={preview?.name ?? name}
      closeOnConfirm={false}
      confirmDisabled={!preview || !!previewError || outsideCount(preview) > 0}
      onConfirm={typed => { if (typed) onConfirm(typed); }}
      isLoading={isLoading}
    />
  );
}
