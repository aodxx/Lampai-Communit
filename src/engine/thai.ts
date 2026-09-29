export const TZ = 'Asia/Bangkok';
const MONTHS_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface BangkokParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = อาทิตย์
}

export function bangkokParts(d: Date | string): BangkokParts {
  const date = typeof d === 'string' ? new Date(d) : d;
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const year = p.year ?? 0;
  const month = p.month ?? 1;
  const day = p.day ?? 1;
  return {
    year,
    month,
    day,
    hour: p.hour ?? 0,
    minute: p.minute ?? 0,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** YYYY-MM-DD ตามเวลาไทย */
export function bangkokDateKey(d: Date | string): string {
  const p = bangkokParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** เช่น 5 ต.ค. 2569 (พ.ศ.) */
export function formatThaiDate(d: Date | string): string {
  const p = bangkokParts(d);
  return `${p.day} ${MONTHS_ABBR[p.month - 1]} ${p.year + 543}`;
}

/** เช่น 09:00 น. */
export function formatThaiTime(d: Date | string): string {
  const p = bangkokParts(d);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} น.`;
}

export function thaiWeekday(d: Date | string): string {
  return WEEKDAYS[bangkokParts(d).weekday] ?? '';
}
