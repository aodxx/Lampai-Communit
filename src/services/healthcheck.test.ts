import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo } from '../repo/memory.ts';
import { withJobRun } from '../jobs/run.ts';
import { runHealthcheck } from './healthcheck.ts';
import type { Ctx } from './announcements.ts';
import type { Delivery } from '../repo/types.ts';
import type { Sender } from './delivery.ts';

const C = 'c1';
const T0 = new Date('2026-09-29T12:00:00+07:00');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

class AdminSender implements Sender {
  sent: string[] = [];
  failNext = false;
  async send(text: string) {
    if (this.failNext) { this.failNext = false; return { ok: false, status: 401, error: 'LINE 401 bad token' }; }
    this.sent.push(text);
    return { ok: true, status: 200 };
  }
}

/** จำลองรอบ job ปกติ: บันทึก job_runs สำเร็จของ job ที่ระบุ ณ เวลานั้น */
async function ok(repo: MemoryRepo, job: string, now: Date) {
  await withJobRun(repo, C, job, now, async () => ({}));
}
async function allHealthy(repo: MemoryRepo, now: Date) {
  for (const j of ['weather', 'scheduler', 'dispatch', 'briefing']) await ok(repo, j, now);
}
/** จำลองการรัน healthcheck แบบเดียวกับ CLI (ห่อด้วย withJobRun) */
async function hc(repo: MemoryRepo, now: Date, sender: Sender | null, opts: { dryRun?: boolean } = {}) {
  const ctx: Ctx = { repo, communityId: C, now };
  return withJobRun(repo, C, `healthcheck${opts.dryRun ? ':dry' : ''}`, now, () => runHealthcheck(ctx, sender, opts));
}
async function failJob(repo: MemoryRepo, job: string, now: Date, msg: string) {
  await assert.rejects(withJobRun(repo, C, job, now, async () => { throw new Error(msg); }));
}
const queuedCritical = (createdAt: Date): Delivery => ({
  id: crypto.randomUUID(), communityId: C, kind: 'announcement', channel: 'line_text', audience: 'community', announcementId: null, updateId: null, briefingId: null,
  priority: 'critical', dataLevel: 'public', payload: 'ข้อมูลประกาศ ห้ามหลุดไปในข้อความผู้ดูแล', idempotencyKey: `k:${crypto.randomUUID()}`,
  status: 'queued', attemptCount: 0, lastError: null, nextAttemptAt: null, sentAt: null, createdAt: createdAt.toISOString(),
});

test('ระบบปกติ: ไม่ส่งอะไรถึงผู้ดูแล (ไม่พูดถ้าไม่มีอะไรผิด)', async () => {
  const repo = new MemoryRepo();
  const admin = new AdminSender();
  await allHealthy(repo, at(-10));
  const s = await hc(repo, T0, admin);
  assert.deepEqual([s.issues, s.newIssues, s.sent], [0, 0, false]);
  assert.equal(admin.sent.length, 0);
});

test('job ล้มเหลว: แจ้งผู้ดูแลภายในรอบชั่วโมง และแจ้งครั้งเดียว ไม่แจ้งซ้ำรอบถัดไป', async () => {
  const repo = new MemoryRepo();
  const admin = new AdminSender();
  await allHealthy(repo, at(-10));
  await failJob(repo, 'weather', at(-5), 'Open-Meteo 503');

  const first = await hc(repo, T0, admin);
  assert.equal(first.sent, true);
  assert.equal(admin.sent.length, 1);
  assert.match(admin.sent[0]!, /weather/);
  assert.match(admin.sent[0]!, /Open-Meteo 503/);

  await allHealthy(repo, at(55));
  const second = await hc(repo, at(60), admin);
  assert.deepEqual([second.issues, second.newIssues, second.sent], [1, 0, false]);
  assert.equal(admin.sent.length, 1);

  // ปัญหาเดิมยังอยู่แม้ผ่านไปหลายรอบ ก็ไม่แจ้งซ้ำ (ยกคีย์ไปรอบถัดไป)
  await allHealthy(repo, at(115));
  const third = await hc(repo, at(120), admin);
  assert.equal(third.newIssues, 0);
  assert.equal(admin.sent.length, 1);
});

