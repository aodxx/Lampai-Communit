/** อายุสูงสุดของข้อมูลที่ยังนำเสนอเป็น "ปัจจุบัน" ได้ (ชั่วโมง) — ค่าเริ่มต้น [สมมติฐาน] ปรับได้ */
export const TTL_HOURS = {
  weather_current: 3,
  market: 72,
} as const;

export type FreshnessKind = keyof typeof TTL_HOURS;

export function ageHours(asOf: string | Date, now: Date): number {
  const t = typeof asOf === 'string' ? Date.parse(asOf) : asOf.getTime();
  return (now.getTime() - t) / 3_600_000;
}

/** FR-302: ข้อมูลเกินอายุห้ามนำเสนอเป็นปัจจุบัน (ข้อมูลจากอนาคตเกิน 5 นาทีก็ถือว่าผิดปกติ) */
export function isFresh(kind: FreshnessKind, asOf: string | Date, now: Date): boolean {
  const age = ageHours(asOf, now);
  return age >= -5 / 60 && age <= TTL_HOURS[kind];
}
