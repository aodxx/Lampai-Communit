import type { Announcement, AnnouncementUpdate, DataLevel, IncomingItem, Priority } from '../engine/types.ts';
import type { DeliveryHealthRow, JobRunRecord } from '../engine/health.ts';
import type { WeatherObs } from '../engine/weather.ts';

export type DeliveryStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export interface Delivery {
  id: string; // uuid — ใช้เป็น X-Line-Retry-Key ด้วย
  communityId: string;
  kind: 'announcement' | 'briefing';
  channel: 'line_text';
  audience: 'community';
  announcementId: string | null;
  updateId: string | null;
  briefingId: string | null;
  priority: Priority;
  dataLevel: DataLevel;
  payload: string;
  idempotencyKey: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface BriefingRow {
  id: string;
  communityId: string;
  idempotencyKey: string;
  slot: string;
  briefingDate: string;
  decision: 'send' | 'skip_no_change';
  reason: string;
  text: string | null;
  refs: unknown;
  createdAt: string;
}

export interface ReviewItem {
  id: string;
  communityId: string;
  reason: string;
  incoming: IncomingItem;
  candidateId: string | null;
  score: number;
  status: 'open' | 'merged' | 'rejected' | 'created';
  createdAt: string;
}

export interface PendingNews {
  update: AnnouncementUpdate;
  announcement: Announcement;
}

export interface AuditEntry {
  communityId: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export interface JobRun {
  id: string;
  communityId: string;
  job: string;
  startedAt: string;
}

/** ช่องทางเดียวที่ business logic คุยกับฐานข้อมูล — Supabase จริง หรือ in-memory สำหรับทดสอบ/dry-run */
export interface Repo {
  listNonArchived(communityId: string): Promise<Announcement[]>;
  getAnnouncement(id: string): Promise<Announcement | null>;
  insertAnnouncement(a: Announcement): Promise<void>;
  patchAnnouncement(id: string, patch: Partial<Omit<Announcement, 'id' | 'sourceKeys'>>): Promise<void>;
  addSourceKey(announcementId: string, sourceId: string, externalId: string): Promise<void>;

  insertUpdate(u: AnnouncementUpdate): Promise<void>;
  /** update ที่ notify=true, ยังไม่เคยแจ้ง, และเรื่องเป็น public */
  pendingNews(communityId: string): Promise<PendingNews[]>;
  markAnnounced(updateIds: string[], at: string): Promise<void>;

  insertReview(r: ReviewItem): Promise<void>;

  /** คืน true ถ้าเป็นข้อมูลใหม่, false ถ้ามี observed_at นี้แล้ว */
  insertWeather(o: WeatherObs): Promise<boolean>;
  latestWeather(communityId: string): Promise<WeatherObs | null>;

  getBriefingByKey(key: string): Promise<BriefingRow | null>;
  insertBriefing(b: BriefingRow): Promise<void>;

  /** คืน true ถ้าสร้างใหม่, false ถ้า idempotency key นี้มีแล้ว (ไม่ส่งซ้ำ) */
  insertDeliveryIfAbsent(d: Delivery): Promise<boolean>;
  /** รายการ delivery สำหรับหน้าผู้ดูแล (เรียงใหม่ไปเก่าและจำกัดจำนวน) */
  listDeliveries(communityId: string, limit?: number): Promise<Delivery[]>;
  listDispatchable(communityId: string): Promise<Delivery[]>;
  /**
   * จองรายการส่งแบบอะตอมมิก (compare-and-set บน next_attempt_at): คืน true เฉพาะผู้เรียกที่ได้สิทธิ์ส่ง
   * กัน tick กับการส่งทันทีหลัง publish ส่งรายการเดียวกันพร้อมกัน; lease หมดอายุเองถ้า process ตายกลางทาง
   */
  claimDelivery(id: string, now: Date, leaseMs: number): Promise<boolean>;
  recordAttempt(deliveryId: string, attempt: { ok: boolean; httpStatus: number | null; error: string | null }, patch: Partial<Pick<Delivery, 'status' | 'attemptCount' | 'lastError' | 'nextAttemptAt' | 'sentAt'>>): Promise<void>;

  audit(e: AuditEntry): Promise<void>;
  startJob(communityId: string, job: string, at: string): Promise<JobRun>;
  finishJob(run: JobRun, status: 'ok' | 'error', stats: Record<string, unknown>, error?: string): Promise<void>;

  /** ประวัติ job ตั้งแต่ sinceIso (ใหม่→เก่า) สำหรับ healthcheck */
  recentJobRuns(communityId: string, sinceIso: string): Promise<JobRunRecord[]>;
  /** deliveries ที่ค้างคิว (อายุเท่าใดก็ได้) + ที่ล้มเหลวตั้งแต่ sinceIso */
  listUnhealthyDeliveries(communityId: string, sinceIso: string): Promise<DeliveryHealthRow[]>;
}
