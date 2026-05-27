export {
  createGoogleCalendarClient,
  testGoogleConnection,
  generateOAuthUrl,
  exchangeOAuthCode,
  type CalendarConfig,
  type GoogleCalendarClient,
} from './google/client.js';
export { buildCalendarSummary, createCalendar, deleteCalendar } from './google/calendars.js';
export { addCalendarReader, removeCalendarReader, syncCalendarReaders } from './google/acl.js';
export { createEvent, updateEvent, deleteEvent, type EventInput } from './google/events.js';
export { syncMilestone, provisionBinding } from './sync/engine.js';
export { computeContentHash } from './sync/hash.js';
export type { MilestoneForSync, SyncContext, GoogleCalendarBindingRecord, GoogleEventMappingRecord } from './sync/types.js';
export { generateIcal, type ICalMilestone } from './ical/generator.js';
export {
  buildGraph,
  topologicalSort,
  detectViolations,
  suggestResolution,
} from './solver/index.js';
export type {
  SolverEvent,
  SolverDependency,
  SolverHoliday,
  GraphInput,
  Violation,
  ProposedShift,
  SimulationResult,
} from './solver/index.js';
