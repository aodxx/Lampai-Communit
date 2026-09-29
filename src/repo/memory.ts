import type { Announcement, AnnouncementUpdate } from '../engine/types.ts';
import type { DeliveryHealthRow, JobRunRecord } from '../engine/health.ts';
import type { WeatherObs } from '../engine/weather.ts';
import type { AuditEntry, BriefingRow, Delivery, JobRun, PendingNews, Repo, ReviewItem } from './types.ts';

/** ฐานข้อมูลในหน่วยความจำ — ใช้ทดสอบและ dry-run (พฤติกรรมเดียวกับสัญญาของ Repo) */
export class MemoryRepo implements Repo {
  announcements = new Map<string, Announcement>();
  updates: AnnouncementUpdate[] = [];
  reviews: ReviewItem[] = [];
  weather: WeatherObs[] = [];
  briefings: BriefingRow[] = [];
  deliveries: Delivery[] = [];
  attempts: { deliveryId: string; ok: boolean; httpStatus: number | null; error: string | null }[] = [];
  audits: AuditEntry[] = [];
  jobs: { run: JobRun; status?: string; stats?: Record<string, unknown>; error?: string }[] = [];

  async listNonArchived(communityId: string) {
    return [...this.announcements.values()].filter((a) => a.communityId === communityId && a.status !== 'archived').map((a) => structuredClone(a));
  }
  async getAnnouncement(id: string) {
    const a = this.announcements.get(id);
    return a ? structuredClone(a) : null;
  }
  async insertAnnouncement(a: Announcement) {
    this.announcements.set(a.id, structuredClone(a));
  }
  async patchAnnouncement(id: string, patch: Partial<Announcement>) {
    const a = this.announcements.get(id);
    if (!a) throw new Error(`announcement ${id} not found`);
    Object.assign(a, patch);
  }
  async addSourceKey(announcementId: string, sourceId: string, externalId: string) {
    const a = this.announcements.get(announcementId);
    const key = `${sourceId}:${externalId}`;
    if (a && !a.sourceKeys.includes(key)) a.sourceKeys.push(key);
  }
  async insertUpdate(u: AnnouncementUpdate) {
    this.updates.push(structuredClone(u));
  }
  async pendingNews(communityId: string): Promise<PendingNews[]> {
    const out: PendingNews[] = [];
    for (const u of this.updates) {
      if (!u.notify || u.announcedAt || u.communityId !== communityId) continue;
      const a = this.announcements.get(u.announcementId);
      if (a && a.dataLevel === 'public') out.push({ update: structuredClone(u), announcement: structuredClone(a) });
    }
    return out;
  }
  async markAnnounced(updateIds: string[], at: string) {
    for (const u of this.updates) if (updateIds.includes(u.id)) u.announcedAt = at;
  }
  async insertReview(r: ReviewItem) {
    this.reviews.push(r);
  }
  async insertWeather(o: WeatherObs) {
    if (this.weather.some((w) => w.communityId === o.communityId && w.observedAt === o.observedAt)) return false;
    this.weather.push(o);
    return true;
  }
  async latestWeather(communityId: string) {
    const rows = this.weather.filter((w) => w.communityId === communityId).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
    return rows[0] ?? null;
  }
  async getBriefingByKey(key: string) {
    return this.briefings.find((b) => b.idempotencyKey === key) ?? null;
  }
  async insertBriefing(b: BriefingRow) {
    this.briefings.push(b);
  }
  async insertDeliveryIfAbsent(d: Delivery) {
    if (this.deliveries.some((x) => x.idempotencyKey === d.idempotencyKey)) return false;
    this.deliveries.push(structuredClone(d));
    return true;
  }
  async listDeliveries(communityId: string, limit = 50) {
    return this.deliveries
      .filter((d) => d.communityId === communityId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }
  async listDispatchable(communityId: string) {
    return this.deliveries.filter((d) => d.communityId === communityId && d.status === 'queued').map((d) => structuredClone(d));
  }
  async recordAttempt(deliveryId: string, attempt: { ok: boolean; httpStatus: number | null; error: string | null }, patch: Partial<Delivery>) {
    this.attempts.push({ deliveryId, ...attempt });
    const d = this.deliveries.find((x) => x.id === deliveryId);
    if (d) Object.assign(d, patch);
  }
  async audit(e: AuditEntry) {
    this.audits.push(e);
  }
  async startJob(communityId: string, job: string, at: string) {
    const run = { id: crypto.randomUUID(), communityId, job, startedAt: at };
    this.jobs.push({ run });
    return run;
  }
  async finishJob(run: JobRun, status: 'ok' | 'error', stats: Record<string, unknown>, error?: string) {
    const j = this.jobs.find((x) => x.run.id === run.id);
    if (j) Object.assign(j, { status, stats, error });
  }
  async recentJobRuns(communityId: string, sinceIso: string): Promise<JobRunRecord[]> {
    return this.jobs
      .filter((j) => j.run.communityId === communityId && Date.parse(j.run.startedAt) >= Date.parse(sinceIso))
      .map((j) => ({ id: j.run.id, job: j.run.job, startedAt: j.run.startedAt, finishedAt: j.status && j.status !== 'running' ? j.run.startedAt : null, status: (j.status ?? 'running') as JobRunRecord['status'], stats: j.stats ?? {}, error: j.error ?? null }))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }
  async listUnhealthyDeliveries(communityId: string, sinceIso: string): Promise<DeliveryHealthRow[]> {
    return this.deliveries
      .filter((d) => d.communityId === communityId && (d.status === 'queued' || (d.status === 'failed' && Date.parse(d.createdAt) >= Date.parse(sinceIso))))
      .map((d) => ({ id: d.id, priority: d.priority, status: d.status as 'queued' | 'failed', createdAt: d.createdAt, attemptCount: d.attemptCount, lastError: d.lastError }));
  }
}
