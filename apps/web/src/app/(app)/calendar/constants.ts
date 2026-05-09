export const SECTION_LABELS: Record<string, string> = {
  'planning.sales': 'Vendite',
  'planning.product': 'Prodotto',
  'planning.sourcing': 'Sourcing',
  'planning.merchandising': 'Merchandising',
};

export const TYPE_LABELS: Record<string, string> = {
  KICKOFF: 'Kickoff',
  REVIEW: 'Review',
  GATE: 'Gate',
  DEADLINE: 'Deadline',
  MILESTONE: 'Milestone',
  CUSTOM: 'Custom',
};

export const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Pianificato',
  IN_PROGRESS: 'In corso',
  COMPLETED: 'Completato',
  CANCELLED: 'Annullato',
};

export const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PLANNED: 'outline',
  IN_PROGRESS: 'default',
  COMPLETED: 'secondary',
  CANCELLED: 'destructive',
};

export const STATUS_OPACITY: Record<string, string> = {
  PLANNED: 'opacity-60',
  IN_PROGRESS: 'opacity-100',
  COMPLETED: 'opacity-40',
  CANCELLED: 'opacity-25',
};
