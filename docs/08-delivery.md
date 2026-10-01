# Delivery และความทนทานการส่ง

## สถานะของข้อความ

ตาราง `deliveries` ใช้สถานะดังนี้:

- `queued` — รอส่ง หรือรอเวลาลองใหม่
- `sent` — LINE ตอบรับสำเร็จ
- `failed` — ลองครบจำนวนสูงสุดแล้ว
- `skipped` — ระบบปฏิเสธข้อมูลที่ไม่ใช่ `public`

ทุกครั้งที่เรียก LINE ระบบบันทึกผลลง `delivery_attempts` พร้อม HTTP status และ error เพื่อดูย้อนหลังได้

## Idempotency

- `deliveries.idempotency_key` มี unique constraint ในฐานข้อมูล
- การสร้างคิวใช้ `upsert ... on conflict do nothing` จึงไม่สร้าง delivery ซ้ำเมื่อ job รันซ้ำ
- การส่ง LINE ใช้ `delivery.id` เป็น `X-Line-Retry-Key`
- การตอบ HTTP 409 จาก LINE หมายถึง retry key เดิมถูกประมวลผลแล้ว ระบบถือว่าส่งสำเร็จและไม่ส่งข้อความซ้ำ

## Retry และ exponential backoff

ระบบลองส่งสูงสุด 3 ครั้ง:

| หลังล้มเหลวครั้งที่ | เวลาลองครั้งถัดไป |
|---:|---:|
| 1 | 1 นาที |
| 2 | 2 นาที |
| 3 | เปลี่ยนเป็น `failed` ไม่ลองต่อ |

เวลาลองครั้งถัดไปเก็บใน `deliveries.next_attempt_at` ซึ่งอยู่ใน migration `0002_delivery_backoff.sql` การรัน `tick` ก่อนเวลานี้จะไม่เรียก LINE ซ้ำ

## ตรวจสอบปัญหา

ใช้ข้อมูลต่อไปนี้ประกอบกัน:

```sql
select id, status, attempt_count, next_attempt_at, last_error, sent_at
from public.deliveries
where community_id = '<community-id>'
order by created_at desc
limit 50;
```

```sql
select delivery_id, ok, http_status, error, created_at
from public.delivery_attempts
where delivery_id = '<delivery-id>'
order by created_at desc
limit 20;
```

ห้ามใส่ access token หรือ service-role key ในคำสั่ง, issue, log หรือเอกสาร
