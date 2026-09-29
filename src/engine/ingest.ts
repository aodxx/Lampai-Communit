import { fingerprint, normalizeText, similarity } from './normalize.ts';
import { isOpen } from './lifecycle.ts';
import type { Announcement, FieldChange, IncomingItem } from './types.ts';

/** ความคล้ายของ body ที่ถือว่า "ถ้อยคำเปลี่ยนเล็กน้อย" (cosmetic) */
export const BODY_COSMETIC_THRESHOLD = 0.9;
/** ความคล้ายที่ถือว่า "น่าจะเรื่องเดียวกัน" แต่ไม่แน่ใจ → ให้มนุษย์ตรวจ (FR-203) */
export const REVIEW_THRESHOLD = 0.8;

export type IngestDecision =
  | { action: 'create'; fingerprint: string }
  | { action: 'unchanged'; match: Announcement; addSource: boolean }
  | { action: 'cosmetic'; match: Announcement; addSource: boolean; patch: { title: string; body: string } }
  | { action: 'update'; match: Announcement; addSource: boolean; changes: FieldChange[] }
  | { action: 'review'; reason: 'ambiguous_match' | 'closed_item_changed'; candidate: Announcement; score: number };

export function sourceKey(sourceId: string, externalId?: string | null): string | null {
  return externalId ? `${sourceId}:${externalId}` : null;
}

function str(v: string | null | undefined): string | null {
  return v == null || v === '' ? null : v;
}

/** เทียบฟิลด์สำคัญ (PRD FR-202) คืนรายการที่เปลี่ยนอย่างมีนัยสำคัญ */
export function significantChanges(existing: Announcement, incoming: IncomingItem): FieldChange[] {
  const out: FieldChange[] = [];
  const cmp = (field: string, a: string | null, b: string | null, norm = (x: string | null) => x ?? '') => {
    if (norm(a) !== norm(b)) out.push({ field, from: a, to: b });
  };
  cmp('title', existing.title, incoming.title, normalizeText);
  cmp('location', existing.location, str(incoming.location), normalizeText);
  const ts = (x: string | null) => (x ? String(Date.parse(x)) : '');
  cmp('effectiveFrom', existing.effectiveFrom, str(incoming.effectiveFrom), ts);
  cmp('effectiveTo', existing.effectiveTo, str(incoming.effectiveTo), ts);
  if (similarity(existing.body, incoming.body) < BODY_COSMETIC_THRESHOLD) {
    out.push({ field: 'body', from: existing.body, to: incoming.body });
  }
  return out;
}

/**
 * ตัดสินว่า item ที่เข้ามาคือ: เรื่องใหม่ / เรื่องเดิมไม่เปลี่ยน / แก้ถ้อยคำ / เรื่องเดิมมีอัปเดต / ต้องให้คนตรวจ
 * (ฟังก์ชันบริสุทธิ์ — ไม่แตะฐานข้อมูล)
 */
export function decideIngest(incoming: IncomingItem, existing: Announcement[]): IngestDecision {
  const key = sourceKey(incoming.sourceId, incoming.externalId);
  const fp = fingerprint(incoming);

  // 1) ตัวตนแน่นอน: source + external id เดิม
  let match = key ? existing.find((a) => a.sourceKeys.includes(key)) : undefined;
  // 2) fingerprint เดิม (ต่างแหล่งแต่เรื่องเดียวกัน)
  if (!match) match = existing.find((a) => a.fingerprint === fp && a.status !== 'archived');

  if (match) {
    const addSource = !!key && !match.sourceKeys.includes(key);
    const changes = significantChanges(match, incoming);
    if (changes.length === 0) {
      const rawSame = match.title === incoming.title && match.body === incoming.body;
      return rawSame
        ? { action: 'unchanged', match, addSource }
        : { action: 'cosmetic', match, addSource, patch: { title: incoming.title, body: incoming.body } };
    }
    // เรื่องที่จบไปแล้วแต่เนื้อหาเปลี่ยน อาจเป็นเหตุการณ์ใหม่ที่คล้ายเดิม → ให้คนตัดสิน ไม่เปิดเรื่องเก่าเอง
    if (!isOpen(match.status) && match.status !== 'archived') {
      return { action: 'review', reason: 'closed_item_changed', candidate: match, score: 1 };
    }
    return { action: 'update', match, addSource, changes };
  }

  // 3) ไม่พบตัวตนตรง ๆ → ดูความคล้าย (กำกวม = ให้คนตรวจ ไม่รวมเอง)
  let best: { a: Announcement; score: number } | null = null;
  for (const a of existing) {
    if (a.type !== incoming.type || a.status === 'archived') continue;
    const score = 0.6 * similarity(a.title, incoming.title) + 0.4 * similarity(a.body, incoming.body);
    if (!best || score > best.score) best = { a, score };
  }
  if (best && best.score >= REVIEW_THRESHOLD) {
    return { action: 'review', reason: 'ambiguous_match', candidate: best.a, score: best.score };
  }
  return { action: 'create', fingerprint: fp };
}
