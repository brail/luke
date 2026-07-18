/**
 * Milestone data required by the Google Calendar sync engine.
 * Contains only the fields needed to create/update/delete events and compute content hashes.
 */
export interface MilestoneForSync {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  cancelled: boolean;
  publishExternally: boolean;
  visibilityFunctionIds: string[];
}

/**
 * Persisted mapping between a Luke milestone and a Google Calendar event,
 * scoped to a specific company function (calendar per section).
 */
export interface GoogleEventMappingRecord {
  eventId: string;
  companyFunctionId: string;
  googleEventId: string;
  googleCalendarId: string;
  contentHash: string;
  lastSyncedAt: Date;
}

/**
 * Binding between a season calendar section (company function) and a provisioned
 * Google Calendar. Created on first sync for that function; cached for subsequent runs.
 */
export interface GoogleCalendarBindingRecord {
  id: string;
  seasonCalendarId: string;
  companyFunctionId: string;
  googleCalendarId: string;
  isProvisioned: boolean;
}

/**
 * Runtime context injected into the sync engine.
 * Abstracts all database I/O so the engine remains pure and testable.
 */
export interface SyncContext {
  seasonCalendarId: string;
  brandCode: string;
  seasonCode: string;
  allowedUserEmails: string[];
  getOrCreateBinding: (companyFunctionId: string) => Promise<GoogleCalendarBindingRecord>;
  getMappings: (milestoneId: string) => Promise<GoogleEventMappingRecord[]>;
  upsertMapping: (mapping: Omit<GoogleEventMappingRecord, 'lastSyncedAt'>) => Promise<void>;
  deleteMapping: (milestoneId: string, companyFunctionId: string) => Promise<void>;
}