test('ปัญหาใหม่ระหว่างที่ปัญหาเก่ายังอยู่: แจ้งเฉพาะปัญหาใหม่', async () => {
  const repo = new MemoryRepo();
  const admin = new AdminSender();
  await allHealthy(repo, at(-10));
  await failJob(repo, 'weather', at(-5), 'err-A');
  await hc(repo, T0, admin);

  await allHealthy(repo, at(50));
  await failJob(repo, 'dispatch', at(52), 'err-B');
  await hc(repo, at(60), admin);
  assert.equal(admin.sent.length, 2);
  assert.match(admin.sent[1]!, /err-B/);
  assert.doesNotMatch(admin.sent[1]!, /err-A/);
});

test('ส่งแจ้งผู้ดูแลไม่สำเร็จ: job ล้ม (ไม่เงียบ) และรอบถัดไปแจ้งใหม่', async () => {
  const repo = new MemoryRepo();
  const admin = new AdminSender();
  await allHealthy(repo, at(-10));
  await failJob(repo, 'weather', at(-5), 'boom');

  admin.failNext = true;
  await assert.rejects(hc(repo, T0, admin), /แจ้งผู้ดูแลไม่สำเร็จ/);
  assert.equal(repo.jobs.at(-1)!.status, 'error'); // บันทึกความล้มเหลวของ healthcheck เอง

  await allHealthy(repo, at(55));
  const retry = await hc(repo, at(60), admin);
  assert.equal(retry.sent, true);
  assert.equal(admin.sent.length, 1);
});

test('พบปัญหาแต่ไม่ได้ตั้งช่องทางผู้ดูแล: ล้มพร้อมข้อความปัญหา (ไม่เงียบ)', async () => {
  const repo = new MemoryRepo();
  await allHealthy(repo, at(-10));
  await failJob(repo, 'weather', at(-5), 'boom');
  await assert.rejects(hc(repo, T0, null), /ADMIN_LINE_TARGET[\s\S]*weather/);
});

test('dry-run: แสดงข้อความแต่ไม่ส่ง และไม่ถูกนับว่าแจ้งแล้ว', async () => {
  const repo = new MemoryRepo();
  const admin = new AdminSender();
  await allHealthy(repo, at(-10));
  await failJob(repo, 'weather', at(-5), 'boom');
  const shown: string[] = [];
  const ctx: Ctx = { repo, communityId: C, now: T0 };
  const s = await runHealthcheck(ctx, admin, { dryRun: true, onText: (t) => shown.push(t) });
  assert.equal(shown.length, 1);
  assert.equal(admin.sent.length, 0);
  assert.deepEqual([s.newIssues, s.sent, Object.keys(s.alertedAt).length], [1, false, 0]);

  await hc(repo, T0, admin, { dryRun: true }); // บันทึกเป็น healthcheck:dry
  const real = await hc(repo, at(1), admin);
  assert.equal(real.sent, true); // ของจริงยังแจ้งได้
});

test('job หยุดรัน: แจ้ง แล้วเตือนซ้ำหลังผ่านไป 6 ชม. ถ้ายังไม่แก้', async () => {
  const repo = new MemoryRepo();
  const admin = new AdminSender();
  // ไม่มีการรัน job ใดเลย
  await hc(repo, T0, admin);
  assert.equal(admin.sent.length, 1);
  assert.match(admin.sent[0]!, /หยุดทำงาน/);

  await hc(repo, at(60), admin);
  assert.equal(admin.sent.length, 1); // ชั่วโมงถัดไป ไม่แจ้งซ้ำ

  await hc(repo, at(7 * 60), admin);
  assert.equal(admin.sent.length, 2); // ผ่าน 6 ชม. เตือนอีกครั้ง
});

test('CRITICAL ค้างในคิว: แจ้งผู้ดูแล; ข้อความผู้ดูแลไม่ปนเนื้อหาประกาศ และไม่เข้าคิวของชุมชน', async () => {
  const repo = new MemoryRepo();
  const admin = new AdminSender();
  await allHealthy(repo, at(-10));
  const d = queuedCritical(at(-20));
  repo.deliveries.push(d);
  await hc(repo, T0, admin);
  assert.equal(admin.sent.length, 1);
  assert.match(admin.sent[0]!, /CRITICAL/);
  assert.doesNotMatch(admin.sent[0]!, /ห้ามหลุด/);
  assert.equal(repo.deliveries.length, 1); // แจ้งผู้ดูแลไม่สร้าง delivery ให้ชุมชน
  assert.equal(repo.deliveries[0]!.status, 'queued');
});
