import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ingest, publish, resolve, type Ctx } from '../services/announcements.ts';
import type { Actor, AnnouncementType, DataLevel, IncomingItem, Priority, Role } from '../engine/types.ts';
import type { Repo } from '../repo/types.ts';
import { MemoryRepo } from '../repo/memory.ts';
import { SupabaseRepo } from '../repo/supabase.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../admin');
const PORT = Number(process.env.PORT ?? 4173);
const COMMUNITY_ID = process.env.COMMUNITY_ID ?? '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = process.env.MANUAL_SOURCE_ID ?? '22222222-2222-4222-8222-222222222222';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && COMMUNITY_ID);
const demoMode = process.env.ADMIN_DEMO === 'true' || (!configured && process.env.NODE_ENV !== 'production');
const roleOrder: Role[] = ['admin', 'village_head', 'assistant', 'editor', 'health_volunteer', 'viewer'];
const allowedCreate: Role[] = ['admin', 'village_head', 'assistant', 'editor'];
const allowedEdit: Role[] = ['admin', 'village_head', 'assistant', 'editor'];
const allowedPublish: Role[] = ['admin', 'village_head'];
const allowedResolve: Role[] = ['admin', 'village_head'];

const serviceClient: SupabaseClient | null = configured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const anonClient: SupabaseClient | null = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function demoAnnouncement(id: string, title: string, status: 'draft' | 'published', priority: Priority) {
  const now = new Date().toISOString();
  return {
    id,
    communityId: COMMUNITY_ID,
    sourceId: SOURCE_ID,
    externalId: id,
    sourceKeys: [`${SOURCE_ID}:${id}`],
    fingerprint: `demo-${id}`,
    type: 'notice' as const,
    title,
    body: status === 'draft' ? 'ร่างประกาศตัวอย่างสำหรับทดลองใช้งาน Admin PWA' : 'ประกาศตัวอย่างที่เผยแพร่แล้วในโหมดสาธิต',
    location: 'ศาลาหมู่บ้านลำพาย',
    status,
    priority,
    dataLevel: 'public' as const,
    effectiveFrom: null,
    effectiveTo: null,
    remindOffsetsMin: [],
    remindersSent: [],
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
}

async function createRepo(): Promise<Repo> {
  if (!demoMode) return new SupabaseRepo(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const repo = new MemoryRepo();
  await repo.insertAnnouncement(demoAnnouncement('demo-draft-1', 'ประชุมคณะกรรมการหมู่บ้าน', 'draft', 'important'));
  await repo.insertAnnouncement(demoAnnouncement('demo-published-1', 'แจ้งกำหนดการตัดหญ้าส่วนกลาง', 'published', 'normal'));
  return repo;
}
const repoPromise = createRepo();

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function fail(res: ServerResponse, status: number, message: string) { json(res, status, { error: message }); }
function nowCtx(repo: Repo): Ctx { return { repo, communityId: COMMUNITY_ID, now: new Date() }; }

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error('ข้อมูลมีขนาดใหญ่เกินไป');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('รูปแบบ JSON ไม่ถูกต้อง');
  return value as Record<string, unknown>;
}

async function actorFrom(req: IncomingMessage): Promise<Actor> {
  if (demoMode) return { id: 'demo-admin', role: 'admin' };
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !serviceClient) throw new Error('กรุณาเข้าสู่ระบบ');
  const { data, error } = await serviceClient.auth.getUser(token);
  if (error || !data.user) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const roles = await serviceClient.from('user_roles').select('role').eq('user_id', data.user.id).eq('community_id', COMMUNITY_ID).limit(20);
  if (roles.error) throw new Error(`ตรวจสอบสิทธิ์ไม่สำเร็จ: ${roles.error.message}`);
  const role = (roles.data ?? []).map((row) => row.role as Role).sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b))[0];
  if (!role) throw new Error('บัญชีนี้ยังไม่มีสิทธิ์ในชุมชน');
  return { id: data.user.id, role };
}

