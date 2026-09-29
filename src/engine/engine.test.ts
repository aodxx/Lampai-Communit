import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideIngest } from './ingest.ts';
import { fingerprint, normalizeText, similarity } from './normalize.ts';
import { canTransition, nextStatusByTime, shouldNotifyOnTransition } from './lifecycle.ts';
import { isFresh } from './freshness.ts';
import { canSendNow, isQuietHour, suggestPriority } from './priority.ts';
import { dueReminders } from './reminders.ts';
import { composeBriefing, type BriefingChange } from './briefing.ts';
import { formatThaiDate, formatThaiTime } from './thai.ts';
import type { Announcement, IncomingItem } from './types.ts';
import type { WeatherObs } from './weather.ts';

const T0 = '2026-09-26T08:00:00+07:00';
function ann(over: Partial<Announcement> = {}): Announcement {
  const base: IncomingItem = { sourceId: 's1', externalId: 'x1', type: 'road', title: 'ถนนสายหลักปิดซ่อม', body: 'ปิดการจราจรช่วงหน้าศาลาหมู่บ้านเพื่อซ่อมผิวทาง', location: 'หน้าศาลาหมู่บ้าน', effectiveFrom: T0 };
  return {
    id: 'a1', communityId: 'c1', sourceId: 's1', externalId: 'x1', sourceKeys: ['s1:x1'],
    fingerprint: fingerprint(base), type: 'road', title: base.title, body: base.body, location: base.location ?? null,
    status: 'active', priority: 'important', dataLevel: 'public', effectiveFrom: T0, effectiveTo: null,
    remindOffsetsMin: [], remindersSent: [], closedAt: null, createdAt: T0, updatedAt: T0, lastSeenAt: T0, ...over,
  };
}
const incoming = (over: Partial<IncomingItem> = {}): IncomingItem => ({
  sourceId: 's1', externalId: 'x1', type: 'road', title: 'ถนนสายหลักปิดซ่อม',
  body: 'ปิดการจราจรช่วงหน้าศาลาหมู่บ้านเพื่อซ่อมผิวทาง', location: 'หน้าศาลาหมู่บ้าน', effectiveFrom: T0, ...over,
});

test('normalize: เลขไทย ช่องว่าง อักขระล่องหน', () => {
  assert.equal(normalizeText('  ประชุม\u200B  ๕  ต.ค. '), 'ประชุม 5 ต.ค.');
  assert.equal(similarity('ก็', 'ก็'), 1);
  assert.ok(similarity('ถนนปิดซ่อม', 'ถนนปิดซ่อมแซม') > 0.8);
  assert.ok(similarity('ประชุมหมู่บ้าน', 'ราคาปาล์ม') < 0.2);
});

test('ingest: ไม่มีเรื่องเดิม → create', () => {
  assert.equal(decideIngest(incoming(), []).action, 'create');
});

test('ingest: source+externalId เดิม เนื้อหาเดิม → unchanged (ไม่แจ้งซ้ำ)', () => {
  assert.equal(decideIngest(incoming(), [ann()]).action, 'unchanged');
});

test('ingest: แก้ถ้อยคำเล็กน้อย → cosmetic (เงียบ)', () => {
  const d = decideIngest(incoming({ body: 'ปิดการจราจรช่วงหน้าศาลาหมู่บ้านเพื่อซ่อมผิวทาง ' + '\u200B' }), [ann()]);
  assert.equal(d.action, 'cosmetic');
});

test('ingest: เวลาเริ่มเปลี่ยน → update พร้อมรายการที่เปลี่ยน', () => {
  const d = decideIngest(incoming({ effectiveFrom: '2026-09-27T08:00:00+07:00' }), [ann()]);
  assert.equal(d.action, 'update');
  if (d.action === 'update') assert.deepEqual(d.changes.map((c) => c.field), ['effectiveFrom']);
});

test('ingest: เรื่องเดียวกันจากอีกแหล่ง (fingerprint ตรง) → unchanged + addSource', () => {
  const d = decideIngest(incoming({ sourceId: 's2', externalId: 'z9' }), [ann()]);
  assert.equal(d.action, 'unchanged');
  if (d.action === 'unchanged') assert.equal(d.addSource, true);
});

