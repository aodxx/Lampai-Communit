import type { Repo } from '../repo/types.ts';

/** ห่อทุก job: บันทึก job_runs เริ่ม/จบ/สถิติ/ข้อผิดพลาด (NFR-003, 006) แล้วโยน error ต่อเพื่อให้ workflow ล้มและแจ้งเตือน */
export async function withJobRun<T extends Record<string, unknown>>(repo: Repo, communityId: string, job: string, now: Date, fn: () => Promise<T>): Promise<T> {
  const run = await repo.startJob(communityId, job, now.toISOString());
  try {
    const stats = await fn();
    await repo.finishJob(run, 'ok', stats);
    return stats;
  } catch (e) {
    await repo.finishJob(run, 'error', {}, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
