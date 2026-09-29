import { deliversImmediately, canSendNow } from '../engine/priority.ts';
import { formatAnnouncementMessage } from '../engine/message.ts';
import type { Announcement, AnnouncementUpdate } from '../engine/types.ts';
import type { Delivery, Repo } from '../repo/types.ts';
import type { Ctx } from './announcements.ts';

export interface Sender {
  send(text: string, retryKey: string): Promise<{ ok: boolean; status: number | null; error?: string }>;
}

export const MAX_ATTEMPTS = 3;

/** เรื่องด่วนวิกฤตส่งทันที (ไม่รอ Briefing) — ที่เหลือรอรวมใน Briefing */
export async function queueImmediateIfNeeded(ctx: Ctx, a: Announcement, u: AnnouncementUpdate): Promise<boolean> {
  if (!u.notify || a.dataLevel !== 'public' || !deliversImmediately(a.priority)) return false;
  const d: Delivery = {
    id: crypto.randomUUID(), communityId: ctx.communityId, kind: 'announcement', channel: 'line_text', audience: 'community',
    announcementId: a.id, updateId: u.id, briefingId: null, priority: a.priority, dataLevel: a.dataLevel,
    payload: formatAnnouncementMessage(a, u), idempotencyKey: `imm:${u.id}:line_text:community`,
    status: 'queued', attemptCount: 0, lastError: null, sentAt: null, createdAt: ctx.now.toISOString(),
  };
  const created = await ctx.repo.insertDeliveryIfAbsent(d);
  if (created) await ctx.repo.markAnnounced([u.id], ctx.now.toISOString());
  return created;
}

export interface DispatchStats {
  sent: number;
  failed: number;
  heldQuietHours: number;
  refused: number;
}

/** ส่งคิวที่ค้างอยู่: เคารพ quiet hours, ปฏิเสธข้อมูลที่ไม่ใช่ public, retry จำกัดจำนวน, บันทึกทุกความพยายาม */
export async function dispatch(repo: Repo, sender: Sender, communityId: string, now: Date): Promise<DispatchStats> {
  const stats: DispatchStats = { sent: 0, failed: 0, heldQuietHours: 0, refused: 0 };
  for (const d of await repo.listDispatchable(communityId)) {
    if (d.dataLevel !== 'public') {
      await repo.recordAttempt(d.id, { ok: false, httpStatus: null, error: 'refused: non-public data' }, { status: 'skipped', lastError: 'non-public data' });
      stats.refused++;
      continue;
    }
    if (!canSendNow(d.priority, now)) {
      stats.heldQuietHours++;
      continue; // คงอยู่ในคิว ส่งเมื่อพ้นช่วง quiet hours
    }
    const r = await sender.send(d.payload, d.id).catch((e: unknown) => ({ ok: false, status: null, error: e instanceof Error ? e.message : String(e) }));
    const attemptCount = d.attemptCount + 1;
    if (r.ok) {
      await repo.recordAttempt(d.id, { ok: true, httpStatus: r.status, error: null }, { status: 'sent', attemptCount, sentAt: now.toISOString(), lastError: null });
      stats.sent++;
    } else {
      const giveUp = attemptCount >= MAX_ATTEMPTS;
      await repo.recordAttempt(d.id, { ok: false, httpStatus: r.status, error: r.error ?? null }, { status: giveUp ? 'failed' : 'queued', attemptCount, lastError: r.error ?? `http ${r.status}` });
      if (giveUp) stats.failed++;
    }
  }
  return stats;
}
