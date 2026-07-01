'use client';

import { Badge } from '../../../../../components/ui/badge';
import { trpc } from '../../../../../lib/trpc';

interface Props {
  rowId: string;
  className?: string;
}

/**
 * Shows the current alert-engine criticality band for a row (days to deadline vs configured
 * thresholds). Renders nothing when the row has no active phase (calendar not set up, or the
 * row already reached its last applicable phase — no alert needed).
 */
export function CriticalityBadge({ rowId, className }: Props) {
  const { data } = trpc.phaseAlert.criticalityForRow.useQuery({ rowId }, { staleTime: 60 * 1000 });
  if (!data) return null;

  return (
    // Color is an admin-configured hex value from AppConfig (collectionControl.alertThresholds),
    // not a design token — cannot be expressed as a static Tailwind/CVA class.
    <Badge
      variant="outline"
      className={className}
      style={{ color: data.band.color, borderColor: data.band.color }}
    >
      {data.band.label}
    </Badge>
  );
}
