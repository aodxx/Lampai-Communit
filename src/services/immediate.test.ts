import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo } from '../repo/memory.ts';
import { ingest, type Ctx } from './announcements.ts';
import { dispatch, type Sender } from './delivery.ts';
import { flushCritical, ingestAndFlush, publishAndFlush, resolveAndFlush } from './publishFlow.ts';
import { checkCronAuth, morningBriefingDue, runTick } from './tick.ts';
import type { IncomingItem } from '../engine/types.ts';

const C = 'c1';
const head = { id: 'head', role: 'village_head' as const };
const ctxAt = (repo: MemoryRepo, iso: string): Ctx => ({ repo, communityId: C, now: new Date(iso) });

class FakeSender implements Sender {
  sent: { text: string; key: string }[] = [];
  failNext = 0;
  hang = false;
  async send(text: string, key: string) {
    if (this.hang) return new Promise<never>(() => undefined);
    if (this.failNext > 0) { this.failNext--; return { ok: false, status: 500, error: 'boom' }; }
    this.sent.push({ text, key });
    return { ok: true, status: 200 };
  }
}

const item = (over: Partial<IncomingItem> = {}): IncomingItem => ({
  sourceId: 'manual', externalId: 'e1', type: 'notice', title: 'น้ำท่วมฉับพลันบริเวณคลอง', body: 'ให้ย้ายของขึ้นที่สูงทันที', ...over,
});

async function draft(repo: MemoryRepo, iso: string, over: Partial<IncomingItem> = {}) {
  const r = await ingest(ctxAt(repo, iso), item(over), head);
  return (r as { announcement: { id: string } }).announcement.id;
}

test('publish CRITICAL ผ่าน Admin flow → ส่ง LINE ทันทีในคำขอเดียว ไม่รอ cron', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const ctx = ctxAt(repo, '2026-10-03T14:00:00+07:00');
  const id = await draft(repo, '2026-10-03T14:00:00+07:00');

  const r = await publishAndFlush(ctx, id, head, sender);
  assert.equal(r.announcement.priority, 'critical');
  assert.deepEqual(r.delivery, { configured: true, sent: 1, failed: 0, timedOut: false, error: null });
  assert.equal(sender.sent.length, 1);
  assert.match(sender.sent[0]!.text, /ประกาศด่วน/);
  assert.equal(repo.deliveries[0]!.status, 'sent');
  assert.equal(sender.sent[0]!.key, repo.deliveries[0]!.id, 'X-Line-Retry-Key ต้องเป็น delivery id');
});

test('publish เรื่องไม่ด่วน → ไม่ส่งทันที (รอ Briefing) และ delivery = null', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const ctx = ctxAt(repo, '2026-10-03T14:00:00+07:00');
  const id = await draft(repo, '2026-10-03T14:00:00+07:00', { externalId: 'e2', type: 'event', title: 'งานทำบุญหมู่บ้าน', body: 'เชิญร่วมงาน' });
  const r = await publishAndFlush(ctx, id, head, sender);
  assert.equal(r.delivery, null);
  assert.equal(sender.sent.length, 0);
  assert.equal(repo.deliveries.length, 0);
});

test('CRITICAL ส่งทันทีแม้กลางคืน (ข้าม quiet hours)', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const ctx = ctxAt(repo, '2026-10-03T23:30:00+07:00');
  const id = await draft(repo, '2026-10-03T23:30:00+07:00');
  const r = await publishAndFlush(ctx, id, head, sender);
  assert.equal(r.delivery?.sent, 1);
});

test('ไม่ได้ตั้งค่า LINE → ประกาศยังเผยแพร่ได้ ข้อความอยู่ในคิว และบอกผู้ดูแลชัดเจน', async () => {
  const repo = new MemoryRepo();
  const ctx = ctxAt(repo, '2026-10-03T14:00:00+07:00');
  const id = await draft(repo, '2026-10-03T14:00:00+07:00');
  const r = await publishAndFlush(ctx, id, head, null);
  assert.equal(r.announcement.status, 'published');
  assert.equal(r.delivery?.configured, false);
  assert.equal(repo.deliveries[0]!.status, 'queued');
});

