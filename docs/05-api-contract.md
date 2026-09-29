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

ใช้ service `publish()` และสิทธิ์ `admin` หรือ `village_head`; CRITICAL จะถูกจัดคิว immediate delivery ตามกฎเดิม

### `POST /api/announcements/:id/resolve`

Request `{ "summary": "ข้อความสรุปการปิดเรื่อง" }`; ใช้ service `resolve()` และสิทธิ์ `admin` หรือ `village_head`

## Error format

```json
{ "error": "ข้อความภาษาไทยสำหรับผู้ใช้" }
```

Server ต้องไม่ส่ง `payload` ของ delivery ใน dashboard/read endpoint เพื่อจำกัดการเปิดเผยข้อมูลที่ไม่จำเป็น
