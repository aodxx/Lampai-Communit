import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo } from '../repo/memory.ts';
import { ingest, publish, resolve, runScheduler, PermissionError, type Ctx } from './announcements.ts';
import { runBriefing } from './briefing.ts';
import { dispatch, type Sender } from './delivery.ts';
import type { IncomingItem } from '../engine/types.ts';
import type { WeatherObs } from '../engine/weather.ts';

const C = 'c1';
const head = { id: 'u-head', role: 'village_head' as const };
const viewer = { id: 'u-view', role: 'viewer' as const };

const ctxAt = (repo: MemoryRepo, iso: string): Ctx => ({ repo, communityId: C, now: new Date(iso) });
const calm = (iso: string): WeatherObs => ({ communityId: C, observedAt: iso, temperatureC: 27, humidityPct: 80, windKmh: 6, precipitationMm: 0, precipProbability: 20, weatherCode: 1, fetchedAt: iso });

class FakeSender implements Sender {
  sent: string[] = [];
  fail = 0;
  async send(text: string) {
    if (this.fail > 0) { this.fail--; return { ok: false, status: 500, error: 'boom' }; }
    this.sent.push(text);
    return { ok: true, status: 200 };
  }
}

const road = (over: Partial<IncomingItem> = {}): IncomingItem => ({
  sourceId: 'manual', externalId: 'road-1', type: 'road', title: 'ถนนสายหลักปิดซ่อม', body: 'ปิดการจราจรหน้าศาลาหมู่บ้านเพื่อซ่อมผิวทาง',
  location: 'หน้าศาลาหมู่บ้าน', effectiveFrom: '2026-09-26T08:00:00+07:00', priority: 'important', ...over,
});

test('สถานการณ์ถนนปิด 26→27→28: แจ้งครั้งเดียว ไม่แจ้งซ้ำ แล้วแจ้งเมื่อเปิด', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();

  // 26: ผู้ใหญ่บ้านสร้าง+เผยแพร่ (ทุกเรื่องเริ่มเป็น draft)
  let ctx = ctxAt(repo, '2026-09-26T08:00:00+07:00');
  const created = await ingest(ctx, road(), head);
  assert.equal(created.result, 'created');
  const id = (created as { announcement: { id: string } }).announcement.id;
  await assert.rejects(() => publish(ctx, id, viewer), PermissionError);
  await publish(ctx, id, head);
  await runScheduler(ctx);
  assert.equal((await repo.getAnnouncement(id))!.status, 'active');

  // 27 เช้า: Briefing ส่ง 1 ครั้ง
  await repo.insertWeather(calm('2026-09-27T06:00:00+07:00'));
  ctx = ctxAt(repo, '2026-09-27T06:30:00+07:00');
  const b27 = await runBriefing(ctx, { slot: 'morning' });
  assert.equal(b27.status, 'done');
  assert.equal(repo.deliveries.length, 1);
  assert.match(repo.deliveries[0]!.payload, /ถนนสายหลักปิดซ่อม/);

  // รัน Briefing รอบเดิมซ้ำ (retry) ต้องไม่สร้างซ้ำ
  assert.equal((await runBriefing(ctx, { slot: 'morning' })).status, 'already_done');
  assert.equal(repo.deliveries.length, 1);

  // 27 สาย: แหล่งเดิมส่ง item เดิมมาอีก → ไม่มีอะไรเปลี่ยน
  ctx = ctxAt(repo, '2026-09-27T10:00:00+07:00');
  assert.equal((await ingest(ctx, road())).result, 'unchanged');

  // 28 เช้า: ไม่มีอะไรใหม่ → skip ไม่ส่ง
  await repo.insertWeather(calm('2026-09-28T06:00:00+07:00'));
  ctx = ctxAt(repo, '2026-09-28T06:30:00+07:00');
  const b28 = await runBriefing(ctx, { slot: 'morning' });
  assert.equal(b28.status, 'done');
  if (b28.status === 'done') assert.equal(b28.result.decision, 'skip_no_change');
  assert.equal(repo.deliveries.length, 1, 'ห้ามมี delivery ใหม่');
  assert.equal(repo.briefings.at(-1)!.decision, 'skip_no_change');
  assert.ok(repo.briefings.at(-1)!.reason.length > 0, 'ต้องบันทึกเหตุผลที่ข้าม');

  // 28 สาย: ถนนเปิด → resolved
  ctx = ctxAt(repo, '2026-09-28T10:00:00+07:00');
  await resolve(ctx, id, 'เปิดใช้งานถนนตามปกติแล้ว', head);
  assert.equal((await repo.getAnnouncement(id))!.status, 'resolved');

  // 29 เช้า: แจ้งความคืบหน้า
  await repo.insertWeather(calm('2026-09-29T06:00:00+07:00'));
  ctx = ctxAt(repo, '2026-09-29T06:30:00+07:00');
  await runBriefing(ctx, { slot: 'morning' });
  assert.equal(repo.deliveries.length, 2);
  assert.match(repo.deliveries[1]!.payload, /สิ้นสุดแล้ว.*เปิดใช้งานถนน/);

  // ส่งจริง: ได้ 2 ข้อความ และ dispatch ซ้ำไม่ส่งเพิ่ม
  const stats = await dispatch(repo, sender, C, ctx.now);
  assert.equal(stats.sent, 2);
  await dispatch(repo, sender, C, ctx.now);
  assert.equal(sender.sent.length, 2);

  // ร่องรอยตรวจสอบครบ
  assert.ok(repo.audits.some((a) => a.action === 'announcement.publish'));
  assert.ok(repo.audits.some((a) => a.action === 'announcement.resolve'));
});

