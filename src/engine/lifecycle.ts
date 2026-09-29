import type { Announcement, AnnouncementStatus } from './types.ts';

/** กติกาการเปลี่ยนสถานะ (PRD 9.1) — ห้ามข้ามโดยไม่ผ่านตารางนี้ */
const TRANSITIONS: Record<AnnouncementStatus, readonly AnnouncementStatus[]> = {
  draft: ['published', 'archived'],
  published: ['active', 'updated', 'resolved', 'expired'],
  active: ['updated', 'resolved', 'expired'],
  updated: ['active', 'resolved', 'expired'],
  resolved: ['archived'],
  expired: ['archived'],
  archived: [],
};

export function canTransition(from: AnnouncementStatus, to: AnnouncementStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isOpen(s: AnnouncementStatus): boolean {
  return s === 'draft' || s === 'published' || s === 'active' || s === 'updated';
}

/** เรื่องที่ "อยู่ในสายตาชาวบ้าน" แล้ว (เผยแพร่แล้วและยังไม่จบ) */
export function isLive(s: AnnouncementStatus): boolean {
  return s === 'published' || s === 'active' || s === 'updated';
}

/** การเปลี่ยนสถานะนี้ต้องแจ้งชาวบ้านหรือไม่ */
export function shouldNotifyOnTransition(from: AnnouncementStatus, to: AnnouncementStatus): boolean {
  if (from === 'draft' && to === 'published') return true; // ประกาศครั้งแรก
  if (to === 'updated' || to === 'resolved') return true;
  return false; // published→active, →expired, →archived ไม่แจ้ง
}

export const DEFAULT_RETENTION_DAYS = 30;

/** สถานะถัดไปตามเวลา (ให้ scheduler เรียก) — คืน null ถ้าไม่ต้องเปลี่ยน */
export function nextStatusByTime(
  a: Pick<Announcement, 'status' | 'effectiveFrom' | 'effectiveTo' | 'closedAt'>,
  now: Date,
  retentionDays = DEFAULT_RETENTION_DAYS,
): AnnouncementStatus | null {
  const t = now.getTime();
  const to = a.effectiveTo ? Date.parse(a.effectiveTo) : null;
  const from = a.effectiveFrom ? Date.parse(a.effectiveFrom) : null;

  if (a.status === 'published' || a.status === 'active' || a.status === 'updated') {
    if (to !== null && to < t) return 'expired';
  }
  if (a.status === 'published' && (from === null || from <= t)) return 'active';
  if ((a.status === 'resolved' || a.status === 'expired') && a.closedAt) {
    if (Date.parse(a.closedAt) + retentionDays * 86_400_000 < t) return 'archived';
  }
  return null;
}