test('ingest: คล้ายมากแต่ไม่ตรง → review (ไม่รวมเอง)', () => {
  const d = decideIngest(
    incoming({ sourceId: 's3', externalId: 'n1', title: 'ถนนสายหลักปิดซ่อมแซม', location: 'ใกล้ศาลา', effectiveFrom: '2026-09-27T08:00:00+07:00' }),
    [ann()],
  );
  assert.equal(d.action, 'review');
});

test('ingest: เรื่องที่ resolved แล้วเนื้อหาเปลี่ยน → review ไม่เปิดเรื่องเก่าเอง', () => {
  const d = decideIngest(incoming({ title: 'ถนนสายหลักปิดอีกครั้ง' }), [ann({ status: 'resolved', closedAt: T0 })]);
  assert.equal(d.action, 'review');
});

test('ingest: เรื่องที่ resolved แล้วเนื้อหาเดิม → unchanged (ไม่เปิดซ้ำ)', () => {
  assert.equal(decideIngest(incoming(), [ann({ status: 'resolved', closedAt: T0 })]).action, 'unchanged');
});

test('lifecycle: ตารางเปลี่ยนสถานะ', () => {
  assert.ok(canTransition('draft', 'published'));
  assert.ok(!canTransition('draft', 'resolved'));
  assert.ok(!canTransition('archived', 'active'));
  assert.ok(shouldNotifyOnTransition('draft', 'published'));
  assert.ok(!shouldNotifyOnTransition('published', 'active'));
  assert.ok(shouldNotifyOnTransition('active', 'resolved'));
  assert.ok(!shouldNotifyOnTransition('active', 'expired'));
});

test('lifecycle: เปลี่ยนตามเวลา', () => {
  const now = new Date('2026-09-29T10:00:00+07:00');
  assert.equal(nextStatusByTime({ status: 'published', effectiveFrom: T0, effectiveTo: null, closedAt: null }, now), 'active');
  assert.equal(nextStatusByTime({ status: 'published', effectiveFrom: '2026-10-05T09:00:00+07:00', effectiveTo: null, closedAt: null }, now), null);
  assert.equal(nextStatusByTime({ status: 'active', effectiveFrom: T0, effectiveTo: '2026-09-28T00:00:00+07:00', closedAt: null }, now), 'expired');
  assert.equal(nextStatusByTime({ status: 'resolved', effectiveFrom: T0, effectiveTo: null, closedAt: '2026-08-01T00:00:00+07:00' }, now), 'archived');
  assert.equal(nextStatusByTime({ status: 'resolved', effectiveFrom: T0, effectiveTo: null, closedAt: '2026-09-20T00:00:00+07:00' }, now), null);
});

test('freshness: อากาศ >3 ชม. ไม่สด', () => {
  const now = new Date('2026-09-29T09:00:00+07:00');
  assert.ok(isFresh('weather_current', '2026-09-29T07:00:00+07:00', now));
  assert.ok(!isFresh('weather_current', '2026-09-29T05:00:00+07:00', now));
  assert.ok(!isFresh('weather_current', '2026-09-29T12:00:00+07:00', now)); // อนาคตผิดปกติ
});

test('priority + quiet hours (เวลาไทย)', () => {
  assert.equal(suggestPriority({ type: 'notice', title: 'น้ำท่วมฉับพลัน', body: '' }), 'critical');
  assert.equal(suggestPriority({ type: 'meeting', title: 'ประชุม', body: '' }), 'important');
  const night = new Date('2026-09-29T22:30:00+07:00');
  const day = new Date('2026-09-29T10:00:00+07:00');
  assert.ok(isQuietHour(night) && !isQuietHour(day));
  assert.ok(!canSendNow('important', night));
  assert.ok(canSendNow('critical', night));
});

test('reminders: เตือนเฉพาะก่อนเริ่ม และไม่เตือนซ้ำ', () => {
  const a = { status: 'active' as const, effectiveFrom: '2026-10-10T09:00:00+07:00', remindOffsetsMin: [4320, 1440, 120], remindersSent: [] as number[] };
  assert.deepEqual(dueReminders(a, new Date('2026-10-05T09:00:00+07:00')), []);
  assert.deepEqual(dueReminders(a, new Date('2026-10-07T09:00:00+07:00')), [4320]);
  assert.deepEqual(dueReminders({ ...a, remindersSent: [4320] }, new Date('2026-10-07T10:00:00+07:00')), []);
  // ระบบหยุดไปนาน: เตือนครั้งเดียวด้วยเกณฑ์ใกล้สุด
  assert.deepEqual(dueReminders(a, new Date('2026-10-10T08:00:00+07:00')), [120]);
  assert.deepEqual(dueReminders(a, new Date('2026-10-10T10:00:00+07:00')), []); // เริ่มไปแล้ว
});

