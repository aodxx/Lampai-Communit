# ตัวตั้งเวลาภายนอก + การส่งทันที (Priority 1)

## ทำไมต้องมี
ตรวจจริงเมื่อ 2026-10-03: cron ของ GitHub Actions ตั้ง `*/5` แต่ใน 3 วันรันตามเวลาได้แค่ 45 ครั้ง (ห่างกันเฉลี่ย ~85 นาที สูงสุด ~5 ชม.) จึงเปลี่ยนสถาปัตยกรรมดังนี้

| งาน | ก่อน | ตอนนี้ |
|---|---|---|
| ประกาศ CRITICAL | เข้าคิว แล้วรอ tick (อาจเป็นชั่วโมง) | **ส่งเข้า LINE ในคำขอ publish/resolve เลย** (`src/services/publishFlow.ts`) — ล้มเหลวไม่ทำให้ publish ล้ม รายการอยู่ในคิวและมี backoff |
| Briefing 06:30 | พึ่ง cron 23:30 UTC ครั้งเดียว | **catch-up**: tick ตัวไหนมาถึงหลัง 06:30 (ก่อนเที่ยง) ก็ทำให้ทัน; idempotent ต่อวัน/slot ไม่ส่งซ้ำ |
| อากาศ | cron ทุก 3 ชม. | tick ดึงใหม่เองเมื่อข้อมูลเก่ากว่า 2 ชม. (ก่อนถึง TTL 3 ชม.) |
| ตัวกระตุ้น tick | GitHub cron อย่างเดียว | GitHub cron **+ ตัวตั้งเวลาภายนอก** เรียก `POST /api/cron/tick` (ใครมาก่อนก็ได้ผลเท่ากัน) |

กลไกกันส่งซ้ำเมื่อหลายทางทำงานพร้อมกัน: (1) `claimDelivery` จองรายการแบบ compare-and-set (lease 90 วินาที), (2) `X-Line-Retry-Key` = delivery id (LINE ตอบ 409 ถ้ารับไปแล้ว → นับว่าสำเร็จ), (3) idempotency key ของ Briefing/Delivery

## สิ่งที่เจ้าของต้องตั้ง (ครั้งเดียว)

### 1) ตัวแปรบน Vercel (Project → Settings → Environment Variables)
| ตัวแปร | ค่า | หมายเหตุ |
|---|---|---|
| `CRON_SECRET` | สุ่มยาว ≥ 16 ตัว เช่น `openssl rand -hex 24` | ไม่ตั้ง = endpoint ปิด (503) |
| `LINE_CHANNEL_ACCESS_TOKEN` | token ของ Messaging API | **จำเป็นเพื่อให้ "ส่งทันที" ทำงานจาก Admin PWA** — ถ้าไม่ตั้ง หน้า Admin จะแจ้งว่า "ยังไม่ได้ตั้งค่า LINE ข้อความรอในคิว" |
| `LINE_TARGET` | group ID ของกลุ่มหมู่บ้าน | ห้ามใช้ `broadcast` |
| `COMMUNITY_ID`, `SUPABASE_*` | มีอยู่แล้ว | |

ห้ามตั้ง `ADMIN_DEMO=true` บน production

### 2) เลือกตัวเรียก tick อย่างน้อย 1 ตัว (แนะนำ ก. หรือทั้งสอง)

**ก. cron-job.org (ง่ายสุด ฟรี)**
- URL: `https://<โดเมน Vercel>/api/cron/tick` · Method: `POST` · ทุก 5 นาที
- Request headers: `Authorization: Bearer <CRON_SECRET>`
- เปิดแจ้งเตือนอีเมลเมื่อ job ล้มเหลวติดกัน (endpoint ตอบ 500 เมื่อมี error ในขั้นใดขั้นหนึ่ง)

**ข. Supabase `pg_cron` + `pg_net`** (รันใน SQL Editor; ⚠️ ยังไม่ได้ทดสอบบนโปรเจกต์จริง)
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<CRON_SECRET>', 'lampai_cron_secret');   -- เก็บใน Vault ไม่ฝังในคำสั่ง
select cron.schedule('lampai-tick', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<โดเมน Vercel>/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lampai_cron_secret')),
    timeout_milliseconds := 20000
  );
$$);
```
ยกเลิก: `select cron.unschedule('lampai-tick');`

GitHub Actions `jobs` ยังคงอยู่เป็นตัวสำรอง (ตอนนี้เรียก `job tick` ซึ่งทำงานชุดเดียวกัน)

## ทดสอบหลังตั้งค่า
1. `curl -i -X POST -H "Authorization: Bearer <CRON_SECRET>" https://<โดเมน>/api/cron/tick` → 200 และ JSON `{scheduler, weather, briefing, dispatch, errors: []}` (ไม่ใส่ header → 401; ยังไม่ตั้ง secret → 503)
2. Admin PWA → สร้างประกาศความสำคัญ "ด่วนที่สุด" → เผยแพร่ → ข้อความต้องเข้ากลุ่มทดสอบภายในไม่กี่วินาที และ UI ขึ้น "ส่งเข้า LINE แล้ว"
3. ตรวจ `deliveries` (status=sent) และ `delivery_attempts` ของรายการนั้น
