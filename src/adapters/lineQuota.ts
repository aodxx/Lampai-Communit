import type { QuotaInfo } from '../engine/quota.ts';

export interface QuotaProvider {
  get(): Promise<QuotaInfo>;
}

/** LINE Messaging API: โควต้า + ยอดที่ใช้ไปในเดือนนี้ (broadcast นับตามจำนวนผู้รับ) */
export function lineQuota(accessToken: string, fetchImpl: typeof fetch = fetch): QuotaProvider {
  const call = async (path: string) => {
    const res = await fetchImpl(`https://api.line.me/v2/bot/message/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`LINE quota ${path} ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  return {
    async get() {
      const [q, c] = await Promise.all([call('quota'), call('quota/consumption')]);
      const limit = q.type === 'limited' && typeof q.value === 'number' ? q.value : null;
      const used = typeof c.totalUsage === 'number' ? c.totalUsage : NaN;
      if (!Number.isFinite(used)) throw new Error('LINE quota: ตอบกลับไม่มี totalUsage');
      return { limit, used };
    },
  };
}
