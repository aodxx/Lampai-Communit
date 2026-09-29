import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSendUnderQuota, quotaLevel, quotaPercent } from './quota.ts';
import { lineQuota } from '../adapters/lineQuota.ts';

test('quotaLevel: เกณฑ์ 80% / 95% / 100% และแผนไม่จำกัด', () => {
  assert.equal(quotaLevel({ limit: 1000, used: 799 }), 'ok');
  assert.equal(quotaLevel({ limit: 1000, used: 800 }), 'low');
  assert.equal(quotaLevel({ limit: 1000, used: 950 }), 'restrict');
  assert.equal(quotaLevel({ limit: 1000, used: 1000 }), 'exhausted');
  assert.equal(quotaLevel({ limit: null, used: 999_999 }), 'ok');
  assert.equal(quotaPercent({ limit: 200, used: 50 }), 25);
  assert.equal(quotaPercent({ limit: null, used: 50 }), null);
});

test('canSendUnderQuota: ต่ำ/หมด → เฉพาะ CRITICAL', () => {
  for (const p of ['critical', 'important', 'normal', 'info'] as const) {
    assert.equal(canSendUnderQuota(p, 'ok'), true);
    assert.equal(canSendUnderQuota(p, 'low'), true);
  }
  assert.equal(canSendUnderQuota('critical', 'restrict'), true);
  assert.equal(canSendUnderQuota('important', 'restrict'), false);
  assert.equal(canSendUnderQuota('critical', 'exhausted'), true);
  assert.equal(canSendUnderQuota('normal', 'exhausted'), false);
});

const fakeFetch = (routes: Record<string, { status?: number; body: unknown }>): typeof fetch =>
  (async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).endsWith(k))!;
    const r = routes[key]!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;

test('lineQuota adapter: แปลงผลตอบกลับของ LINE (limited / none) และโยน error เมื่อผิดปกติ', async () => {
  const limited = lineQuota('t', fakeFetch({ '/quota': { body: { type: 'limited', value: 200 } }, '/quota/consumption': { body: { totalUsage: 150 } } }));
  assert.deepEqual(await limited.get(), { limit: 200, used: 150 });

  const none = lineQuota('t', fakeFetch({ '/quota': { body: { type: 'none' } }, '/quota/consumption': { body: { totalUsage: 10 } } }));
  assert.deepEqual(await none.get(), { limit: null, used: 10 });

  const denied = lineQuota('t', fakeFetch({ '/quota': { status: 401, body: {} }, '/quota/consumption': { body: { totalUsage: 1 } } }));
  await assert.rejects(denied.get(), /401/);

  const bad = lineQuota('t', fakeFetch({ '/quota': { body: { type: 'none' } }, '/quota/consumption': { body: {} } }));
  await assert.rejects(bad.get(), /totalUsage/);
});
