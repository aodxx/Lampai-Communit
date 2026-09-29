import { decideIngest, sourceKey } from '../engine/ingest.ts';
import { canTransition, isLive, nextStatusByTime, shouldNotifyOnTransition } from '../engine/lifecycle.ts';
import { dueReminders, offsetsToMarkSent } from '../engine/reminders.ts';
import { suggestPriority } from '../engine/priority.ts';
import { SYSTEM, type Actor, type Announcement, type AnnouncementStatus, type AnnouncementUpdate, type FieldChange, type IncomingItem, type UpdateKind } from '../engine/types.ts';
import { fingerprint } from '../engine/normalize.ts';
import type { Repo } from '../repo/types.ts';
import { queueImmediateIfNeeded } from './delivery.ts';

export interface Ctx {
  repo: Repo;
  communityId: string;
  now: Date;
}

const PUBLISHERS = new Set(['admin', 'village_head']);
const uuid = () => crypto.randomUUID();

export class PermissionError extends Error {}
export class StateError extends Error {}

async function newUpdate(ctx: Ctx, a: Announcement, kind: UpdateKind, summary: string, changes: FieldChange[], notify: boolean, actor: Actor): Promise<AnnouncementUpdate> {
  const u: AnnouncementUpdate = {
    id: uuid(), announcementId: a.id, communityId: ctx.communityId, kind, summary, changes,
    // ประกาศที่ไม่ใช่ public ห้ามถูกแจ้งออก (SEC-003)
    notify: notify && a.dataLevel === 'public', announcedAt: null, actor: actor.id, createdAt: ctx.now.toISOString(),
  };
  await ctx.repo.insertUpdate(u);
  return u;
}

function changeKind(changes: FieldChange[]): UpdateKind {
  const f = changes.map((c) => c.field);
  if (f.includes('effectiveFrom') || f.includes('effectiveTo')) return 'time';
  if (f.includes('location')) return 'place';
  return 'content';
}

function summarize(changes: FieldChange[]): string {
  const names: Record<string, string> = { title: 'หัวข้อ', body: 'รายละเอียด', location: 'สถานที่', effectiveFrom: 'เวลาเริ่ม', effectiveTo: 'เวลาสิ้นสุด' };
  return `มีการเปลี่ยนแปลง: ${changes.map((c) => names[c.field] ?? c.field).join(', ')}`;
}

export type IngestOutcome =
  | { result: 'created'; announcement: Announcement }
  | { result: 'unchanged' | 'cosmetic'; announcement: Announcement }
  | { result: 'updated'; announcement: Announcement; update: AnnouncementUpdate }
  | { result: 'needs_review'; reviewId: string };

/**
 * รับ item จากแหล่งใดก็ได้ → ตัดสิน ใหม่/ซ้ำ/อัปเดต/ให้คนตรวจ → บันทึกความจำ
 * ผลลัพธ์ทุกกรณีถูกบันทึก (FR-204) และรันซ้ำแล้วไม่เกิดเรื่องซ้ำ (FR-201, 205)
 */
