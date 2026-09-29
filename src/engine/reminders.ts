import type { Announcement } from './types.ts';

/** ออฟเซ็ตการเตือน (นาทีก่อนเริ่ม) ที่ "ถึงเวลาแล้วและยังไม่เคยเตือน" — เตือนได้ก่อนเริ่มเท่านั้น ห้ามเตือนย้อนหลัง */
export function dueReminders(
  a: Pick<Announcement, 'status' | 'effectiveFrom' | 'remindOffsetsMin' | 'remindersSent'>,
  now: Date,
): number[] {
  if (!a.effectiveFrom) return [];
  if (a.status !== 'published' && a.status !== 'active' && a.status !== 'updated') return [];
  const start = Date.parse(a.effectiveFrom);
  const t = now.getTime();
  if (t >= start) return [];
  // ถ้ามีหลายเกณฑ์ที่ผ่านมาแล้วพร้อมกัน (เช่น ระบบหยุดไปนาน) ให้เตือนเฉพาะเกณฑ์ที่ใกล้เวลาที่สุดครั้งเดียว
  const due = a.remindOffsetsMin
    .filter((off) => !a.remindersSent.includes(off) && t >= start - off * 60_000)
    .sort((x, y) => x - y);
  return due.length ? [due[0]!] : [];
}

/** เกณฑ์ที่ต้องถือว่า "ส่งแล้ว" หลังเตือน: ตัวที่เตือนไป + เกณฑ์ที่ใหญ่กว่าซึ่งผ่านมาแล้ว */
export function offsetsToMarkSent(a: Pick<Announcement, 'remindOffsetsMin'>, fired: number): number[] {
  return a.remindOffsetsMin.filter((o) => o >= fired);
}