function requireRole(actor: Actor, roles: Role[]) {
  if (!roles.includes(actor.role)) throw new Error(`บทบาท ${actor.role} ไม่มีสิทธิ์ทำรายการนี้`);
}
function text(value: unknown, fallback = '') { return typeof value === 'string' ? value.trim() : fallback; }
function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}
function isoOrNull(value: unknown) {
  const v = text(value);
  if (!v) return null;
  if (Number.isNaN(Date.parse(v))) throw new Error('รูปแบบวันเวลาไม่ถูกต้อง');
  return new Date(v).toISOString();
}
function announcementInput(body: Record<string, unknown>, externalId?: string): IncomingItem {
  const title = text(body.title);
  if (!title) throw new Error('กรุณาระบุหัวข้อประกาศ');
  return {
    sourceId: SOURCE_ID,
    externalId: externalId ?? crypto.randomUUID(),
    type: oneOf(body.type, ['notice', 'meeting', 'event', 'news', 'road', 'utility', 'health', 'official'] as const, 'notice') as AnnouncementType,
    title,
    body: text(body.body),
    location: text(body.location) || null,
    effectiveFrom: isoOrNull(body.effectiveFrom),
    effectiveTo: isoOrNull(body.effectiveTo),
    priority: oneOf(body.priority, ['critical', 'important', 'normal', 'info'] as const, 'normal') as Priority,
    dataLevel: oneOf(body.dataLevel, ['public', 'internal', 'sensitive'] as const, 'public') as DataLevel,
    remindOffsetsMin: Array.isArray(body.remindOffsetsMin) ? body.remindOffsetsMin.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0) : [],
  };
}