test('LINE ล้มตอนส่งทันที → ไม่ทำให้ publish ล้ม, รายการอยู่ในคิวพร้อม backoff แล้ว tick ส่งต่อได้', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  sender.failNext = 1;
  const ctx = ctxAt(repo, '2026-10-03T14:00:00+07:00');
  const id = await draft(repo, '2026-10-03T14:00:00+07:00');

  const r = await publishAndFlush(ctx, id, head, sender);
  assert.equal(r.announcement.status, 'published');
  assert.equal(r.delivery?.sent, 0);
  const d = repo.deliveries[0]!;
  assert.equal(d.status, 'queued');
  assert.equal(d.attemptCount, 1);
  assert.ok(d.nextAttemptAt && Date.parse(d.nextAttemptAt) > ctx.now.getTime());

  // tick รอบถัดไป (หลังพ้น backoff 1 นาที) ส่งสำเร็จ
  const later = new Date(ctx.now.getTime() + 61_000);
  const s = await dispatch(repo, sender, C, later);
  assert.equal(s.sent, 1);
  assert.equal(repo.deliveries[0]!.status, 'sent');
});

test('flushCritical: timeout สั้น → timedOut=true และรายการถูกจอง (tick ไม่ส่งซ้ำซ้อนทันที)', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const ctx = ctxAt(repo, '2026-10-03T14:00:00+07:00');
  const id = await draft(repo, '2026-10-03T14:00:00+07:00');
  // publish แบบไม่ส่ง เพื่อให้มีของในคิว
  await publishAndFlush(ctx, id, head, null);
  sender.hang = true;

  const r = await flushCritical(ctx, sender, { timeoutMs: 30 });
  assert.equal(r.timedOut, true);

  // ระหว่างที่ถูกจอง (lease) tick อีกตัวต้องไม่หยิบรายการเดียวกันไปส่งซ้ำ
  sender.hang = false;
  const concurrent = await dispatch(repo, sender, C, new Date(ctx.now.getTime() + 5_000));
  assert.equal(concurrent.sent, 0);
  assert.equal(sender.sent.length, 0);

  // lease หมดอายุ (process ที่ค้างตายไปแล้ว) → ส่งต่อด้วย retry key เดิม
  const after = await dispatch(repo, sender, C, new Date(ctx.now.getTime() + 120_000));
  assert.equal(after.sent, 1);
  assert.equal(sender.sent[0]!.key, repo.deliveries[0]!.id);
});

test('ส่งพร้อมกันสองทาง (flush + tick) → ส่งออกครั้งเดียว', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const ctx = ctxAt(repo, '2026-10-03T14:00:00+07:00');
  const id = await draft(repo, '2026-10-03T14:00:00+07:00');
  await publishAndFlush(ctx, id, head, null);
  const [a, b] = await Promise.all([dispatch(repo, sender, C, ctx.now), dispatch(repo, sender, C, ctx.now)]);
  assert.equal(a.sent + b.sent, 1);
  assert.equal(sender.sent.length, 1);
});

test('resolve เรื่อง CRITICAL → ส่ง "สิ้นสุดแล้ว" ทันที', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  let ctx = ctxAt(repo, '2026-10-03T10:00:00+07:00');
  const id = await draft(repo, '2026-10-03T10:00:00+07:00');
  await publishAndFlush(ctx, id, head, sender);
  ctx = ctxAt(repo, '2026-10-03T16:00:00+07:00');
  const r = await resolveAndFlush(ctx, id, 'น้ำลดแล้ว กลับบ้านได้', head, sender);
  assert.equal(r.delivery?.sent, 1);
  assert.match(sender.sent[1]!.text, /สิ้นสุดแล้ว.*น้ำลดแล้ว/);
});

test('แก้ประกาศ CRITICAL ที่เผยแพร่แล้ว (เวลา/สถานที่เปลี่ยน) → ส่งอัปเดตทันที', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const ctx = ctxAt(repo, '2026-10-03T10:00:00+07:00');
  const id = await draft(repo, '2026-10-03T10:00:00+07:00', { location: 'คลองสายเหนือ' });
  await publishAndFlush(ctx, id, head, sender);
  const r = await ingestAndFlush(ctx, item({ location: 'คลองสายใต้' }), head, sender);
  assert.equal(r.result, 'updated');
  assert.equal(r.delivery?.sent, 1);
  assert.equal(sender.sent.length, 2);
});

// ───────── tick: catch-up เมื่อ cron มาช้า ─────────
test('morningBriefingDue: 06:30–11:59 เวลาไทยเท่านั้น', () => {
  assert.equal(morningBriefingDue(new Date('2026-10-03T06:29:00+07:00')), false);
  assert.equal(morningBriefingDue(new Date('2026-10-03T06:30:00+07:00')), true);
  assert.equal(morningBriefingDue(new Date('2026-10-03T11:59:00+07:00')), true);
  assert.equal(morningBriefingDue(new Date('2026-10-03T12:00:00+07:00')), false);
});

