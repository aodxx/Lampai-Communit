import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertedAtFrom, evaluateHealth, formatHealthAlert, shouldAlert, STARTUP_GRACE_HOURS, type DeliveryHealthRow, type JobRunRecord } from './health.ts';

const NOW = new Date('2026-09-29T12:00:00+07:00');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

let n = 0;
const run = (job: string, minAgo: number, status: JobRunRecord['status'] = 'ok', over: Partial<JobRunRecord> = {}): JobRunRecord => ({
  id: `r${++n}`, job, startedAt: ago(minAgo), finishedAt: status === 'running' ? null : ago(minAgo), status, stats: {}, error: null, ...over,
});
const healthyJobs = (): JobRunRecord[] => [run('weather', 30), run('scheduler', 5), run('dispatch', 5), run('briefing', 6 * 60)];
const del = (over: Partial<DeliveryHealthRow> = {}): DeliveryHealthRow => ({ id: `d${++n}`, priority: 'important', status: 'queued', createdAt: ago(1), attemptCount: 0, lastError: null, ...over });

test('ระบบปกติ: ไม่มีปัญหา', () => {
  assert.deepEqual(evaluateHealth({ now: NOW, jobs: healthyJobs(), deliveries: [del()] }), []);
});

test('job ล้มเหลว: รายงานพร้อมสาเหตุ (ตัดให้สั้น) และคีย์คงที่ตาม run id', () => {
  const bad = run('weather', 10, 'error', { error: 'x'.repeat(500) });
  const issues = evaluateHealth({ now: NOW, jobs: [...healthyJobs(), bad], deliveries: [] });
  const i = issues.find((x) => x.key === `job_error:${bad.id}`);
  assert.ok(i);
  assert.equal(i.severity, 'critical');
  assert.ok(i.message.length < 250);
});

test('job ล้มเหลวเก่ากว่า 24 ชม. ไม่รายงานอีก', () => {
  const old = run('weather', 25 * 60, 'error', { error: 'old' });
  const issues = evaluateHealth({ now: NOW, jobs: [...healthyJobs(), old], deliveries: [] });
  assert.equal(issues.some((x) => x.key.startsWith('job_error')), false);
});

test('job หยุดรัน: ไม่มีการรันสำเร็จเกินเกณฑ์ → แจ้ง; ไม่เคยรัน → แจ้ง', () => {
  const stale = [run('weather', 5 * 60), run('scheduler', 5), run('dispatch', 5), run('briefing', 6 * 60)];
  const a = evaluateHealth({ now: NOW, jobs: stale, deliveries: [] });
  assert.equal(a.length, 1);
  assert.match(a[0]!.message, /weather/);

  const none = evaluateHealth({ now: NOW, jobs: [run('scheduler', STARTUP_GRACE_HOURS * 60 + 5), run('dispatch', STARTUP_GRACE_HOURS * 60 + 5), run('weather', STARTUP_GRACE_HOURS * 60 + 5)], deliveries: [] });
  assert.ok(none.some((x) => /briefing/.test(x.message) && /ไม่พบ/.test(x.message)));
});

test('รันล้มเหลวแต่ยังมีรันสำเร็จล่าสุดในเกณฑ์: ไม่ถือว่าหยุดรัน (แต่ยังรายงาน error หนึ่งครั้ง)', () => {
  const jobs = [...healthyJobs(), run('weather', 5, 'error', { error: 'timeout' })];
  const issues = evaluateHealth({ now: NOW, jobs, deliveries: [] });
  assert.equal(issues.some((x) => x.key.startsWith('job_stale')), false);
  assert.equal(issues.filter((x) => x.key.startsWith('job_error')).length, 1);
});

test('dry-run ไม่นับเป็นการทำงานจริง', () => {
  const jobs = [run('weather:dry', 5), run('scheduler', STARTUP_GRACE_HOURS * 60 + 5), run('dispatch', STARTUP_GRACE_HOURS * 60 + 5), run('briefing', 60)];
  const issues = evaluateHealth({ now: NOW, jobs, deliveries: [] });
  assert.ok(issues.some((x) => x.key.startsWith('job_stale:weather')));
});

test('startup grace period: job ที่ยังไม่เคยสำเร็จไม่แจ้งเตือนในช่วงเริ่มระบบ', () => {
  const jobs = [run('scheduler', 5), run('dispatch', 5)];
  const issues = evaluateHealth({ now: NOW, jobs, deliveries: [] });
  assert.equal(issues.some((x) => x.key.startsWith('job_stale:')), false);
});

