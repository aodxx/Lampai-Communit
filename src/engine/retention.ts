/** นโยบายเก็บข้อมูลของชุมชน — ตัดสินแล้วใน PRD ข้อ 17 #10 */
export const RETENTION = {
  announcementsMonths: 24,
  audioAssetsMonths: 12,
  deliveriesDays: 90,
  weatherDays: 90,
  jobRunsDays: 90,
  auditLogs: 'indefinite',
} as const;

export type RetentionKey = Exclude<keyof typeof RETENTION, 'auditLogs'>;

/** คืนวันย้อนหลังที่ใช้เป็น cutoff สำหรับข้อมูลที่ลบได้ */
export function cutoffDays(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** คืนเดือนย้อนหลังแบบ calendar-safe สำหรับข้อมูลระยะยาว */
export function cutoffMonths(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}
