-- Lampai Community — core schema (Phase 1)
-- หลักการ: client อ่านได้ตามบทบาท (RLS) / การเขียนทั้งหมดผ่าน Community API หรือ Jobs ด้วย service role เท่านั้น
-- ข้อมูล SENSITIVE ไม่เปิดให้ admin อ่านโดยค่าเริ่มต้น (least privilege) — ดู docs/06 (จะเขียนต่อ)

create extension if not exists pgcrypto;

-- ───────── ชุมชนและผู้ใช้ ─────────
create table public.communities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  subdistrict  text,
  district     text,
  province     text,
  lat          double precision,
  lon          double precision,
  timezone     text not null default 'Asia/Bangkok',
  created_at   timestamptz not null default now()
);

create table public.user_roles (
  user_id      uuid not null references auth.users(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  role         text not null check (role in ('admin','village_head','assistant','health_volunteer','editor','viewer')),
  created_at   timestamptz not null default now(),
  primary key (user_id, community_id, role)
);

create table public.sources (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  name              text not null,
  kind              text not null check (kind in ('manual','api','feed','document')),
  tier              smallint not null default 2 check (tier between 1 and 3), -- 1 ทางการ … 3 ความน่าเชื่อถือต่ำ (ต้องมีคนตรวจ)
  url               text,
  poll_interval_min integer,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ───────── ประกาศ (ความจำหลัก) ─────────
create table public.announcements (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid not null references public.communities(id) on delete cascade,
  source_id          uuid not null references public.sources(id),
  external_id        text,
  fingerprint        text not null,
  type               text not null check (type in ('notice','meeting','event','news','road','utility','health','official')),
  title              text not null,
  body               text not null default '',
  location           text,
  status             text not null default 'draft' check (status in ('draft','published','active','updated','resolved','expired','archived')),
  priority           text not null default 'normal' check (priority in ('critical','important','normal','info')),
  data_level         text not null default 'public' check (data_level in ('public','internal','sensitive')),
  effective_from     timestamptz,
  effective_to       timestamptz,
  remind_offsets_min integer[] not null default '{}',
  reminders_sent     integer[] not null default '{}',
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index announcements_community_status on public.announcements (community_id, status);
create index announcements_fingerprint on public.announcements (community_id, fingerprint);

-- ทุกแหล่งที่ยืนยันเรื่องเดียวกัน (many-to-many) — key ต้องไม่ซ้ำทั้งระบบ
create table public.announcement_sources (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  source_id       uuid not null references public.sources(id),
  external_id     text not null,
  first_seen_at   timestamptz not null default now(),
  primary key (announcement_id, source_id, external_id),
  unique (source_id, external_id)
);

create table public.announcement_updates (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  community_id    uuid not null references public.communities(id) on delete cascade,
  kind            text not null check (kind in ('created','content','status','time','place','reminder','resolution')),
  summary         text not null default '',
  changes         jsonb not null default '[]',
  notify          boolean not null default false,
  announced_at    timestamptz,
  actor           text not null,
  created_at      timestamptz not null default now()
);
create index updates_pending on public.announcement_updates (community_id) where notify and announced_at is null;
create index updates_announcement on public.announcement_updates (announcement_id, created_at);

-- คิวให้มนุษย์ตัดสิน (dedup กำกวม / เรื่องที่จบไปแล้วเนื้อหาเปลี่ยน)
create table public.review_queue (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  reason       text not null,
  incoming     jsonb not null,
  candidate_id uuid references public.announcements(id) on delete set null,
  score        double precision not null default 0,
  status       text not null default 'open' check (status in ('open','merged','rejected','created')),
  created_at   timestamptz not null default now(),
  resolved_by  text,
  resolved_at  timestamptz
);

-- ───────── ข้อมูลอากาศ ─────────
create table public.weather_observations (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid not null references public.communities(id) on delete cascade,
  observed_at        timestamptz not null,
  temperature_c      double precision,
  humidity_pct       double precision,
  wind_kmh           double precision,
  precipitation_mm   double precision,
  precip_probability double precision,
  weather_code       integer,
  fetched_at         timestamptz not null default now(),
  unique (community_id, observed_at)
);

-- ───────── Briefing / การส่ง ─────────
create table public.briefings (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.communities(id) on delete cascade,
  idempotency_key text not null unique,
  slot            text not null,
  briefing_date   date not null,
  decision        text not null check (decision in ('send','skip_no_change')),
  reason          text not null,
  text            text,
  refs            jsonb not null default '[]',
  created_at      timestamptz not null default now()
);

create table public.deliveries (
  id              uuid primary key,  -- ใช้เป็น X-Line-Retry-Key
  community_id    uuid not null references public.communities(id) on delete cascade,
  kind            text not null check (kind in ('announcement','briefing')),
  channel         text not null check (channel in ('line_text')),
  audience        text not null default 'community',
  announcement_id uuid references public.announcements(id) on delete set null,
  update_id       uuid references public.announcement_updates(id) on delete set null,
  briefing_id     uuid references public.briefings(id) on delete set null,
  priority        text not null check (priority in ('critical','important','normal','info')),
  data_level      text not null default 'public',
  payload         text not null,
  idempotency_key text not null unique,
  status          text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempt_count   integer not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index deliveries_queued on public.deliveries (community_id, created_at) where status = 'queued';

create table public.delivery_attempts (
  id          bigint generated always as identity primary key,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  ok          boolean not null,
  http_status integer,
  error       text,
  created_at  timestamptz not null default now()
);

-- สำรองไว้สำหรับขั้นถัดไป (TTS) — ใช้ซ้ำเมื่อ hash สคริปต์เดิม
create table public.audio_assets (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  script_hash  text not null unique,
  storage_path text not null,
  duration_ms  integer,
  provider     text,
  voice        text,
  created_at   timestamptz not null default now()
);

-- ───────── งานอัตโนมัติ / Audit ─────────
create table public.job_runs (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  job          text not null,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running','ok','error')),
  stats        jsonb not null default '{}',
  error        text
);
create index job_runs_recent on public.job_runs (community_id, job, started_at desc);

create table public.audit_logs (
  id           bigint generated always as identity primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  actor        text not null,
  action       text not null,
  entity       text not null,
  entity_id    text not null,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

-- audit เป็น append-only แม้แต่ service role ก็แก้/ลบไม่ได้ (SEC-004)
create function public.audit_logs_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- ───────── สิทธิ์ (RLS) ─────────
create function public.has_role(cid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.community_id = cid and ur.role = any (roles)
  );
$$;
revoke all on function public.has_role(uuid, text[]) from public, anon;
grant execute on function public.has_role(uuid, text[]) to authenticated;

alter table public.communities          enable row level security;
alter table public.user_roles           enable row level security;
alter table public.sources              enable row level security;
alter table public.announcements        enable row level security;
alter table public.announcement_sources enable row level security;
alter table public.announcement_updates enable row level security;
alter table public.review_queue         enable row level security;
alter table public.weather_observations enable row level security;
alter table public.briefings            enable row level security;
alter table public.deliveries           enable row level security;
alter table public.delivery_attempts    enable row level security;
alter table public.audio_assets         enable row level security;
alter table public.job_runs             enable row level security;
alter table public.audit_logs           enable row level security;

-- anon ไม่มีสิทธิ์อะไรเลย; authenticated อ่านได้ตาม policy; การเขียนไม่มี policy = ปฏิเสธ (ทำผ่าน service role)
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;

create policy communities_read on public.communities for select to authenticated
  using (public.has_role(id, array['admin','village_head','assistant','health_volunteer','editor','viewer']));

create policy user_roles_own on public.user_roles for select to authenticated
  using (user_id = auth.uid());

create policy sources_staff on public.sources for select to authenticated
  using (public.has_role(community_id, array['admin','village_head','assistant','editor']));

create policy announcements_read on public.announcements for select to authenticated
  using (
    (data_level = 'public'    and public.has_role(community_id, array['admin','village_head','assistant','health_volunteer','editor','viewer']))
 or (data_level = 'internal'  and public.has_role(community_id, array['admin','village_head','assistant','editor']))
 or (data_level = 'sensitive' and public.has_role(community_id, array['village_head','health_volunteer']))
  );

-- ตารางลูกอ่านได้เท่าที่เห็นประกาศแม่ (RLS ของ announcements ทำงานภายใน subquery)
create policy announcement_updates_read on public.announcement_updates for select to authenticated
  using (exists (select 1 from public.announcements a where a.id = announcement_id));
create policy announcement_sources_read on public.announcement_sources for select to authenticated
  using (exists (select 1 from public.announcements a where a.id = announcement_id));

create policy review_queue_staff on public.review_queue for select to authenticated
  using (public.has_role(community_id, array['admin','village_head','assistant']));
create policy weather_read on public.weather_observations for select to authenticated
  using (public.has_role(community_id, array['admin','village_head','assistant','health_volunteer','editor','viewer']));
create policy briefings_staff on public.briefings for select to authenticated
  using (public.has_role(community_id, array['admin','village_head','assistant']));
create policy deliveries_staff on public.deliveries for select to authenticated
  using (public.has_role(community_id, array['admin','village_head','assistant']));
create policy delivery_attempts_staff on public.delivery_attempts for select to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id));
create policy audio_assets_staff on public.audio_assets for select to authenticated
  using (public.has_role(community_id, array['admin','village_head','assistant']));
create policy job_runs_admin on public.job_runs for select to authenticated
  using (public.has_role(community_id, array['admin','village_head']));
create policy audit_logs_admin on public.audit_logs for select to authenticated
  using (public.has_role(community_id, array['admin','village_head']));
