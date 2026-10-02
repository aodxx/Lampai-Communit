import { readFileSync } from 'node:fs';
import { lineSender } from './adapters/line.ts';
import { lineQuota } from './adapters/lineQuota.ts';
import type { Actor, IncomingItem } from './engine/types.ts';
import { weatherFetchJob } from './jobs/weatherFetch.ts';
import { withJobRun } from './jobs/run.ts';
import { SupabaseRepo } from './repo/supabase.ts';
import { runScheduler, type Ctx } from './services/announcements.ts';
import { runBriefing } from './services/briefing.ts';
import { dispatch } from './services/delivery.ts';
import { ingestAndFlush, publishAndFlush, resolveAndFlush } from './services/publishFlow.ts';
import { runTick } from './services/tick.ts';
import { DEFAULT_EXPECTED_JOBS } from './engine/health.ts';
import { runHealthcheck } from './services/healthcheck.ts';

const USAGE = `ใช้งาน: node src/cli.ts <คำสั่ง>
  job weather                     ดึงอากาศ (Open-Meteo) เก็บลงฐานข้อมูล
  job scheduler                   เปลี่ยนสถานะตามเวลา + สร้างการเตือน
  job briefing [--slot morning] [--dry-run]   ประกอบ/ตัดสินส่ง Briefing
  job tick [--dry-run]            งานตามเวลาครบชุด (scheduler + อากาศที่เก่า + Briefing ที่ถึงเวลา + ส่งคิว) ทนต่อ cron ที่มาช้า
  job dispatch [--dry-run]        ส่งคิวข้อความผ่าน LINE
  job healthcheck [--dry-run]     ตรวจ job/คิวส่ง แล้วแจ้งผู้ดูแล (ADMIN_LINE_TARGET) เมื่อพบปัญหาใหม่
  announce <file.json> [--publish]   สร้างประกาศจากไฟล์ (เป็น draft; --publish เพื่อเผยแพร่)
  publish <announcement-id>       เผยแพร่ draft
  resolve <announcement-id> "<ข้อความสรุป>"   ปิดเรื่อง`;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`ต้องตั้งค่า environment variable ${name}`);
  return v;
}

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const VALUE_FLAGS = new Set(['--slot']);
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (VALUE_FLAGS.has(a)) i++;
  else if (!a.startsWith('--')) positional.push(a);
}

function cliSender() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const target = process.env.LINE_TARGET;
  return token && target ? lineSender(token, target) : null;
}

async function main() {
  const [cmd, sub] = positional;
  if (!cmd || cmd === 'help') return console.log(USAGE);

  const repo = new SupabaseRepo(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const communityId = env('COMMUNITY_ID');
  const ctx: Ctx = { repo, communityId, now: new Date() };
  const admin: Actor = { id: 'cli', role: 'admin' }; // CLI ใช้โดยผู้ดูแลระบบเท่านั้น (ต้องถือ service-role key)

  if (cmd === 'job') {
    const stats = await withJobRun(repo, communityId, `${sub}${flag('dry-run') ? ':dry' : ''}`, ctx.now, async () => {
      switch (sub) {
        case 'weather':
          return await weatherFetchJob(ctx);
        case 'tick': {
          const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
          const target = process.env.LINE_TARGET;
          const r = await runTick(ctx, { sender: token && target ? lineSender(token, target) : null, quota: token ? lineQuota(token) : undefined, dryRun: flag('dry-run') });
          if (r.errors.length) throw new Error(r.errors.join('\n'));
          return { ...r };
        }
        case 'scheduler':
          return { ...(await runScheduler(ctx)) };
        case 'briefing': {
          const r = await runBriefing(ctx, { slot: opt('slot', 'morning'), dryRun: flag('dry-run') });
          if (r.status === 'dry_run') console.log(r.result.text ?? `(ข้าม) ${r.result.reason}`);
          return { status: r.status, decision: 'result' in r ? r.result.decision : r.briefing.decision };
        }
        case 'dispatch': {
          if (flag('dry-run')) {
            const q = await repo.listDispatchable(communityId);
            q.forEach((d) => console.log(`[${d.priority}] ${d.payload}\n---`));
            return { queued: q.length };
          }
          return { ...(await dispatch(repo, lineSender(env('LINE_CHANNEL_ACCESS_TOKEN'), env('LINE_TARGET')), communityId, ctx.now, { quota: lineQuota(env('LINE_CHANNEL_ACCESS_TOKEN')) })) };
        }
        case 'healthcheck': {
          const adminTarget = process.env.ADMIN_LINE_TARGET;
          if (adminTarget === 'broadcast') throw new Error('ADMIN_LINE_TARGET ต้องเป็น userId/groupId ของผู้ดูแล ห้ามเป็น broadcast (จะส่งถึงทั้งชุมชน)');
          const admin = adminTarget ? lineSender(env('LINE_CHANNEL_ACCESS_TOKEN'), adminTarget) : null;
          const wanted = process.env.HEALTH_EXPECTED_JOBS?.split(',').map((x) => x.trim()).filter(Boolean);
          const expected = wanted ? DEFAULT_EXPECTED_JOBS.filter((e) => wanted.includes(e.job)) : undefined;
          const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
          return await runHealthcheck(ctx, admin, { dryRun: flag('dry-run'), expected, quota: lineToken ? lineQuota(lineToken) : undefined, onText: console.log });
        }
        default:
          throw new Error(`ไม่รู้จัก job: ${sub}\n${USAGE}`);
      }
    });
    return console.log(JSON.stringify(stats));
  }

  if (cmd === 'announce') {
    const file = positional[1];
    if (!file) throw new Error('ระบุไฟล์ JSON');
    const item = JSON.parse(readFileSync(file, 'utf8')) as Partial<IncomingItem>;
    const full = { sourceId: process.env.MANUAL_SOURCE_ID ?? '', ...item } as IncomingItem;
    if (!full.sourceId) throw new Error('ต้องมี sourceId ในไฟล์ หรือตั้ง MANUAL_SOURCE_ID');
    const out = await ingestAndFlush(ctx, full, admin, cliSender());
    console.log(JSON.stringify({ result: out.result, id: 'announcement' in out ? out.announcement.id : out.reviewId }));
    if (flag('publish') && 'announcement' in out && out.result === 'created') {
      const r = await publishAndFlush(ctx, out.announcement.id, admin, cliSender());
      console.log('เผยแพร่แล้ว', JSON.stringify(r.delivery));
    }
    return;
  }
  if (cmd === 'publish' && sub) {
    const r = await publishAndFlush(ctx, sub, admin, cliSender());
    return void console.log('เผยแพร่แล้ว', JSON.stringify(r.delivery));
  }
  if (cmd === 'resolve' && sub) {
    const r = await resolveAndFlush(ctx, sub, positional[2] ?? '', admin, cliSender());
    return void console.log('ปิดเรื่องแล้ว', JSON.stringify(r.delivery));
  }

  console.log(USAGE);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
