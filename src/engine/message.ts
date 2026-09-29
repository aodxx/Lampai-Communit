import { formatThaiDate, formatThaiTime } from './thai.ts';
import type { Announcement, AnnouncementUpdate, Priority } from './types.ts';

export interface DescribableChange {
  kind: AnnouncementUpdate['kind'];
  title: string;
  summary: string;
  effectiveFrom: string | null;
  location: string | null;
}

function when(iso: string | null): string {
  return iso ? `${formatThaiDate(iso)} เวลา ${formatThaiTime(iso)}` : '';
}

/** ประโยคเดียวอธิบายความเปลี่ยนแปลง — สร้างจากข้อมูลจริงด้วยแม่แบบ ไม่ใช้ LLM */
export function describeChange(c: DescribableChange): string {
  const details = [when(c.effectiveFrom), c.location ? `ที่${c.location.replace(/^ที่/, '')}` : ''].filter(Boolean).join(' ');
  const extra = details ? ` (${details})` : '';
  switch (c.kind) {
    case 'resolution':
      return `${c.title} — สิ้นสุดแล้ว${c.summary ? `: ${c.summary}` : ''}`;
    case 'reminder':
      return `เตือน: ${c.title}${extra}`;
    case 'content':
    case 'time':
    case 'place':
      return `อัปเดต: ${c.title}${c.summary ? ` — ${c.summary}` : ''}${extra}`;
    default:
      return `${c.title}${extra}`;
  }
}

export function toDescribable(a: Announcement, u: AnnouncementUpdate): DescribableChange {
  return { kind: u.kind, title: a.title, summary: u.summary, effectiveFrom: a.effectiveFrom, location: a.location };
}

const HEADER: Record<Priority, string> = {
  critical: '📢 ประกาศด่วนจากหมู่บ้านลำพาย',
  important: 'ประกาศจากหมู่บ้านลำพาย',
  normal: 'ข่าวจากหมู่บ้านลำพาย',
  info: 'ข่าวจากหมู่บ้านลำพาย',
};

/** ข้อความส่งด่วน 1 เรื่อง */
export function formatAnnouncementMessage(a: Announcement, u: AnnouncementUpdate): string {
  const lines = [HEADER[a.priority], describeChange(toDescribable(a, u))];
  if (u.kind !== 'resolution' && a.body && a.body !== a.title) lines.push(a.body);
  return lines.join('\n');
}
