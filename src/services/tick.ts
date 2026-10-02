import { timingSafeEqual } from 'node:crypto';
import type { QuotaProvider } from '../adapters/lineQuota.ts';
import { ageHours } from '../engine/freshness.ts';
import { bangkokParts } from '../engine/thai.ts';
import { weatherFetchJob } from '../jobs/weatherFetch.ts';
import { withJobRun } from '../jobs/run.ts';
import { runScheduler, type Ctx } from './announcements.ts';
import { runBriefing } from './briefing.ts';
import { dispatch, type Sender } from './delivery.ts';

/** Briefing เช้าเริ่มทำได้ตั้งแต่ 06:30 (เวลาไทย) และ "ตามทัน" ได้จนถึงเที่ยง ถ้า cron รอบ 06:30 มาช้าหรือถูกข้าม */
export const BRIEFING_START_MIN = 6 * 60 + 30;
export const BRIEFING_CUTOFF_MIN = 12 * 60;
/** อากาศเก่ากว่านี้ให้ดึงใหม่เอง ไม่รอ cron 3 ชม. (ต้อง < TTL 3 ชม. ใน freshness.ts) */
export const WEATHER_REFRESH_HOURS = 2;
const WEATHER_FETCH_TIMEOUT_MS = 6_000;

export function morningBriefingDue(now: Date): boolean {
  const p = bangkokParts(now);
  const m = p.hour * 60 + p.minute;
  return m >= BRIEFING_START_MIN && m < BRIEFING_CUTOFF_MIN;
}

export interface TickDeps {
  sender: Sender | null;
  quota?: QuotaProvider;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
}

export interface TickResult {
  scheduler: { transitioned: number; reminders: number } | null;
  weather: 'fetched' | 'fresh' | 'failed';
  briefing: 'done' | 'already_done' | 'not_due' | 'dry_run' | 'failed';
  dispatch: { sent: number; failed: number; queued: number } | 'skipped';
  errors: string[];
}

/**
 * งานตามเวลา "ครบชุดในรอบเดียว" ที่ทนต่อ cron ที่มาช้า/ถูกข้าม:
 * ทุกขั้นเป็น catch-up ที่ idempotent — ใครเรียกก่อน (GitHub Actions, cron ภายนอก, pg_cron) ก็ได้ผลเท่ากัน
 * แต่ละขั้นแยก error จากกัน: อากาศล่มต้องไม่ทำให้การส่งข้อความค้าง
 */
export async function runTick(ctx: Ctx, deps: TickDeps): Promise<TickResult> {
  const { repo, communityId, now } = ctx;
  const out: TickResult = { scheduler: null, weather: 'fresh', briefing: 'not_due', dispatch: 'skipped', errors: [] };
  const note = (step: string, e: unknown) => out.errors.push(`${step}: ${e instanceof Error ? e.message : String(e)}`);

  try {
    out.scheduler = await withJobRun(repo, communityId, 'scheduler', now, async () => runScheduler(ctx));
  } catch (e) {
    note('scheduler', e);
  }

  try {
    const latest = await repo.latestWeather(communityId);
    if (!latest || ageHours(latest.fetchedAt, now) >= WEATHER_REFRESH_HOURS) {
      const limited: typeof fetch = (input, init) => (deps.fetchImpl ?? fetch)(input, { ...init, signal: AbortSignal.timeout(WEATHER_FETCH_TIMEOUT_MS) });
      await withJobRun(repo, communityId, 'weather', now, async () => weatherFetchJob(ctx, undefined, limited));
      out.weather = 'fetched';
    }
  } catch (e) {
    out.weather = 'failed';
    note('weather', e);
  }

  if (morningBriefingDue(now)) {
    try {
      const r = await runBriefing(ctx, { slot: 'morning', dryRun: deps.dryRun });
      out.briefing = r.status;
      if (r.status === 'done') {
        // บันทึก job_runs เฉพาะรอบที่ทำจริง (ไม่ใช่ทุก tick ที่พบว่าทำไปแล้ว) เพื่อให้ healthcheck เห็น "briefing รันวันละครั้ง"
        const run = await repo.startJob(communityId, 'briefing', now.toISOString());
        await repo.finishJob(run, 'ok', { decision: r.briefing.decision, queued: r.queued, via: 'tick' });
      }
    } catch (e) {
      out.briefing = 'failed';
      note('briefing', e);
    }
  }

  if (!deps.dryRun && deps.sender) {
    try {
      const s = await withJobRun(repo, communityId, 'dispatch', now, async () => ({ ...(await dispatch(repo, deps.sender!, communityId, now, { quota: deps.quota })) }));
      out.dispatch = { sent: s.sent, failed: s.failed, queued: (await repo.listDispatchable(communityId)).length };
    } catch (e) {
      note('dispatch', e);
    }
  }
  return out;
}

/** ตรวจ Bearer secret ของ endpoint ตั้งเวลาภายนอก (เทียบแบบ constant-time) */
export function checkCronAuth(authorization: string | undefined, secret: string | undefined): 'ok' | 'disabled' | 'unauthorized' {
  if (!secret || secret.length < 16) return 'disabled'; // ยังไม่ตั้ง/สั้นเกินไป = ปิด endpoint ไว้ ดีกว่าเปิดโล่ง
  const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'unauthorized';
}