export async function ingest(ctx: Ctx, incoming: IncomingItem, actor: Actor = SYSTEM): Promise<IngestOutcome> {
  const { repo, now } = ctx;
  const existing = await repo.listNonArchived(ctx.communityId);
  const d = decideIngest(incoming, existing);
  const stamp = now.toISOString();

  if (d.action === 'create') {
    const a: Announcement = {
      id: uuid(), communityId: ctx.communityId, sourceId: incoming.sourceId, externalId: incoming.externalId ?? null,
      sourceKeys: [sourceKey(incoming.sourceId, incoming.externalId)].filter((k): k is string => !!k),
      fingerprint: d.fingerprint ?? fingerprint(incoming), type: incoming.type, title: incoming.title, body: incoming.body,
      location: incoming.location ?? null, status: 'draft', // ทุกเรื่องเริ่มที่ draft — เผยแพร่ต้องผ่านมนุษย์ (FR-101, 105)
      priority: incoming.priority ?? suggestPriority(incoming), dataLevel: incoming.dataLevel ?? 'public',
      effectiveFrom: incoming.effectiveFrom ?? null, effectiveTo: incoming.effectiveTo ?? null,
      remindOffsetsMin: incoming.remindOffsetsMin ?? [], remindersSent: [], closedAt: null,
      createdAt: stamp, updatedAt: stamp, lastSeenAt: stamp,
    };
    await repo.insertAnnouncement(a);
    await newUpdate(ctx, a, 'created', 'สร้างร่างประกาศ', [], false, actor);
    await repo.audit({ communityId: ctx.communityId, actor: actor.id, action: 'ingest.create', entity: 'announcement', entityId: a.id, after: { title: a.title } });
    return { result: 'created', announcement: a };
  }

  if (d.action === 'review') {
    const reviewId = uuid();
    await repo.insertReview({ id: reviewId, communityId: ctx.communityId, reason: d.reason, incoming, candidateId: d.candidate.id, score: d.score, status: 'open', createdAt: stamp });
    await repo.audit({ communityId: ctx.communityId, actor: actor.id, action: 'ingest.review', entity: 'announcement', entityId: d.candidate.id, after: { reason: d.reason, score: d.score } });
    return { result: 'needs_review', reviewId };
  }

  const m = d.match;
  const key = sourceKey(incoming.sourceId, incoming.externalId);
  if (d.addSource && key && incoming.externalId) await repo.addSourceKey(m.id, incoming.sourceId, incoming.externalId);
  await repo.patchAnnouncement(m.id, { lastSeenAt: stamp });

  if (d.action === 'unchanged') return { result: 'unchanged', announcement: m };
  if (d.action === 'cosmetic') {
    await repo.patchAnnouncement(m.id, { ...d.patch, updatedAt: stamp });
    return { result: 'cosmetic', announcement: { ...m, ...d.patch } };
  }

  // update: เปลี่ยนแปลงอย่างมีนัยสำคัญ
  const patch: Partial<Announcement> = { updatedAt: stamp };
  for (const c of d.changes) (patch as Record<string, unknown>)[c.field] = c.to;
  patch.title = incoming.title;
  patch.body = incoming.body;
  const live = isLive(m.status);
  if (m.status === 'active') patch.status = 'updated';
  await repo.patchAnnouncement(m.id, patch);
  const updated = { ...m, ...patch } as Announcement;
  const u = await newUpdate(ctx, updated, changeKind(d.changes), summarize(d.changes), d.changes, live, actor);
  await repo.audit({ communityId: ctx.communityId, actor: actor.id, action: 'ingest.update', entity: 'announcement', entityId: m.id, before: d.changes.map((c) => ({ [c.field]: c.from })), after: d.changes.map((c) => ({ [c.field]: c.to })) });
  if (u.notify) await queueImmediateIfNeeded(ctx, updated, u);
  return { result: 'updated', announcement: updated, update: u };
}

async function mustGet(ctx: Ctx, id: string): Promise<Announcement> {
  const a = await ctx.repo.getAnnouncement(id);
  if (!a) throw new StateError(`ไม่พบประกาศ ${id}`);
  return a;
}

