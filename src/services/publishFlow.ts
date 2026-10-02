import type { Actor, Announcement, IncomingItem } from '../engine/types.ts';
import { dispatch, type Sender } from './delivery.ts';
import { ingest, publish, resolve, type Ctx, type IngestOutcome } from './announcements.ts';

/** ผลการ "ส่งทันที" หลังบันทึกเรื่องด่วน — ใช้แสดงให้ผู้ดูแลเห็นว่าข้อความถึง LINE หรือยัง */
export interface FlushResult {
  /** false = ไม่ได้ตั้งค่า LINE ในสภาพแวดล้อมนี้ (ข้อความอยู่ในคิว รอ tick) */
  configured: boolean;
  sent: number;
  failed: number;
  /** ส่งไม่ทันในเวลาที่กำหนด — ข้อความอยู่ในคิวและ tick จะส่งต่อ (LINE กันซ้ำด้วย retry key) */
  timedOut: boolean;
  error: string | null;
}

export const FLUSH_TIMEOUT_MS = 8_000; // เหลือเวลาตอบกลับก่อน serverless หมดเวลา

/**
 * ส่งรายการ CRITICAL ที่เพิ่งเข้าคิวทันที โดยไม่รอ cron (PRD NFR-004: ≤ 5 นาที, ข้อ 17 #8)
 * ต้องเรียก "หลัง" บันทึกสำเร็จเท่านั้น และไม่โยน error — เพราะประกาศถูกเผยแพร่ไปแล้ว
 * ถ้าล้มเหลวรายการยังอยู่ในคิว (retry/backoff + tick เป็นตัวสำรอง)
 */
export async function flushCritical(ctx: Ctx, sender: Sender | null, opts: { timeoutMs?: number } = {}): Promise<FlushResult> {
  if (!sender) return { configured: false, sent: 0, failed: 0, timedOut: false, error: null };
  const timeoutMs = opts.timeoutMs ?? FLUSH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), timeoutMs);
    });
    // ไม่ส่ง quota provider: CRITICAL ผ่านโควต้าเสมอ จึงไม่ต้องเสียเวลาเรียก API โควต้า
    const run = dispatch(ctx.repo, sender, ctx.communityId, ctx.now, { only: ['critical'] });
    run.catch(() => undefined); // กัน unhandled rejection ถ้า timeout ชนะไปก่อน
    const out = await Promise.race([run, timeout]);
    if (out === 'timeout') return { configured: true, sent: 0, failed: 0, timedOut: true, error: null };
    return { configured: true, sent: out.sent, failed: out.failed, timedOut: false, error: null };
  } catch (e) {
    return { configured: true, sent: 0, failed: 0, timedOut: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PublishResult {
  announcement: Announcement;
  /** null = เรื่องนี้ไม่ใช่ CRITICAL จึงรอรวมใน Briefing รอบถัดไป (ไม่ได้ส่งทันที) */
  delivery: FlushResult | null;
}

export async function publishAndFlush(ctx: Ctx, id: string, actor: Actor, sender: Sender | null): Promise<PublishResult> {
  const announcement = await publish(ctx, id, actor);
  return { announcement, delivery: announcement.priority === 'critical' ? await flushCritical(ctx, sender) : null };
}

export async function resolveAndFlush(ctx: Ctx, id: string, summary: string, actor: Actor, sender: Sender | null): Promise<PublishResult> {
  const announcement = await resolve(ctx, id, summary, actor);
  return { announcement, delivery: announcement.priority === 'critical' ? await flushCritical(ctx, sender) : null };
}

export async function ingestAndFlush(ctx: Ctx, incoming: IncomingItem, actor: Actor, sender: Sender | null): Promise<IngestOutcome & { delivery: FlushResult | null }> {
  const out = await ingest(ctx, incoming, actor);
  const urgent = out.result === 'updated' && out.announcement.priority === 'critical' && out.update.notify;
  return { ...out, delivery: urgent ? await flushCritical(ctx, sender) : null };
}
