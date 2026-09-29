import { bangkokParts } from './thai.ts';
import type { AnnouncementType, Priority } from './types.ts';

const CRITICAL_WORDS = ['ฉุกเฉิน', 'น้ำท่วม', 'น้ำป่า', 'ไฟไหม้', 'ไฟดับ', 'น้ำไม่ไหล', 'น้ำประปาหยุด', 'ปิดถนน', 'ถนนปิด', 'อพยพ', 'พายุ', 'ดินสไลด์', 'ดินถล่ม'];
const IMPORTANT_TYPES: AnnouncementType[] = ['meeting', 'official', 'health', 'road', 'utility'];

/** ข้อเสนอแนะระดับความสำคัญแบบ rule-based — ผู้ดูแลแก้ได้ (FR-401); CRITICAL ต้องมีมนุษย์ publish เสมอ */
export function suggestPriority(i: { type: AnnouncementType; title: string; body: string }): Priority {
  const text = `${i.title} ${i.body}`;
  if (CRITICAL_WORDS.some((w) => text.includes(w))) return 'critical';
  if (IMPORTANT_TYPES.includes(i.type)) return 'important';
  if (i.type === 'news' || i.type === 'event' || i.type === 'notice') return 'normal';
  return 'info';
}

export const QUIET_START_HOUR = 21; // [สมมติฐาน] ปรับได้
export const QUIET_END_HOUR = 6;

export function isQuietHour(now: Date): boolean {
  const h = bangkokParts(now).hour;
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** FR-402: ช่วง quiet hours ห้ามส่ง ยกเว้น CRITICAL */
export function canSendNow(priority: Priority, now: Date): boolean {
  return priority === 'critical' || !isQuietHour(now);
}

/** ส่งทันที (ไม่รอ Briefing) เฉพาะเรื่องด่วนวิกฤต */
export function deliversImmediately(priority: Priority): boolean {
  return priority === 'critical';
}

const RANK: Record<Priority, number> = { critical: 0, important: 1, normal: 2, info: 3 };
export function priorityRank(p: Priority): number {
  return RANK[p];
}
