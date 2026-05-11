import type { PlanningSectionKey } from '@luke/core';

export interface MilestoneForSync {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  status: string;
  publishExternally: boolean;
  visibleSectionKeys: PlanningSectionKey[];
}

export interface GoogleEventMappingRecord {
  milestoneId: string;
  sectionKey: string;
  googleEventId: string;
  googleCalendarId: string;
  contentHash: string;
  lastSyncedAt: Date;
}

export interface GoogleCalendarBindingRecord {
  id: string;
  seasonCalendarId: string;
  sectionKey: string;
  googleCalendarId: string;
  isProvisioned: boolean;
}

export interface SyncContext {
  seasonCalendarId: string;
  brandCode: string;
  seasonCode: string;
  allowedUserEmails: string[];
  getOrCreateBinding: (sectionKey: string) => Promise<GoogleCalendarBindingRecord>;
  getMappings: (milestoneId: string) => Promise<GoogleEventMappingRecord[]>;
  upsertMapping: (mapping: Omit<GoogleEventMappingRecord, 'lastSyncedAt'>) => Promise<void>;
  deleteMapping: (milestoneId: string, sectionKey: string) => Promise<void>;
}