const okWeather = (): typeof fetch =>
  (async () => new Response(JSON.stringify({
    current: { time: '2026-10-03T08:00', temperature_2m: 28, relative_humidity_2m: 80, precipitation: 0, weather_code: 1, wind_speed_10m: 5 },
    daily: { precipitation_probability_max: [20] },
  }), { status: 200 })) as unknown as typeof fetch;

test('tick: cron 06:30 ถูกข้าม แต่ tick ถัดมา (08:10) ทำ Briefing ให้ทัน และไม่ทำซ้ำรอบถัดไป', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  // มีเรื่องรอแจ้ง (ไม่ด่วน)
  const pubCtx = ctxAt(repo, '2026-10-02T15:00:00+07:00');
  const id = await draft(repo, '2026-10-02T15:00:00+07:00', { externalId: 'm1', type: 'meeting', title: 'ประชุมหมู่บ้าน', body: 'ประชุมประจำเดือน', effectiveFrom: '2026-10-10T09:00:00+07:00' });
  await publishAndFlush(pubCtx, id, head, sender);

  const r1 = await runTick(ctxAt(repo, '2026-10-03T08:10:00+07:00'), { sender, fetchImpl: okWeather() });
  assert.deepEqual(r1.errors, []);
  assert.equal(r1.briefing, 'done');
  assert.equal(r1.weather, 'fetched');
  assert.equal(sender.sent.length, 1);
  assert.match(sender.sent[0]!.text, /ประชุมหมู่บ้าน/);

  const r2 = await runTick(ctxAt(repo, '2026-10-03T08:15:00+07:00'), { sender, fetchImpl: okWeather() });
  assert.equal(r2.briefing, 'already_done');
  assert.equal(r2.weather, 'fresh');
  assert.equal(sender.sent.length, 1, 'ห้ามส่ง Briefing ซ้ำ');
  assert.equal(repo.jobs.filter((j) => j.run.job === 'briefing').length, 1, 'บันทึก job briefing เฉพาะรอบที่ทำจริง');
});

test('tick: ก่อน 06:30 ไม่ทำ Briefing', async () => {
  const repo = new MemoryRepo();
  const r = await runTick(ctxAt(repo, '2026-10-03T05:00:00+07:00'), { sender: new FakeSender(), fetchImpl: okWeather() });
  assert.equal(r.briefing, 'not_due');
});

test('tick: อากาศล่มต้องไม่ทำให้การส่งคิวค้าง (แยก error ต่อขั้น)', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const ctx = ctxAt(repo, '2026-10-03T14:00:00+07:00');
  const id = await draft(repo, '2026-10-03T14:00:00+07:00');
  await publishAndFlush(ctx, id, head, null); // ค้างในคิว
  const broken = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const r = await runTick(ctx, { sender, fetchImpl: broken });
  assert.equal(r.weather, 'failed');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!, /weather/);
  assert.equal(sender.sent.length, 1, 'ข้อความที่ค้างต้องถูกส่งแม้อากาศล้ม');
});

test('tick --dry-run: ไม่ส่งจริง ไม่บันทึก Briefing', async () => {
  const repo = new MemoryRepo();
  const sender = new FakeSender();
  const r = await runTick(ctxAt(repo, '2026-10-03T08:10:00+07:00'), { sender, fetchImpl: okWeather(), dryRun: true });
  assert.equal(r.briefing, 'dry_run');
  assert.equal(r.dispatch, 'skipped');
  assert.equal(repo.briefings.length, 0);
});

// ───────── cron auth ─────────
test('checkCronAuth: ไม่ตั้ง/สั้นเกินไป = ปิด, ผิด = ปฏิเสธ, ถูก = ผ่าน', () => {
  const secret = 'a-long-enough-secret-123';
  assert.equal(checkCronAuth('Bearer x', undefined), 'disabled');
  assert.equal(checkCronAuth('Bearer short', 'short'), 'disabled');
  assert.equal(checkCronAuth(undefined, secret), 'unauthorized');
  assert.equal(checkCronAuth('Bearer wrong-secret-of-same-len', secret), 'unauthorized');
  assert.equal(checkCronAuth(secret, secret), 'unauthorized'); // ต้องมีคำนำหน้า Bearer
  assert.equal(checkCronAuth(`Bearer ${secret}`, secret), 'ok');
});
