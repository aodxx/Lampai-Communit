import { formatThaiDate, formatThaiTime } from './thai.ts';
import type { Priority } from './types.ts';

/** NFR-003: ความล้มเหลวของ job ต้องถูกบันทึกและแจ้งผู้ดูแลภายใน 1 ชม. → healthcheck รันทุกชั่วโมง */

export interface JobRunRecord {
  id: string;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  stats: Record<string, unknown>;
  error: string | null;
}

export interface DeliveryHealthRow {
  id: string;
  priority: Priority;
  status: 'queued' | 'failed';
  createdAt: string;
  attemptCount: number;
  lastError: string | null;
}

export interface ExpectedJob {
  job: string;
  /** อายุสูงสุดของการรันสำเร็จครั้งล่าสุด (นาที) */
  maxAgeMin: number;
}

export type Severity = 'critical' | 'warning';

export interface HealthIssue {
  /** คีย์คงที่ของปัญหานี้ ใช้กันแจ้งซ้ำ */
  key: string;
  severity: Severity;
  message: string;
}

// ── ค่าเกณฑ์ทั้งหมด [สมมติฐาน] แก้ที่นี่ที่เดียว ─────────────────────────────
/** cron ของ GitHub Actions อาจหน่วงได้ จึงเผื่อเวลาจากคาบปกติ */
export const DEFAULT_EXPECTED_JOBS: ExpectedJob[] = [
  { job: 'weather', maxAgeMin: 4 * 60 }, // คาบปกติ 3 ชม.
  { job: 'scheduler', maxAgeMin: 60 }, // คาบปกติ 15 นาที
  { job: 'dispatch', maxAgeMin: 60 }, // คาบปกติ 15 นาที
  { job: 'briefing', maxAgeMin: 26 * 60 }, // วันละครั้ง
];
export const LOOKBACK_HOURS = 48; // ช่วงข้อมูลที่ใช้ตรวจ (ต้อง≥ อายุสูงสุดของ job ที่คาดหวัง)
export const DEDUPE_HOURS = 24; // ช่วงที่ถือว่าปัญหาเดิมแจ้งไปแล้ว
export const ERROR_WINDOW_HOURS = 24; // job ที่ล้มเหลวภายในช่วงนี้ถึงจะรายงาน
export const STUCK_JOB_MIN = 30; // job ค้างสถานะ running นานเกินนี้ = ผิดปกติ
export const CRITICAL_QUEUED_MIN = 10; // NFR-004: critical ต้องถึง ≤ 5 นาที เตือนที่ 10
export const OTHER_QUEUED_HOURS = 12; // quiet hours ยาว 9 ชม. (21:00–06:00)
export const STALE_REALERT_HOURS = 6; // ปัญหา "job หยุดรัน" แจ้งซ้ำทุกกี่ชม. ถ้ายังไม่หาย
export const MAX_ISSUES_IN_ALERT = 10;

const MIN = 60_000;
const HOUR = 3_600_000;

