import { formatPlanningGroupLabel } from './PlanningGroupSelect';

interface PlanningGroupRowData {
  id: string;
  name: string;
  isDefault: boolean;
  _count: { events: number };
}

interface Props {
  group: PlanningGroupRowData;
}

/** Name + "(predefinito)" suffix + event count — the row content shared by planning-group pickers. */
export function PlanningGroupListRow({ group }: Props) {
  return (
    <>
      <span className="text-sm flex-1 truncate">{formatPlanningGroupLabel(group)}</span>
      <span className="text-xs text-muted-foreground">{group._count.events} eventi</span>
    </>
  );
}
