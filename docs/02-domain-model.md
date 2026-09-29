# Domain Model — Lampai Community (v0.1)

เอกสารนี้แปลงภาพรวมที่ออกแบบร่วมกัน (4 ชั้น / 12 โมดูล / 3 วงจร) ให้เป็นโครงสร้างที่ผูกกับโค้ดจริง ส่วนกติกาละเอียดดู `PRD.md`

## 1. สี่ชั้นของระบบ → ที่อยู่ในโค้ด

| ชั้น | หน้าที่ | โค้ด |
|---|---|---|
| 1 Data Sources | ข้อมูลไหลเข้า (อากาศ ประกาศที่กรอก ข่าว ฯลฯ) | `src/adapters/`, `src/cli.ts announce` |
| 2 Information Engine | ตรวจ จำ เทียบ ตัดสินว่าอะไรเปลี่ยน — **สมองของระบบ** | `src/engine/` (ฟังก์ชันบริสุทธิ์ ไม่แตะ DB) |
| 3 Community Services | ประกาศ / Briefing / เตือนตามเวลา | `src/services/` |
| 4 Delivery | เลือกช่องทางและส่ง แล้วบันทึกผล | `src/services/delivery.ts`, `src/adapters/line.ts` |

Supabase คือความจำกลาง (`src/repo/`, `supabase/migrations/`) ทุกชั้นคุยกันผ่านมัน

## 2. สถานะของ 12 โมดูล

| # | โมดูล | สถานะ | หมายเหตุ |
|---|---|---|---|
| 1 | Community Core | ✅ schema | ทุกตารางผูก `community_id` รองรับหลายหมู่บ้านในอนาคต |
| 2 | Weather | ✅ | ดึง Open-Meteo, เก็บ `observed_at`, ตรวจอายุ ≤ 3 ชม. |
| 3 | Market | ⏳ Phase 2 | ต้องรู้แหล่งราคา (PRD ข้อ 17 #6); กติกาอายุ 72 ชม. มีใน `freshness.ts` แล้ว |
| 4 | News | ⏳ Phase 2 | ใช้ `ingest()` ตัวเดียวกับประกาศ (dedup/update เสร็จแล้ว) รอเลือกแหล่งข่าว |
| 5 | Announcement | ✅ | lifecycle, dedup, update, publish/resolve, สิทธิ์ |
| 6 | Event / Schedule | ✅ บางส่วน | เตือนล่วงหน้าตาม `remind_offsets_min`; ยังไม่มีปฏิทิน/ตารางซ้ำ |
| 7 | Document / OCR | ⏳ Phase 2 | ต้องมีมนุษย์ตรวจก่อนส่งเสมอ (FR-B01) |
| 8 | Audio / TTS | ⏳ ขั้นถัดไป | ตาราง `audio_assets` เตรียมไว้แล้ว |
| 9 | Daily Briefing | ✅ | ตัดสิน `send` / `skip_no_change` พร้อมเหตุผล |
| 10 | Notification / Delivery | ✅ LINE Text | idempotent, retry จำกัด, quiet hours |
| 11 | User / Role | ✅ schema + RLS | Community API/PWA ยังไม่ทำ |
| 12 | Audit / System Jobs | ✅ | `audit_logs` แก้/ลบไม่ได้, `job_runs` ทุกงาน |

## 3. เส้นทางของข้อมูลหนึ่งชิ้น

```
IncomingItem ──ingest()──► decideIngest()
   ├─ create   → Announcement(draft) + Update(created)          [ไม่แจ้ง]
   ├─ unchanged→ อัปเดต last_seen เท่านั้น                        [ไม่แจ้ง]
   ├─ cosmetic → แก้ถ้อยคำเงียบ ๆ                                 [ไม่แจ้ง]
   ├─ update   → Update(notify=true) [+ status→updated]          [แจ้งความคืบหน้า]
   └─ review   → review_queue (คนตัดสิน ไม่รวม/ไม่เปิดเรื่องเก่าเอง)

publish() (มนุษย์เท่านั้น) → Update(notify) ─┬─ priority=critical → delivery ทันที
                                             └─ อื่น ๆ           → รอ Briefing
runScheduler(): published→active, →expired, →archived, สร้าง reminder
runBriefing():  pendingNews + weather ─► composeBriefing() ─► send | skip_no_change
dispatch():     คิว deliveries ─► LINE (เคารพ quiet hours, retry ≤ 3, บันทึก attempts)
```

## 4. กติกาที่บังคับด้วยโค้ดและทดสอบแล้ว

- ไม่มี item ใหม่/ไม่มีการเปลี่ยนแปลง → **ไม่มี delivery** (`scenario.test.ts`: ถนนปิด 26→27→28)
- รัน Briefing / dispatch ซ้ำ → ไม่ส่งซ้ำ (idempotency key + `X-Line-Retry-Key`)
- ทุกเรื่องเริ่มเป็น `draft`; เผยแพร่ต้องเป็นบทบาทที่มีสิทธิ์; `sensitive` ไม่ถูกแจ้งออกและ dispatch ปฏิเสธ
- ข้อมูลเกินอายุ (อากาศ > 3 ชม.) ไม่ถูกนำเสนอเป็นปัจจุบัน; เรื่อง `expired` ไม่ถูกพูดถึง
- ข้อความทุกบรรทัดสร้างจากแม่แบบ + ข้อมูลจริง ไม่ใช้ LLM แต่งข้อเท็จจริง
- ค่า threshold ทั้งหมดที่เป็น `[สมมติฐาน]` อยู่ในไฟล์เดียวต่อหมวด แก้ได้ง่าย: `freshness.ts`, `priority.ts`, `weather.ts`, `briefing.ts`

## 5. ยังไม่ทำ (ตั้งใจ)

Community API + Admin PWA, เสียง TTS น้องจุ่นจ้าน, ราคาปาล์ม/ยาง, ข่าว, OCR, โดเมน อสม., Community Board
