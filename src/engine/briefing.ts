import { isFresh } from './freshness.ts';
import { describeChange, type DescribableChange } from './message.ts';
import { priorityRank } from './priority.ts';
import { bangkokParts, formatThaiDate, thaiWeekday } from './thai.ts';
import { isSignificantWeather, weatherAdvice, weatherSummaryText, type WeatherObs } from './weather.ts';
import type { AnnouncementStatus, Priority } from './types.ts';

export interface BriefingChange extends DescribableChange {
  updateId: string;
  announcementId: string;
  priority: Priority;
  announcementStatus: AnnouncementStatus;
}

export interface BriefingRef {
  updateId: string;
  announcementId: string;
}

export interface BriefingResult {
  decision: 'send' | 'skip_no_change';
  reason: string;
  text: string | null;
  /** ทุกบรรทัดที่พูดต้องย้อนกลับไปหาข้อมูลจริงได้ (FR-502) */
  refs: BriefingRef[];
  includedUpdateIds: string[];
  droppedUpdateIds: string[];
  weatherIncluded: boolean;
}

export const MAX_ITEMS_PER_BRIEFING = 5; // [สมมติฐาน] FR-403

function period(hour: number): string {
  return hour < 12 ? 'เช้า' : hour < 16 ? 'บ่าย' : 'เย็น';
}

/**
 * ตัดสินว่ารอบนี้ "ควรพูดหรือไม่" และประกอบข้อความ (FR-501, 502, 503)
 * กฎ: มีสาระใหม่อย่างน้อย 1 อย่างจึงส่ง — คำทักทายและอากาศทั่วไปไม่ใช่เหตุผลให้ส่งโดด ๆ
 */
export function composeBriefing(input: { now: Date; weather: WeatherObs | null; changes: BriefingChange[] }): BriefingResult {
  const { now, weather } = input;

  // เรื่องที่หมดอายุ/เก็บแล้วห้ามนำมาพูด (ยกเว้นบทสรุปการสิ้นสุด resolution)
  const dropped = input.changes.filter((c) => c.announcementStatus === 'expired' || c.announcementStatus === 'archived');
  const usable = input.changes
    .filter((c) => !dropped.includes(c))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

  const weatherFresh = !!weather && isFresh('weather_current', weather.observedAt, now);
  const weatherNotable = weatherFresh && !!weather && isSignificantWeather(weather);

  if (usable.length === 0 && !weatherNotable) {
    const why = !weather ? 'ไม่มีข้อมูลอากาศ' : weatherFresh ? 'อากาศไม่มีอะไรผิดปกติ' : 'ข้อมูลอากาศเกินอายุ';
    return {
      decision: 'skip_no_change',
      reason: `ไม่มีเรื่องใหม่ที่ควรแจ้ง (${why})`,
      text: null,
      refs: [],
      includedUpdateIds: [],
      droppedUpdateIds: dropped.map((d) => d.updateId),
      weatherIncluded: false,
    };
  }

  const shown = usable.slice(0, MAX_ITEMS_PER_BRIEFING);
  const overflow = usable.length - shown.length;
  const p = bangkokParts(now);
  const lines: string[] = [`สวัสดีตอน${period(p.hour)}ครับ วัน${thaiWeekday(now)}ที่ ${formatThaiDate(now)}`];

  let weatherIncluded = false;
  if (weatherFresh && weather && (weatherNotable || shown.length > 0)) {
    weatherIncluded = true;
    lines.push(`อากาศ: ${weatherSummaryText(weather)}`);
    lines.push(...weatherAdvice(weather));
  }

  if (shown.length > 0) {
    lines.push('เรื่องที่ควรรู้:');
    shown.forEach((c, i) => lines.push(`${i + 1}. ${describeChange(c)}`));
    if (overflow > 0) lines.push(`และมีอีก ${overflow} เรื่อง`);
  }

  return {
    decision: 'send',
    reason: shown.length > 0 ? `มี ${shown.length} เรื่องที่เปลี่ยนแปลง/ต้องเตือน` : 'อากาศมีนัยสำคัญ',
    text: lines.join('\n'),
    refs: shown.map((c) => ({ updateId: c.updateId, announcementId: c.announcementId })),
    includedUpdateIds: shown.map((c) => c.updateId),
    droppedUpdateIds: dropped.map((d) => d.updateId),
    weatherIncluded,
  };
}
