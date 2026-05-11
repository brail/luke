import type { WidgetId } from '@luke/core';

import { ClocksWidget } from './widgets/ClocksWidget';
import { ForexWidget } from './widgets/ForexWidget';
import { KpiStatsWidget } from './widgets/KpiStatsWidget';
import { SeasonProgressWidget } from './widgets/SeasonProgressWidget';
import { TasksWidget } from './widgets/TasksWidget';
import { WeeklySalesWidget } from './widgets/WeeklySalesWidget';

import type { ComponentType } from 'react';

export interface WidgetInstanceProps {
  settings?: Record<string, unknown>;
}

export interface WidgetDefinition {
  id: WidgetId;
  label: string;
  component: ComponentType<WidgetInstanceProps>;
  defaultEnabled: boolean;
  defaultPosition: number;
  configurable: boolean;
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  { id: 'kpi-stats',       label: 'Statistiche',          component: KpiStatsWidget,       defaultEnabled: true, defaultPosition: 0, configurable: false },
  { id: 'season-progress', label: 'Avanzamento stagione', component: SeasonProgressWidget, defaultEnabled: true, defaultPosition: 1, configurable: false },
  { id: 'weekly-sales',    label: 'Ordini settimanali',   component: WeeklySalesWidget,    defaultEnabled: true, defaultPosition: 2, configurable: false },
  { id: 'tasks',           label: 'Attività personali',   component: TasksWidget,          defaultEnabled: true, defaultPosition: 3, configurable: false },
  { id: 'forex',           label: 'Cambi valuta',         component: ForexWidget,          defaultEnabled: true, defaultPosition: 4, configurable: true  },
  { id: 'clocks',          label: 'Orologi mondo',        component: ClocksWidget,         defaultEnabled: true, defaultPosition: 5, configurable: true  },
];
