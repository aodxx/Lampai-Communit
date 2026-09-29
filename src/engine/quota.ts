import type { Priority } from './types.ts';

/** โควต้าข้อความ LINE ต่อเดือน (R3, NFR-005) — ฟังก์ชันบริสุทธิ์ */
export interface QuotaInfo {
  /** null = ไม่จำกัด (แผนที่ไม่มีเพดาน) */
  limit: number | null;
  used: number;
}

export type QuotaLevel = 'ok' | 'low' | 'restrict' | 'exhausted';

// ค่าเกณฑ์ [สมมติฐาน] แก้ที่นี่ที่เดียว
export const QUOTA_WARN_RATIO = 0.8; // แจ้งผู้ดูแลล่วงหน้า
export const QUOTA_RESTRICT_RATIO = 0.95; // ส่งเฉพาะ CRITICAL

export function quotaLevel(q: QuotaInfo): QuotaLevel {
  if (q.limit === null || q.limit <= 0) return 'ok';
  const r = q.used / q.limit;
  if (r >= 1) return 'exhausted';
  if (r >= QUOTA_RESTRICT_RATIO) return 'restrict';
  if (r >= QUOTA_WARN_RATIO) return 'low';
  return 'ok';
}

/** โควต้าต่ำ → ส่งเฉพาะ CRITICAL; เมื่อหมดก็ยังลองส่ง CRITICAL (ให้ LINE ตอบเอง และระบบ retry/แจ้งผู้ดูแล) */
export function canSendUnderQuota(priority: Priority, level: QuotaLevel): boolean {
  if (level === 'ok' || level === 'low') return true;
  return priority === 'critical';
}

export function quotaPercent(q: QuotaInfo): number | null {
  return q.limit && q.limit > 0 ? Math.round((q.used / q.limit) * 100) : null;
}
