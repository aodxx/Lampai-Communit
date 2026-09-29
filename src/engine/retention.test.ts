import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETENTION, cutoffDays, cutoffMonths } from './retention.ts';

test('นโยบาย retention ถูกล็อกตาม PRD ข้อ 17 #10', () => {
  assert.equal(RETENTION.announcementsMonths, 24);
  assert.equal(RETENTION.audioAssetsMonths, 12);
  assert.equal(RETENTION.deliveriesDays, 90);
  assert.equal(RETENTION.weatherDays, 90);
  assert.equal(RETENTION.jobRunsDays, 90);
  assert.equal(RETENTION.auditLogs, 'indefinite');
});

test('คำนวณ cutoff แบบ UTC ได้แน่นอน', () => {
  const now = new Date('2026-09-29T00:00:00.000Z');
  assert.equal(cutoffDays(now, 90).toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(cutoffMonths(now, 24).toISOString(), '2024-09-29T00:00:00.000Z');
});