test('พ้น startup grace period แล้ว job ที่ยังไม่เคยสำเร็จต้องแจ้งเตือน', () => {
  const jobs = [run('scheduler', STARTUP_GRACE_HOURS * 60 + 5), run('dispatch', STARTUP_GRACE_HOURS * 60 + 5)];
  const issues = evaluateHealth({ now: NOW, jobs, deliveries: [] });
  assert.ok(issues.some((x) => /weather/.test(x.message) && x.key.startsWith('job_stale:')));
});

test('job ค้างสถานะ running เกิน 30 นาที', () => {
  const stuck = run('dispatch', 45, 'running');
  const fine = run('scheduler', 3, 'running');
  const issues = evaluateHealth({ now: NOW, jobs: [...healthyJobs(), stuck, fine], deliveries: [] });
  assert.ok(issues.some((x) => x.key === `job_stuck:${stuck.id}`));
  assert.equal(issues.some((x) => x.key === `job_stuck:${fine.id}`), false);
});

test('คิวส่ง: critical ค้าง >10 นาที แจ้ง, important ค้างข้ามคืนปกติไม่แจ้ง, ค้าง >12 ชม. แจ้ง, failed แจ้ง', () => {
  const crit = del({ priority: 'critical', createdAt: ago(15) });
  const critOk = del({ priority: 'critical', createdAt: ago(4) });
  const overnight = del({ priority: 'important', createdAt: ago(9 * 60) });
  const tooLong = del({ priority: 'normal', createdAt: ago(13 * 60) });
  const failed = del({ status: 'failed', attemptCount: 3, lastError: 'LINE 401' });
  const keys = evaluateHealth({ now: NOW, jobs: healthyJobs(), deliveries: [crit, critOk, overnight, tooLong, failed] }).map((x) => x.key);
  assert.deepEqual(keys.sort(), [`delivery_failed:${failed.id}`, `delivery_slow:${crit.id}`, `delivery_slow:${tooLong.id}`].sort());
});

test('shouldAlert: ไม่เคยแจ้ง=แจ้ง; ปัญหาทั่วไปแจ้งครั้งเดียว; job หยุดรันเตือนซ้ำเมื่อครบ 6 ชม. นับจากครั้งที่แจ้งล่าสุด', () => {
  const stale = { key: 'job_stale:weather', severity: 'critical' as const, message: 'x' };
  const err = { key: 'job_error:r1', severity: 'critical' as const, message: 'y' };
  const at = (h: number) => new Map([[stale.key, NOW.getTime() - h * 3_600_000], [err.key, NOW.getTime() - h * 3_600_000]]);
  assert.equal(shouldAlert(stale, new Map(), NOW), true);
  assert.equal(shouldAlert(stale, at(5.9), NOW), false);
  assert.equal(shouldAlert(stale, at(6), NOW), true);
  assert.equal(shouldAlert(err, at(23), NOW), false); // ไม่เตือนซ้ำ
});

test('alertedAtFrom: อ่านเฉพาะ healthcheck ที่สำเร็จ ภายใน 24 ชม. และใช้เวลาล่าสุดของแต่ละคีย์', () => {
  const runs = [
    run('healthcheck', 60, 'ok', { stats: { alertedAt: { a: ago(120), b: ago(90) } } }),
    run('healthcheck', 30, 'ok', { stats: { alertedAt: { a: ago(30) } } }),
    run('healthcheck', 60, 'error', { stats: { alertedAt: { no: ago(60) } } }),
    run('healthcheck', 25 * 60, 'ok', { stats: { alertedAt: { old: ago(25 * 60) } } }),
    run('weather', 60, 'ok', { stats: { alertedAt: { other: ago(60) } } }),
    run('healthcheck', 20, 'ok', { stats: { alertedAt: ['not-an-object'] } }),
    run('healthcheck', 10, 'ok', { stats: { alertedAt: { bad: 'not-a-date' } } }),
  ];
  const m = alertedAtFrom(runs, NOW);
  assert.deepEqual([...m.keys()].sort(), ['a', 'b']);
  assert.equal(m.get('a'), Date.parse(ago(30)));
});

test('ข้อความแจ้งเตือน: เรียง critical ก่อน, จำกัดจำนวน, ไม่มี payload ของประกาศ', () => {
  const issues = Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, severity: (i === 12 ? 'critical' : 'warning') as 'critical' | 'warning', message: `ปัญหา ${i}` }));
  const text = formatHealthAlert(issues, NOW);
  assert.match(text, /พบปัญหา 13 รายการ/);
  assert.ok(text.indexOf('ปัญหา 12') < text.indexOf('ปัญหา 0'));
  assert.match(text, /อีก 3 รายการ/);
});
