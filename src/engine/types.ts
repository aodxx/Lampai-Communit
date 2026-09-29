export const STATUSES = ['draft', 'published', 'active', 'updated', 'resolved', 'expired', 'archived'] as const;
export type AnnouncementStatus = (typeof STATUSES)[number];
export type Priority = 'critical' | 'important' | 'normal' | 'info';
export type DataLevel = 'public' | 'internal' | 'sensitive';
export type AnnouncementType = 'notice' | 'meeting' | 'event' | 'news' | 'road' | 'utility' | 'health' | 'official';
export type UpdateKind = 'created' | 'content' | 'status' | 'time' | 'place' | 'reminder' | 'resolution';
export type Role = 'admin' | 'village_head' | 'assistant' | 'health_volunteer' | 'editor' | 'viewer' | 'system';

export interface Actor {
  id: string;
  role: Role;
}
export const SYSTEM: Actor = { id: 'system', role: 'system' };

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** ข้อมูลที่เข้ามาจากแหล่งใดก็ได้ (ผู้ดูแลกรอก / ข่าว / เอกสาร) */
export interface IncomingItem {
  sourceId: string;
  externalId?: string | null;
  type: AnnouncementType;
  title: string;
  body: string;
  location?: string | null;
  effectiveFrom?: string | null; // ISO 8601 พร้อม offset
  effectiveTo?: string | null;
  priority?: Priority;
  dataLevel?: DataLevel;
  remindOffsetsMin?: number[];
}

export interface Announcement {
  id: string;
  communityId: string;
  sourceId: string;
  externalId: string | null;
  /** `${sourceId}:${externalId}` ของทุกแหล่งที่ยืนยันเรื่องนี้ */
  sourceKeys: string[];
  fingerprint: string;
  type: AnnouncementType;
  title: string;
  body: string;
  location: string | null;
  status: AnnouncementStatus;
  priority: Priority;
  dataLevel: DataLevel;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  remindOffsetsMin: number[];
  remindersSent: number[];
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface AnnouncementUpdate {
  id: string;
  announcementId: string;
  communityId: string;
  kind: UpdateKind;
  summary: string;
  changes: FieldChange[];
  /** ควรแจ้งชาวบ้านหรือไม่ */
  notify: boolean;
  /** เวลาที่ถูกนำไปแจ้งแล้ว (Briefing หรือส่งด่วน) — null = ยังไม่เคยแจ้ง */
  announcedAt: string | null;
  actor: string;
  createdAt: string;
}
