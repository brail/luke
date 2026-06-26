export interface MilestoneForSync {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  status: string;
  publishExternally: boolean;
  visibilityFunctionIds: string[];
}

export interface GoogleEventMappingRecord {
  eventId: string;
  companyFunctionId: string;
  googleEventId: string;
  googleCalendarId: string;
  contentHash: string;
  lastSyncedAt: Date;
}

export interface GoogleCalendarBindingRecord {
  id: string;
  seasonCalendarId: string;
  companyFunctionId: string;
  googleCalendarId: string;
  isProvisioned: boolean;
}

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