const short = (s: string | null | undefined, n = 100) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** ตัดสินปัญหาจากประวัติ job และคิวการส่ง — ฟังก์ชันบริสุทธิ์ */
export function evaluateHealth(input: {
  now: Date;
  jobs: JobRunRecord[];
  deliveries: DeliveryHealthRow[];
  expected?: ExpectedJob[];
}): HealthIssue[] {
  const { now, jobs, deliveries } = input;
  const expected = input.expected ?? DEFAULT_EXPECTED_JOBS;
  const t = now.getTime();
  const issues: HealthIssue[] = [];

  // การรันแบบ dry-run (ชื่อลงท้าย :dry) ไม่นับเป็นการทำงานจริง
  const real = jobs.filter((j) => !j.job.endsWith(':dry'));

  // 1) job ล้มเหลวภายในช่วงที่กำหนด
  for (const j of real) {
    if (j.status === 'error' && t - Date.parse(j.startedAt) <= ERROR_WINDOW_HOURS * HOUR) {
      issues.push({
        key: `job_error:${j.id}`,
        severity: 'critical',
        message: `job "${j.job}" ล้มเหลวเมื่อ ${formatThaiDate(j.startedAt)} ${formatThaiTime(j.startedAt)}: ${short(j.error) || 'ไม่ทราบสาเหตุ'}`,
      });
    }
    // 2) job ค้าง
    if (j.status === 'running' && t - Date.parse(j.startedAt) > STUCK_JOB_MIN * MIN) {
      issues.push({ key: `job_stuck:${j.id}`, severity: 'warning', message: `job "${j.job}" ค้างสถานะ running เกิน ${STUCK_JOB_MIN} นาที (เริ่ม ${formatThaiTime(j.startedAt)})` });
    }
  }

  // 3) job ที่ควรรันแต่หยุดรัน (ไม่มีการรันสำเร็จภายในอายุที่กำหนด)
  for (const e of expected) {
    const okRuns = real.filter((j) => j.job === e.job && j.status === 'ok').map((j) => Date.parse(j.startedAt));
    const last = okRuns.length ? Math.max(...okRuns) : null;
    if (last === null || t - last > e.maxAgeMin * MIN) {
      const detail = last === null ? `ไม่พบการรันสำเร็จใน ${LOOKBACK_HOURS} ชม.ที่ผ่านมา` : `ไม่รันสำเร็จมา ${Math.floor((t - last) / MIN)} นาที (เกณฑ์ ${e.maxAgeMin} นาที)`;
      issues.push({ key: `job_stale:${e.job}`, severity: 'critical', message: `job "${e.job}" หยุดทำงาน: ${detail}` });
    }
  }

  // 4) คิวการส่ง
  for (const d of deliveries) {
    const ageMin = Math.floor((t - Date.parse(d.createdAt)) / MIN);
    if (d.status === 'failed') {
      issues.push({ key: `delivery_failed:${d.id}`, severity: 'critical', message: `ส่งข้อความ (${d.priority}) ไม่สำเร็จหลังลองครบ ${d.attemptCount} ครั้ง: ${short(d.lastError) || 'ไม่ทราบสาเหตุ'}` });
    } else if (d.priority === 'critical' && ageMin > CRITICAL_QUEUED_MIN) {
      issues.push({ key: `delivery_slow:${d.id}`, severity: 'critical', message: `ข้อความ CRITICAL ค้างในคิว ${ageMin} นาที (เป้าหมาย ≤ 5 นาที)` });
    } else if (d.priority !== 'critical' && ageMin > OTHER_QUEUED_HOURS * 60) {
      issues.push({ key: `delivery_slow:${d.id}`, severity: 'warning', message: `ข้อความ (${d.priority}) ค้างในคิว ${Math.floor(ageMin / 60)} ชม.` });
    }
  }

  return issues;
}

/** ดึงเวลาที่แจ้งล่าสุดของแต่ละคีย์จาก stats.alertedAt ของ healthcheck ที่ผ่านมา (เฉพาะรอบสำเร็จภายใน DEDUPE_HOURS) */
export function alertedAtFrom(runs: JobRunRecord[], now: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of runs) {
    if (r.job !== 'healthcheck' || r.status !== 'ok') continue;
    if (now.getTime() - Date.parse(r.startedAt) > DEDUPE_HOURS * HOUR) continue;
    const m = r.stats?.alertedAt;
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const ms = typeof v === 'string' ? Date.parse(v) : NaN;
      if (Number.isFinite(ms) && ms > (out.get(k) ?? 0)) out.set(k, ms);
    }
  }
  return out;
}

/** ต้องแจ้งปัญหานี้หรือไม่: ไม่เคยแจ้ง = แจ้ง; "job หยุดรัน" ที่ยังไม่แก้ = เตือนซ้ำทุก STALE_REALERT_HOURS; ที่เหลือแจ้งครั้งเดียว */
export function shouldAlert(issue: HealthIssue, alertedAt: Map<string, number>, now: Date): boolean {
  const last = alertedAt.get(issue.key);
  if (last === undefined) return true;
  return issue.key.startsWith('job_stale:') && now.getTime() - last >= STALE_REALERT_HOURS * HOUR;
}

/** ข้อความแจ้งผู้ดูแล — ไม่ใส่ payload ของประกาศ/ข้อมูลส่วนบุคคล (SEC-003) */
export function formatHealthAlert(issues: HealthIssue[], now: Date): string {
  const sorted = [...issues].sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'));
  const shown = sorted.slice(0, MAX_ISSUES_IN_ALERT);
  const lines = shown.map((i, n) => `${n + 1}. ${i.severity === 'critical' ? '🔴' : '🟡'} ${i.message}`);
  const more = sorted.length > shown.length ? `\n…และอีก ${sorted.length - shown.length} รายการ` : '';
  return `⚠️ ระบบลำพาย: พบปัญหา ${issues.length} รายการ (${formatThaiDate(now)} ${formatThaiTime(now)})\n${lines.join('\n')}${more}\n\nดูรายละเอียดที่ตาราง job_runs / GitHub Actions`;
}
