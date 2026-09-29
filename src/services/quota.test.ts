import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo } from '../repo/memory.ts';
import { withJobRun } from '../jobs/run.ts';
import { dispatch, type Sender } from './delivery.ts';
import { runHealthcheck } from './healthcheck.ts';
import type { QuotaProvider } from '../adapters/lineQuota.ts';
import type { Delivery } from '../repo/types.ts';
import type { Priority } from '../engine/types.ts';

const C = 'c1';
const NOON = new Date('2026-09-29T12:00:00+07:00'); // นอก quiet hours
const quotaOf = (used: number, limit: number | null = 1000): QuotaProvider => ({ get: async () => ({ limit, used }) });
const brokenQuota: QuotaProvider = { get: async () => { throw new Error('LINE quota quota 401'); } };

class Sender1 implements Sender {
  sent: string[] = [];
  async send(text: string) { this.sent.push(text); return { ok: true, status: 200 }; }
}
const queued = (priority: Priority, payload: string): Delivery => ({
  id: crypto.randomUUID(), communityId: C, kind: 'announcement', channel: 'line_text', audience: 'community', announcementId: null, updateId: null, briefingId: null,
  priority, dataLevel: 'public', payload, idempotencyKey: `k:${crypto.randomUUID()}`, status: 'queued', attemptCount: 0, lastError: null, sentAt: null, createdAt: NOON.toISOString(),
});
const seed = (repo: MemoryRepo) => {
  repo.deliveries.push(queued('critical', 'ด่วน'), queued('important', 'สำคัญ'), queued('normal', 'ทั่วไป'));
};

test('dispatch: โควต้าปกติ/ใกล้หมด(80%) ส่งครบ', async () => {
  for (const used of [100, 850]) {
    const repo = new MemoryRepo(); const s = new Sender1(); seed(repo);
    const st = await dispatch(repo, s, C, NOON, { quota: quotaOf(used) });
    assert.equal(st.sent, 3);
    assert.equal(st.heldLowQuota, 0);
  }
});

test('dispatch: โควต้า ≥95% ส่งเฉพาะ CRITICAL ที่เหลือค้างคิว (ไม่หาย) และส่งต่อได้เมื่อโควต้ากลับมา', async () => {
  const repo = new MemoryRepo(); const s = new Sender1(); seed(repo);
  const st = await dispatch(repo, s, C, NOON, { quota: quotaOf(960) });
  assert.deepEqual(s.sent, ['ด่วน']);
  assert.equal(st.heldLowQuota, 2);
  assert.equal(st.quotaLevel, 'restrict');
  assert.equal(repo.deliveries.filter((d) => d.status === 'queued').length, 2);

  const later = await dispatch(repo, s, C, NOON, { quota: quotaOf(10) }); // เดือนใหม่
  assert.equal(later.sent, 2);
  assert.deepEqual(s.sent, ['ด่วน', 'สำคัญ', 'ทั่วไป']);
});

test('dispatch: โควต้าหมด ยังลองส่ง CRITICAL', async () => {
  const repo = new MemoryRepo(); const s = new Sender1(); seed(repo);
  const st = await dispatch(repo, s, C, NOON, { quota: quotaOf(1000) });
  assert.deepEqual(s.sent, ['ด่วน']);
  assert.equal(st.quotaLevel, 'exhausted');
});

test('dispatch: ตรวจโควต้าไม่ได้ = fail-open ส่งตามปกติ (ข้อความสำคัญไม่ค้างเพราะ API โควต้า)', async () => {
  const repo = new MemoryRepo(); const s = new Sender1(); seed(repo);
  const st = await dispatch(repo, s, C, NOON, { quota: brokenQuota });
  assert.equal(st.sent, 3);
  assert.equal(st.quotaLevel, 'unknown');
});

test('dispatch: คิวว่างไม่เรียก API โควต้า; ไม่ส่ง provider = พฤติกรรมเดิม', async () => {
  let calls = 0;
  const counting: QuotaProvider = { get: async () => { calls++; return { limit: 10, used: 0 }; } };
  const repo = new MemoryRepo();
  await dispatch(repo, new Sender1(), C, NOON, { quota: counting });
  assert.equal(calls, 0);
  seed(repo);
  const st = await dispatch(repo, new Sender1(), C, NOON);
  assert.equal(st.sent, 3);
  assert.equal(st.quotaLevel, 'unchecked');
});

// ── healthcheck ──
class Admin implements Sender {
  sent: string[] = [];
  async send(text: string) { this.sent.push(text); return { ok: true, status: 200 }; }
}
const at = (min: number) => new Date(NOON.getTime() + min * 60_000);
async function healthyJobs(repo: MemoryRepo, now: Date) {
  for (const j of ['weather', 'scheduler', 'dispatch', 'briefing']) await withJobRun(repo, C, j, now, async () => ({}));
}
const hc = (repo: MemoryRepo, now: Date, admin: Sender, quota?: QuotaProvider) =>
  withJobRun(repo, C, 'healthcheck', now, () => runHealthcheck({ repo, communityId: C, now }, admin, { quota }));

test('healthcheck: แจ้งผู้ดูแลเมื่อโควต้าถึง 80% ครั้งเดียว แล้วแจ้งอีกครั้งเมื่อข้ามไป 95%', async () => {
  const repo = new MemoryRepo(); const admin = new Admin();
  await healthyJobs(repo, at(-10));
  await hc(repo, NOON, admin, quotaOf(850));
  assert.equal(admin.sent.length, 1);
  assert.match(admin.sent[0]!, /โควต้า LINE ใกล้หมด/);
  assert.match(admin.sent[0]!, /850\/1,000/);

  await healthyJobs(repo, at(55));
  await hc(repo, at(60), admin, quotaOf(870)); // ยังอยู่ระดับเดิม ไม่แจ้งซ้ำ
  assert.equal(admin.sent.length, 1);

  await healthyJobs(repo, at(115));
  await hc(repo, at(120), admin, quotaOf(960));
  assert.equal(admin.sent.length, 2);
  assert.match(admin.sent[1]!, /เฉพาะ CRITICAL/);
});

test('healthcheck: โควต้าปกติ/ไม่จำกัด ไม่แจ้ง; ตรวจโควต้าไม่ได้ = แจ้งเตือนหนึ่งครั้งต่อวัน (ไม่ทำให้ job ล้ม)', async () => {
  const repo = new MemoryRepo(); const admin = new Admin();
  await healthyJobs(repo, at(-10));
  await hc(repo, NOON, admin, quotaOf(10));
  await hc(repo, at(1), admin, quotaOf(999_999, null));
  assert.equal(admin.sent.length, 0);

  await hc(repo, at(2), admin, brokenQuota);
  assert.equal(admin.sent.length, 1);
  assert.match(admin.sent[0]!, /ตรวจโควต้า LINE ไม่ได้/);
  await healthyJobs(repo, at(58));
  await hc(repo, at(60), admin, brokenQuota);
  assert.equal(admin.sent.length, 1);
});
