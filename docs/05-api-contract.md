# API Contract — Admin PWA

ทุก endpoint ที่ไม่ใช่ `/api/auth/config` และ `/api/auth/login` ต้องมี `Authorization: Bearer <access_token>` เมื่อใช้ production Supabase; โหมดสาธิตใช้ actor `demo-admin` โดย server เท่านั้น

## Authentication

### `GET /api/auth/config`

ตอบ `{ "demo": boolean, "communityId": string }` โดยไม่เปิดเผย service-role key

### `POST /api/auth/login`

Request:

```json
{ "email": "user@example.com", "password": "..." }
```

Response สำเร็จ `{ "demo": false, "accessToken": "...", "refreshToken": "..." }`

## Current user

### `GET /api/me`

```json
{ "actor": { "id": "uuid", "role": "admin" }, "demo": false, "communityId": "uuid" }
```

## Dashboard/read models

- `GET /api/dashboard` — counts, announcements ล่าสุด, deliveries ล่าสุดแบบไม่ส่ง `payload`, jobs ล่าสุด และ weather ล่าสุด
- `GET /api/announcements` — ประกาศที่ยังไม่ archived
- `GET /api/deliveries` — deliveries สูงสุด 100 รายการ; admin/village_head/assistant
- `GET /api/jobs` — job runs ย้อนหลัง 30 วัน; admin/village_head

## Announcement commands

### `POST /api/announcements`

สร้างร่างผ่าน `ingest()` และกำหนด `sourceId` เป็น `MANUAL_SOURCE_ID` ฝั่ง server

```json
{
  "title": "หัวข้อ",
  "body": "รายละเอียด",
  "type": "notice",
  "priority": "normal",
  "dataLevel": "public",
  "location": "สถานที่",
  "effectiveFrom": "2026-10-01T09:00",
  "effectiveTo": "2026-10-01T12:00"
}
```

### `PATCH /api/announcements/:id`

แก้ได้เฉพาะ `draft`; การแก้จะบันทึก audit event `announcement.edit`

### `POST /api/announcements/:id/publish`

ใช้ `publishAndFlush()` และสิทธิ์ `admin` หรือ `village_head`

Response: `{ announcement, delivery }`
- `delivery = null` → เรื่องไม่ใช่ CRITICAL จะรวมใน Briefing รอบถัดไป
- CRITICAL → ส่ง LINE ทันทีก่อนตอบกลับ (timeout 8 วินาที): `{ configured, sent, failed, timedOut, error }`
  - `configured:false` = ยังไม่ได้ตั้ง `LINE_CHANNEL_ACCESS_TOKEN`/`LINE_TARGET` บนเซิร์ฟเวอร์ → ข้อความรอในคิว
  - `sent:0` + `timedOut`/`error` → ยังอยู่ในคิว ระบบ retry เอง (backoff 1/2 นาที) และ tick เป็นตัวสำรอง; publish ไม่ล้ม

`resolve` และ `POST /api/announcements` (กรณีแก้เรื่อง CRITICAL ที่เผยแพร่แล้ว) คืน `delivery` ในรูปเดียวกัน

### `POST|GET /api/cron/tick`
สำหรับตัวตั้งเวลาภายนอกเท่านั้น (ไม่ใช้ session ผู้ใช้) — header `Authorization: Bearer <CRON_SECRET>`
- 401 secret ผิด · 503 ไม่ได้ตั้ง `CRON_SECRET` หรือโหมดสาธิต
- ทำ: scheduler → ดึงอากาศถ้าเก่ากว่า 2 ชม. → Briefing เช้าถ้าถึงเวลา (06:30–11:59 ไทย) และยังไม่เคยทำวันนี้ → ส่งคิว
- 200 `{scheduler, weather, briefing, dispatch, errors:[]}` · 500 ถ้าขั้นใดขั้นหนึ่งล้ม (ขั้นอื่นยังทำงานต่อ)
- รายละเอียดการตั้งค่า: `docs/09-external-scheduler.md`

### `POST /api/announcements/:id/resolve`

Request `{ "summary": "ข้อความสรุปการปิดเรื่อง" }`; ใช้ service `resolve()` และสิทธิ์ `admin` หรือ `village_head`

## Error format

```json
{ "error": "ข้อความภาษาไทยสำหรับผู้ใช้" }
```

Server ต้องไม่ส่ง `payload` ของ delivery ใน dashboard/read endpoint เพื่อจำกัดการเปิดเผยข้อมูลที่ไม่จำเป็น
