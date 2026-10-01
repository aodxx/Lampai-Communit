import { composeBriefing, type BriefingChange, type BriefingResult } from '../engine/briefing.ts';
import { toDescribable } from '../engine/message.ts';
import { bangkokDateKey } from '../engine/thai.ts';
import type { BriefingRow, Delivery } from '../repo/types.ts';
import type { Ctx } from './announcements.ts';

export type BriefingRun =
  | { status: 'already_done'; briefing: BriefingRow }
  | { status: 'dry_run'; result: BriefingResult }
  | { status: 'done'; result: BriefingResult; briefing: BriefingRow; queued: boolean };

/**
 * Daily Briefing: ถาม Hub ว่า "มีอะไรเปลี่ยน" → ตัดสิน send/skip → บันทึกเหตุผล → คิวส่ง
 * idempotent ต่อ (ชุมชน, วัน, slot): รันซ้ำไม่ส่งซ้ำ (NFR-002)
 */
export async function runBriefing(ctx: Ctx, opts: { slot: string; dryRun?: boolean }): Promise<BriefingRun> {
  const { repo, now, communityId } = ctx;
  const date = bangkokDateKey(now);
  const key = `briefing:${communityId}:${date}:${opts.slot}`;

  const prior = await repo.getBriefingByKey(key);
  if (prior && !opts.dryRun) return { status: 'already_done', briefing: prior };

  const [weather, pending] = await Promise.all([repo.latestWeather(communityId), repo.pendingNews(communityId)]);
  const changes: BriefingChange[] = pending.map(({ update, announcement }) => ({
    ...toDescribable(announcement, update), updateId: update.id, announcementId: announcement.id,
    priority: announcement.priority, announcementStatus: announcement.status,
  }));
  const result = composeBriefing({ now, weather, changes });
  if (opts.dryRun) return { status: 'dry_run', result };

  const briefing: BriefingRow = {
    id: crypto.randomUUID(), communityId, idempotencyKey: key, slot: opts.slot, briefingDate: date,
    decision: result.decision, reason: result.reason, text: result.text, refs: result.refs, createdAt: now.toISOString(),
  };
  await repo.insertBriefing(briefing);

  let queued = false;
  if (result.decision === 'send' && result.text) {
    const d: Delivery = {
      id: crypto.randomUUID(), communityId, kind: 'briefing', channel: 'line_text', audience: 'community',
      announcementId: null, updateId: null, briefingId: briefing.id, priority: 'normal', dataLevel: 'public',
      payload: result.text, idempotencyKey: `brf:${briefing.id}:line_text:community`, status: 'queued',
      attemptCount: 0, lastError: null, nextAttemptAt: null, sentAt: null, createdAt: now.toISOString(),
    };
    queued = await repo.insertDeliveryIfAbsent(d);
    await repo.markAnnounced(result.includedUpdateIds, now.toISOString());
  }
  // เรื่องหมดอายุที่ถูกตัดทิ้ง: ถือว่าจบ ไม่ให้ค้างในคิวข่าวใหม่ตลอดไป
  if (result.droppedUpdateIds.length) await repo.markAnnounced(result.droppedUpdateIds, now.toISOString());
  await repo.audit({ communityId, actor: 'system', action: `briefing.${result.decision}`, entity: 'briefing', entityId: briefing.id, after: { reason: result.reason } });
  return { status: 'done', result, briefing, queued };
}