/** draft → published (ต้องเป็นมนุษย์ที่มีสิทธิ์) — ประกาศ SENSITIVE ต้องเป็นผู้ใหญ่บ้านหรือ อสม. เท่านั้น */
export async function publish(ctx: Ctx, id: string, actor: Actor): Promise<Announcement> {
  const a = await mustGet(ctx, id);
  const allowed = a.dataLevel === 'sensitive' ? ['village_head', 'health_volunteer'].includes(actor.role) : PUBLISHERS.has(actor.role);
  if (!allowed) throw new PermissionError(`บทบาท ${actor.role} ไม่มีสิทธิ์เผยแพร่ประกาศระดับ ${a.dataLevel}`);
  if (!canTransition(a.status, 'published')) throw new StateError(`เปลี่ยนจาก ${a.status} เป็น published ไม่ได้`);
  const patch = { status: 'published' as const, updatedAt: ctx.now.toISOString() };
  await ctx.repo.patchAnnouncement(id, patch);
  const next = { ...a, ...patch };
  const u = await newUpdate(ctx, next, 'status', 'เผยแพร่ประกาศ', [{ field: 'status', from: a.status, to: 'published' }], shouldNotifyOnTransition(a.status, 'published'), actor);
  await ctx.repo.audit({ communityId: ctx.communityId, actor: actor.id, action: 'announcement.publish', entity: 'announcement', entityId: id, before: { status: a.status }, after: { status: 'published' } });
  if (u.notify) await queueImmediateIfNeeded(ctx, next, u);
  return next;
}

/** active/updated/published → resolved พร้อมข้อความสรุป (FR-104) */
export async function resolve(ctx: Ctx, id: string, summary: string, actor: Actor): Promise<Announcement> {
  const a = await mustGet(ctx, id);
  if (!PUBLISHERS.has(actor.role)) throw new PermissionError(`บทบาท ${actor.role} ไม่มีสิทธิ์ปิดเรื่อง`);
  if (!canTransition(a.status, 'resolved')) throw new StateError(`เปลี่ยนจาก ${a.status} เป็น resolved ไม่ได้`);
  const stamp = ctx.now.toISOString();
  const patch = { status: 'resolved' as const, closedAt: stamp, updatedAt: stamp };
  await ctx.repo.patchAnnouncement(id, patch);
  const next = { ...a, ...patch };
  const u = await newUpdate(ctx, next, 'resolution', summary, [{ field: 'status', from: a.status, to: 'resolved' }], shouldNotifyOnTransition(a.status, 'resolved'), actor);
  await ctx.repo.audit({ communityId: ctx.communityId, actor: actor.id, action: 'announcement.resolve', entity: 'announcement', entityId: id, before: { status: a.status }, after: { status: 'resolved', summary } });
  if (u.notify) await queueImmediateIfNeeded(ctx, next, u);
  return next;
}

/** งานตามเวลา: published→active, →expired, →archived และสร้างการเตือนตามกำหนด */
export async function runScheduler(ctx: Ctx): Promise<{ transitioned: number; reminders: number }> {
  const all = await ctx.repo.listNonArchived(ctx.communityId);
  let transitioned = 0;
  let reminders = 0;
  for (const a0 of all) {
    let a = a0;
    const to: AnnouncementStatus | null = nextStatusByTime(a, ctx.now);
    if (to && canTransition(a.status, to)) {
      const closed = to === 'expired' || to === 'resolved';
      const patch = { status: to, updatedAt: ctx.now.toISOString(), ...(closed ? { closedAt: ctx.now.toISOString() } : {}) };
      await ctx.repo.patchAnnouncement(a.id, patch);
      await newUpdate(ctx, { ...a, ...patch }, 'status', `ระบบเปลี่ยนสถานะเป็น ${to}`, [{ field: 'status', from: a.status, to }], shouldNotifyOnTransition(a.status, to), SYSTEM);
      await ctx.repo.audit({ communityId: ctx.communityId, actor: 'system', action: `scheduler.${to}`, entity: 'announcement', entityId: a.id, before: { status: a.status }, after: { status: to } });
      a = { ...a, ...patch };
      transitioned++;
    }
    const due = dueReminders(a, ctx.now);
    if (due.length) {
      const fired = due[0]!;
      const sent = [...new Set([...a.remindersSent, ...offsetsToMarkSent(a, fired)])];
      await ctx.repo.patchAnnouncement(a.id, { remindersSent: sent });
      const u = await newUpdate(ctx, a, 'reminder', `เตือนล่วงหน้า ${fired} นาที`, [], true, SYSTEM);
      if (u.notify) await queueImmediateIfNeeded(ctx, a, u);
      reminders++;
    }
  }
  return { transitioned, reminders };
}
