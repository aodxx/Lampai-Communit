import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Announcement, AnnouncementUpdate } from '../engine/types.ts';
import type { WeatherObs } from '../engine/weather.ts';
import type { AuditEntry, BriefingRow, Delivery, JobRun, PendingNews, Repo, ReviewItem } from './types.ts';

type Row = Record<string, unknown>;
const toSnake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const fromRow = <T>(row: Row): T => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v])) as T;
const toRow = (o: object): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]));

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase ${what}: ${res.error.message}`);
  return res.data as T;
}

interface AnnouncementRow extends Row {
  announcement_sources?: { source_id: string; external_id: string }[];
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  const { announcement_sources, ...rest } = row;
  const a = fromRow<Announcement>(rest);
  a.sourceKeys = (announcement_sources ?? []).map((s) => `${s.source_id}:${s.external_id}`);
  return a;
}

/** Repo ที่ใช้ Supabase (service role — ฝั่ง server/Actions เท่านั้น ห้ามใช้ใน client) */
export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async listNonArchived(communityId: string) {
    const r = await this.db.from('announcements').select('*, announcement_sources(source_id, external_id)').eq('community_id', communityId).neq('status', 'archived');
    return check(r, 'listNonArchived').map((x) => toAnnouncement(x as AnnouncementRow));
  }
  async getAnnouncement(id: string) {
    const r = await this.db.from('announcements').select('*, announcement_sources(source_id, external_id)').eq('id', id).maybeSingle();
    const row = check(r, 'getAnnouncement');
    return row ? toAnnouncement(row as AnnouncementRow) : null;
  }
  async insertAnnouncement(a: Announcement) {
    const { sourceKeys, ...rest } = a;
    check(await this.db.from('announcements').insert(toRow(rest)), 'insertAnnouncement');
    for (const k of sourceKeys) {
      const i = k.indexOf(':');
      await this.addSourceKey(a.id, k.slice(0, i), k.slice(i + 1));
    }
  }
  async patchAnnouncement(id: string, patch: Partial<Omit<Announcement, 'id' | 'sourceKeys'>>) {
    check(await this.db.from('announcements').update(toRow(patch)).eq('id', id), 'patchAnnouncement');
  }
  async addSourceKey(announcementId: string, sourceId: string, externalId: string) {
    check(
      await this.db.from('announcement_sources').upsert({ announcement_id: announcementId, source_id: sourceId, external_id: externalId }, { onConflict: 'source_id,external_id', ignoreDuplicates: true }),
      'addSourceKey',
    );
  }

  async insertUpdate(u: AnnouncementUpdate) {
    check(await this.db.from('announcement_updates').insert(toRow(u)), 'insertUpdate');
  }
  async pendingNews(communityId: string): Promise<PendingNews[]> {
    const r = await this.db
      .from('announcement_updates')
      .select('*, announcements!inner(*, announcement_sources(source_id, external_id))')
      .eq('community_id', communityId)
      .eq('notify', true)
      .is('announced_at', null)
      .eq('announcements.data_level', 'public')
      .order('created_at', { ascending: true });
    return check(r, 'pendingNews').map((x) => {
      const { announcements, ...u } = x as Row & { announcements: AnnouncementRow };
      return { update: fromRow<AnnouncementUpdate>(u), announcement: toAnnouncement(announcements) };
    });
  }
  async markAnnounced(updateIds: string[], at: string) {
    if (!updateIds.length) return;
    check(await this.db.from('announcement_updates').update({ announced_at: at }).in('id', updateIds), 'markAnnounced');
  }

  async insertReview(r: ReviewItem) {
    check(await this.db.from('review_queue').insert(toRow(r)), 'insertReview');
  }

  async insertWeather(o: WeatherObs) {
    const r = await this.db.from('weather_observations').upsert(toRow(o), { onConflict: 'community_id,observed_at', ignoreDuplicates: true }).select('id');
    return check(r, 'insertWeather').length > 0;
  }
  async latestWeather(communityId: string) {
    const r = await this.db.from('weather_observations').select('*').eq('community_id', communityId).order('observed_at', { ascending: false }).limit(1).maybeSingle();
    const row = check(r, 'latestWeather');
    if (!row) return null;
    const { id: _id, ...rest } = row as Row;
    return fromRow<WeatherObs>(rest);
  }

  async getBriefingByKey(key: string) {
    const row = check(await this.db.from('briefings').select('*').eq('idempotency_key', key).maybeSingle(), 'getBriefingByKey');
    return row ? fromRow<BriefingRow>(row as Row) : null;
  }
  async insertBriefing(b: BriefingRow) {
    check(await this.db.from('briefings').insert(toRow(b)), 'insertBriefing');
  }

  async insertDeliveryIfAbsent(d: Delivery) {
    const r = await this.db.from('deliveries').upsert(toRow(d), { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id');
    return check(r, 'insertDeliveryIfAbsent').length > 0;
  }
  async listDispatchable(communityId: string) {
    const r = await this.db.from('deliveries').select('*').eq('community_id', communityId).eq('status', 'queued').order('created_at', { ascending: true });
    return check(r, 'listDispatchable').map((x) => fromRow<Delivery>(x as Row));
  }
  async recordAttempt(deliveryId: string, attempt: { ok: boolean; httpStatus: number | null; error: string | null }, patch: Partial<Delivery>) {
    check(await this.db.from('delivery_attempts').insert({ delivery_id: deliveryId, ok: attempt.ok, http_status: attempt.httpStatus, error: attempt.error }), 'recordAttempt.insert');
    check(await this.db.from('deliveries').update(toRow(patch)).eq('id', deliveryId), 'recordAttempt.update');
  }

  async audit(e: AuditEntry) {
    check(await this.db.from('audit_logs').insert(toRow(e)), 'audit');
  }
  async startJob(communityId: string, job: string, at: string): Promise<JobRun> {
    const r = await this.db.from('job_runs').insert({ community_id: communityId, job, started_at: at, status: 'running' }).select('id').single();
    const row = check(r, 'startJob') as { id: string };
    return { id: row.id, communityId, job, startedAt: at };
  }
  async finishJob(run: JobRun, status: 'ok' | 'error', stats: Record<string, unknown>, error?: string) {
    check(await this.db.from('job_runs').update({ finished_at: new Date().toISOString(), status, stats, error: error ?? null }).eq('id', run.id), 'finishJob');
  }
}
