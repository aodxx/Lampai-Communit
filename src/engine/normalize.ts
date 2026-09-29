import { createHash } from 'node:crypto';
import { bangkokDateKey } from './thai.ts';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** ทำข้อความให้เทียบกันได้: NFC, ตัดอักขระล่องหน, เลขไทย→อารบิก, ยุบช่องว่าง, ตัวพิมพ์เล็ก */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface FingerprintInput {
  type: string;
  title: string;
  location?: string | null;
  effectiveFrom?: string | null;
}

/** ค่าย่อของ "ตัวตนเรื่อง" — ไม่รวมเนื้อหายาว เพื่อให้แก้ถ้อยคำเล็กน้อยแล้วยังเป็นเรื่องเดิม */
export function fingerprint(i: FingerprintInput): string {
  const date = i.effectiveFrom ? bangkokDateKey(i.effectiveFrom) : '';
  const raw = [i.type, normalizeText(i.title), date, normalizeText(i.location)].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient บน bigram ของอักขระ (ใช้ได้กับภาษาไทยที่ไม่มีช่องว่างคั่นคำ) 0..1 */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  for (const [g, c] of ga) overlap += Math.min(c, gb.get(g) ?? 0);
  return (2 * overlap) / (na.length - 1 + (nb.length - 1));
}
