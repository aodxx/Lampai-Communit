import { alertedAtFrom, evaluateHealth, formatHealthAlert, LOOKBACK_HOURS, shouldAlert, type ExpectedJob } from '../engine/health.ts';
import type { Ctx } from './announcements.ts';
import type { QuotaProvider } from '../adapters/lineQuota.ts';
import type { Sender } from './delivery.ts';

export interface HealthcheckStats extends Record<string, unknown> {
  issues: number;
  newIssues: number;
  sent: boolean;
  /** ปัญหาที่ยัง active → เวลาที่แจ้งผู้ดูแลล่าสุด (ISO) — ยกไปรอบถัดไปเพื่อไม่แจ้งซ้ำ */
  alertedAt: Record<string, string>;
}

/**
 * Healthcheck (NFR-003): ตรวจ job ที่ล้มเหลว/หยุดรัน/ค้าง และคิวส่งที่ค้าง/ล้มเหลว แล้วแจ้ง "ผู้ดูแล" เท่านั้น
 * - adminSender ต้องเป็นช่องทางผู้ดูแล (ไม่ใช่กลุ่มชุมชน) และไม่ผ่านตาราง deliveries ของชุมชน
 * - ปัญหาเดิมแจ้งครั้งเดียว (ใช้ stats.alertedAt ของรอบก่อน; job หยุดรันที่ยังไม่แก้เตือนซ้ำทุก 6 ชม.) ส่งไม่สำเร็จ/ไม่มีช่องทางแจ้ง → throw ให้ job และ workflow ล้ม (ห้ามเงียบ)
 */
export async function runHealthcheck(
  ctx: Ctx,
  adminSender: Sender | null,
  opts: { dryRun?: boolean; expected?: ExpectedJob[]; quota?: QuotaProvider; onText?: (text: string) => void } = {},
): Promise<HealthcheckStats> {
  const since = new Date(ctx.now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString();
  const jobs = await ctx.repo.recentJobRuns(ctx.communityId, since);
  const deliveries = await ctx.repo.listUnhealthyDeliveries(ctx.communityId, since);
  let quota = null;
  let quotaError: string | null = null;
  if (opts.quota) {
    try {
      quota = await opts.quota.get();
    } catch (e) {
      quotaError = e instanceof Error ? e.message : String(e);
    }
  }
  const issues = evaluateHealth({ now: ctx.now, jobs, deliveries, expected: opts.expected, quota, quotaError });

  const already = alertedAtFrom(jobs, ctx.now);
  const fresh = issues.filter((i) => shouldAlert(i, already, ctx.now));
  const freshKeys = new Set(fresh.map((i) => i.key));
  const carried: Record<string, string> = {};
  for (const i of issues) {
    const prev = already.get(i.key);
    if (prev !== undefined && !freshKeys.has(i.key)) carried[i.key] = new Date(prev).toISOString();
  }

  if (fresh.length === 0) {
    return { issues: issues.length, newIssues: 0, sent: false, alertedAt: carried };
  }

  const text = formatHealthAlert(fresh, ctx.now);
  opts.onText?.(text);
  if (opts.dryRun) {
    return { issues: issues.length, newIssues: fresh.length, sent: false, alertedAt: carried };
  }
  if (!adminSender) {
    throw new Error(`พบปัญหาใหม่ ${fresh.length} รายการ แต่ไม่ได้ตั้งช่องทางแจ้งผู้ดูแล (ADMIN_LINE_TARGET)\n${text}`);
  }
  const r = await adminSender.send(text, crypto.randomUUID()).catch((e: unknown) => ({ ok: false, status: null, error: e instanceof Error ? e.message : String(e) }));
  if (!r.ok) throw new Error(`แจ้งผู้ดูแลไม่สำเร็จ: ${r.error ?? `http ${r.status}`}\n${text}`);
  const nowIso = ctx.now.toISOString();
  return { issues: issues.length, newIssues: fresh.length, sent: true, alertedAt: { ...carried, ...Object.fromEntries(fresh.map((i) => [i.key, nowIso])) } };
}
