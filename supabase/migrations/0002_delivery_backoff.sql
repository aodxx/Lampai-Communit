-- Phase 2: จำกัดการลองส่งซ้ำด้วย exponential backoff
alter table public.deliveries
  add column if not exists next_attempt_at timestamptz;

create index if not exists deliveries_retry_ready
  on public.deliveries (community_id, next_attempt_at)
  where status = 'queued' and next_attempt_at is not null;