const now = new Date('2026-09-29T06:30:00+07:00');
const calm: WeatherObs = { communityId: 'c1', observedAt: '2026-09-29T06:00:00+07:00', temperatureC: 26, humidityPct: 80, windKmh: 8, precipitationMm: 0, precipProbability: 20, weatherCode: 1, fetchedAt: '2026-09-29T06:05:00+07:00' };
const change = (over: Partial<BriefingChange> = {}): BriefingChange => ({
  updateId: 'u1', announcementId: 'a1', kind: 'status', title: 'ประชุมหมู่บ้าน', summary: '', effectiveFrom: '2026-10-05T09:00:00+07:00',
  location: 'ศาลาหมู่บ้าน', priority: 'important', announcementStatus: 'published', ...over,
});

test('briefing: ไม่มีอะไรใหม่ + อากาศปกติ → skip (ไม่ส่งแค่เพราะถึงเวลา)', () => {
  const r = composeBriefing({ now, weather: calm, changes: [] });
  assert.equal(r.decision, 'skip_no_change');
  assert.equal(r.text, null);
});

test('briefing: มีเรื่องใหม่ → ส่ง และทุกบรรทัดมี ref', () => {
  const r = composeBriefing({ now, weather: calm, changes: [change()] });
  assert.equal(r.decision, 'send');
  assert.match(r.text!, /ประชุมหมู่บ้าน/);
  assert.match(r.text!, /5 ต\.ค\. 2569/);
  assert.match(r.text!, /09:00 น\./);
  assert.deepEqual(r.includedUpdateIds, ['u1']);
  assert.equal(r.refs.length, 1);
});

test('briefing: อากาศเกินอายุไม่ถูกนำมาเสนอเป็นปัจจุบัน', () => {
  const stale = { ...calm, observedAt: '2026-09-29T01:00:00+07:00' };
  const r = composeBriefing({ now, weather: stale, changes: [change()] });
  assert.equal(r.decision, 'send');
  assert.equal(r.weatherIncluded, false);
  assert.doesNotMatch(r.text!, /อากาศ:/);
});

test('briefing: ฝนหนักมีนัยสำคัญ → ส่งได้แม้ไม่มีข่าว', () => {
  const r = composeBriefing({ now, weather: { ...calm, precipProbability: 90, weatherCode: 82 }, changes: [] });
  assert.equal(r.decision, 'send');
  assert.match(r.text!, /ฝน/);
});

test('briefing: เรื่องที่ expired ห้ามนำมาพูด', () => {
  const r = composeBriefing({ now, weather: calm, changes: [change({ announcementStatus: 'expired' })] });
  assert.equal(r.decision, 'skip_no_change');
  assert.deepEqual(r.droppedUpdateIds, ['u1']);
});

test('briefing: จำกัด 5 เรื่อง เรียงตามความสำคัญ และบอกจำนวนที่เหลือ', () => {
  const many = Array.from({ length: 7 }, (_, i) => change({ updateId: `u${i}`, title: `เรื่อง${i}`, priority: i === 6 ? 'critical' : 'normal' }));
  const r = composeBriefing({ now, weather: null, changes: many });
  assert.equal(r.includedUpdateIds.length, 5);
  assert.equal(r.includedUpdateIds[0], 'u6');
  assert.match(r.text!, /อีก 2 เรื่อง/);
});

test('thai format: พ.ศ. และเวลาไทย', () => {
  assert.equal(formatThaiDate('2026-10-05T09:00:00+07:00'), '5 ต.ค. 2569');
  assert.equal(formatThaiTime('2026-10-05T09:00:00+07:00'), '09:00 น.');
  assert.equal(formatThaiDate('2026-09-29T20:00:00Z'), '30 ก.ย. 2569'); // 03:00 ไทยของวันถัดไป
});