async function dashboard(repo: Repo) {
  const [announcements, deliveries, jobs, weather] = await Promise.all([
    repo.listNonArchived(COMMUNITY_ID),
    repo.listDeliveries(COMMUNITY_ID, 50),
    repo.recentJobRuns(COMMUNITY_ID, new Date(Date.now() - 7 * 86400000).toISOString()),
    repo.latestWeather(COMMUNITY_ID),
  ]);
  return {
    counts: {
      total: announcements.length,
      draft: announcements.filter((a) => a.status === 'draft').length,
      active: announcements.filter((a) => ['published', 'active', 'updated'].includes(a.status)).length,
      queued: deliveries.filter((d) => d.status === 'queued').length,
      failed: deliveries.filter((d) => d.status === 'failed').length,
    },
    announcements: announcements.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8),
    deliveries: deliveries.map(({ payload: _payload, ...safe }) => safe).slice(0, 8),
    jobs: jobs.slice(0, 8),
    weather,
  };
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const repo = await repoPromise;
  if (path === '/api/auth/config' && req.method === 'GET') return json(res, 200, { demo: demoMode, communityId: COMMUNITY_ID });
  if (path === '/api/auth/login' && req.method === 'POST') {
    if (demoMode) return json(res, 200, { demo: true, accessToken: 'demo' });
    if (!anonClient) return fail(res, 503, 'ยังไม่ได้ตั้ง SUPABASE_ANON_KEY');
    const body = await readJson(req);
    const email = text(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return fail(res, 400, 'กรุณากรอกอีเมลและรหัสผ่าน');
    const result = await anonClient.auth.signInWithPassword({ email, password });
    if (result.error || !result.data.session) return fail(res, 401, result.error?.message ?? 'เข้าสู่ระบบไม่สำเร็จ');
    return json(res, 200, { demo: false, accessToken: result.data.session.access_token, refreshToken: result.data.session.refresh_token });
  }

  let actor: Actor;
  try { actor = await actorFrom(req); } catch (error) { return fail(res, 401, errorMessage(error)); }
  try {
    if (path === '/api/me' && req.method === 'GET') return json(res, 200, { actor, demo: demoMode, communityId: COMMUNITY_ID });
    if (path === '/api/dashboard' && req.method === 'GET') return json(res, 200, await dashboard(repo));
    if (path === '/api/announcements' && req.method === 'GET') return json(res, 200, { announcements: await repo.listNonArchived(COMMUNITY_ID) });
    if (path === '/api/deliveries' && req.method === 'GET') {
      requireRole(actor, ['admin', 'village_head', 'assistant']);
      const deliveries = await repo.listDeliveries(COMMUNITY_ID, 100);
      return json(res, 200, { deliveries: deliveries.map(({ payload: _payload, ...safe }) => safe) });
    }
    if (path === '/api/jobs' && req.method === 'GET') {
      requireRole(actor, ['admin', 'village_head']);
      return json(res, 200, { jobs: await repo.recentJobRuns(COMMUNITY_ID, new Date(Date.now() - 30 * 86400000).toISOString()) });
    }
    if (path === '/api/announcements' && req.method === 'POST') {
      requireRole(actor, allowedCreate);
      const result = await ingest(nowCtx(repo), announcementInput(await readJson(req)), actor);
      return json(res, 201, result);
    }
    const match = path.match(/^\/api\/announcements\/([^/]+)(?:\/(publish|resolve))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      const action = match[2];
      if (action === 'publish' && req.method === 'POST') {
        requireRole(actor, allowedPublish);
        return json(res, 200, { announcement: await publish(nowCtx(repo), id, actor) });
      }
      if (action === 'resolve' && req.method === 'POST') {
        requireRole(actor, allowedResolve);
        const body = await readJson(req);
        const summary = text(body.summary);
        if (!summary) return fail(res, 400, 'กรุณาระบุข้อความสรุปการปิดเรื่อง');
        return json(res, 200, { announcement: await resolve(nowCtx(repo), id, summary, actor) });
      }
      if (!action && req.method === 'PATCH') {
        requireRole(actor, allowedEdit);
        const current = await repo.getAnnouncement(id);
        if (!current) return fail(res, 404, 'ไม่พบประกาศ');
        if (current.status !== 'draft') return fail(res, 409, 'แก้ไขได้เฉพาะประกาศที่เป็นร่าง');
        const body = await readJson(req);
        const input = announcementInput(body, current.externalId ?? undefined);
        const patch = {
          type: input.type, title: input.title, body: input.body, location: input.location,
          priority: input.priority ?? current.priority, dataLevel: input.dataLevel ?? current.dataLevel,
          effectiveFrom: input.effectiveFrom ?? null, effectiveTo: input.effectiveTo ?? null,
          remindOffsetsMin: input.remindOffsetsMin ?? [], updatedAt: new Date().toISOString(),
        };
        await repo.patchAnnouncement(id, patch);
        await repo.audit({ communityId: COMMUNITY_ID, actor: actor.id, action: 'announcement.edit', entity: 'announcement', entityId: id, before: { title: current.title }, after: { title: patch.title } });
        return json(res, 200, { announcement: { ...current, ...patch } });
      }
    }
    return fail(res, 404, 'ไม่พบ API endpoint');
  } catch (error) {
    const message = errorMessage(error);
    const status = /สิทธิ์|บทบาท/.test(message) ? 403 : /ไม่พบ|เปลี่ยนจาก/.test(message) ? 404 : 400;
    return fail(res, status, message);
  }
}

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function staticFile(res: ServerResponse, pathname: string) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safe = normalize(requested).replace(/^\.\.(\/|\\|$)/, '');
  const file = join(ROOT, safe);
  if (!file.startsWith(ROOT) || !existsSync(file)) return fail(res, 404, 'ไม่พบไฟล์');
  res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
  res.end(readFileSync(file));
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) void api(req, res, url.pathname).catch((error) => fail(res, 500, errorMessage(error)));
  else if (req.method === 'GET') staticFile(res, url.pathname);
  else fail(res, 405, 'ไม่รองรับ HTTP method นี้');
}

if (process.env.VERCEL !== '1') {
  const server = createServer((req, res) => void handleRequest(req, res));
  server.listen(PORT, '0.0.0.0', () => console.log(`Lampai Admin PWA: http://localhost:${PORT} (${demoMode ? 'demo' : 'supabase'})`));
}