test('เรื่อง CRITICAL ส่งทันทีแม้กลางคืน ส่วนเรื่องอื่นถูกกักใน quiet hours', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const night = '2026-09-29T23:00:00+07:00';
  const ctx = ctxAt(repo, night);

  const flood = await ingest(ctx, road({ externalId: 'f1', type: 'notice', title: 'น้ำท่วมฉับพลันบริเวณคลอง', body: 'ให้ชาวบ้านย้ายของขึ้นที่สูง', priority: undefined }), head);
  const fid = (flood as { announcement: { id: string; priority: string } }).announcement;
  assert.equal(fid.priority, 'critical'); // ระบบเสนอจากคำสำคัญ
  await publish(ctx, fid.id, head);

  assert.equal(repo.deliveries.length, 1);
  assert.match(repo.deliveries[0]!.payload, /ประกาศด่วน/);
  assert.equal((await dispatch(repo, sender, C, ctx.now)).sent, 1);

  // เรื่องธรรมดาที่ถูกคิวไว้ต้องไม่ถูกส่งตอนกลางคืน
  repo.deliveries.push({ ...repo.deliveries[0]!, id: crypto.randomUUID(), idempotencyKey: 'x', status: 'queued', priority: 'normal', sentAt: null });
  const s = await dispatch(repo, sender, C, ctx.now);
  assert.equal(s.heldQuietHours, 1);
  assert.equal(s.sent, 0);
});

test('เรื่องที่ไม่ใช่ public ไม่ถูกแจ้งออก และส่งเข้าคิวรีวิวเมื่อกำกวม', async () => {
  const repo = new MemoryRepo();
  const ctx = ctxAt(repo, '2026-09-29T10:00:00+07:00');
  const r = await ingest(ctx, road({ externalId: 'h1', type: 'health', title: 'รายชื่อผู้ป่วยติดเตียงที่ต้องเยี่ยม', body: 'ข้อมูลภายใน อสม.', dataLevel: 'sensitive' }), head);
  const id = (r as { announcement: { id: string } }).announcement.id;
  await assert.rejects(() => publish(ctx, id, { id: 'a', role: 'assistant' }), PermissionError);
  await publish(ctx, id, head);
  assert.equal((await repo.pendingNews(C)).length, 0);
  assert.equal(repo.deliveries.length, 0);

  // ข่าวที่คล้ายมากแต่ตัวตนไม่ตรง → ไม่รวมเอง
  await ingest(ctx, road({ externalId: 'r1' }), head);
  const dup = await ingest(ctx, road({ sourceId: 'news', externalId: 'n77', title: 'ถนนสายหลักปิดซ่อมแซม', location: 'ใกล้ศาลา', effectiveFrom: '2026-09-27T08:00:00+07:00' }));
  assert.equal(dup.result, 'needs_review');
  assert.equal(repo.reviews.length, 1);
});

test('ส่งล้มเหลว: retry ได้จำกัดครั้ง แล้วบันทึกทุกความพยายาม', async () => {
  const repo = new MemoryRepo();
  const ctx = ctxAt(repo, '2026-09-29T10:00:00+07:00');
  repo.deliveries.push({
    id: crypto.randomUUID(), communityId: C, kind: 'briefing', channel: 'line_text', audience: 'community', announcementId: null, updateId: null, briefingId: null,
    priority: 'normal', dataLevel: 'public', payload: 'ทดสอบ', idempotencyKey: 'k', status: 'queued', attemptCount: 0, lastError: null, sentAt: null, createdAt: ctx.now.toISOString(),
  });
  const sender = new FakeSender();
  sender.fail = 5;
  await dispatch(repo, sender, C, ctx.now);
  await dispatch(repo, sender, C, ctx.now);
  const last = await dispatch(repo, sender, C, ctx.now);
  assert.equal(last.failed, 1);
  assert.equal(repo.deliveries[0]!.status, 'failed');
  assert.equal(repo.attempts.length, 3);
});

test('การเตือนล่วงหน้า: เตือนตามกำหนดครั้งเดียวต่อเกณฑ์ ไม่ใช่การแจ้งซ้ำ', async () => {
  const repo = new MemoryRepo();
  let ctx = ctxAt(repo, '2026-10-01T09:00:00+07:00');
  const m = await ingest(ctx, road({ externalId: 'meet', type: 'meeting', title: 'ประชุมหมู่บ้าน', body: 'ประชุมประจำเดือน', location: 'ศาลาหมู่บ้าน', effectiveFrom: '2026-10-10T09:00:00+07:00', remindOffsetsMin: [4320, 120] }), head);
  const id = (m as { announcement: { id: string } }).announcement.id;
  await publish(ctx, id, head);
  await runScheduler(ctx);

  ctx = ctxAt(repo, '2026-10-07T09:05:00+07:00');
  assert.equal((await runScheduler(ctx)).reminders, 1);
  assert.equal((await runScheduler(ctx)).reminders, 0, 'รันซ้ำต้องไม่เตือนซ้ำ');
  ctx = ctxAt(repo, '2026-10-10T07:30:00+07:00');
  assert.equal((await runScheduler(ctx)).reminders, 1);
});
