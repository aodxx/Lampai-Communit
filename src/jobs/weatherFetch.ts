import { fetchWeather } from '../adapters/openMeteo.ts';
import type { Ctx } from '../services/announcements.ts';

/** พิกัดบ้านลำพาย [จาก PRD ฉบับ 0.1] — ภายหลังอ่านจากตาราง communities */
export const LAMPAI = { lat: 7.619729, lon: 100.005932 };

export async function weatherFetchJob(ctx: Ctx, coords = LAMPAI, fetchImpl: typeof fetch = fetch) {
  const obs = await fetchWeather(ctx.communityId, coords.lat, coords.lon, ctx.now, fetchImpl);
  const inserted = await ctx.repo.insertWeather(obs);
  return { inserted, observedAt: obs.observedAt };
}
