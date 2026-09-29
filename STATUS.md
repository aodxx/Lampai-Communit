# STATUS — Lampai Community (ระบบชุมชนบ้านลำพาย)

> ไฟล์นี้คือ "ภาพรวมล่าสุด" ของโปรเจกต์ — อ่านไฟล์นี้ก่อนเริ่มงาน แล้วดูรายการงานละเอียดใน [`CHECKLIST.md`](CHECKLIST.md)
> **ทุกครั้งที่ปิดงาน ให้แก้ไฟล์นี้ใน PR เดียวกัน** (ดูหัวข้อ "วิธีอัปเดต" ท้ายไฟล์)

| รายการ | ค่า |
|---|---|
| อัปเดตล่าสุด | 2026-09-29 (เพิ่ม healthcheck) |
| เวอร์ชันโค้ด | 0.1.0 |
| เวอร์ชัน PRD | 0.2 (Draft for Review) |
| เฟสปัจจุบัน | **Phase 1 (MVP) — แกนระบบเสร็จ, ยังไม่ครบตามขอบเขต** |
| ความพร้อมภาพรวม Phase 1 | ประมาณ 55% (แกนโค้ดเสร็จ; ขาด TTS, Admin PWA, jobs ปฏิบัติการ, การตั้งค่าจริง) |
| สุขภาพโค้ด | `npm run typecheck` ✅ · `npm test` ✅ 45/45 (ตรวจเมื่อ 2026-09-29) |
| สภาพแวดล้อมจริง | ❓ ยังไม่ยืนยันว่ามี Supabase / LINE OA / GitHub Secrets ตั้งไว้แล้ว |
| Blocker หลัก | ต้องให้เจ้าของโปรเจกต์ตอบคำถาม PRD ข้อ 17 (#1, #2, #4, #8, #10) |

---

## 1. สถานะตามขอบเขต Phase 1 (PRD ข้อ 5)

| # | รายการ | สถานะ | หลักฐาน / หมายเหตุ |
|---|---|---|---|
| 1 | Supabase schema แกน + RLS | ✅ เขียนแล้ว · ⏳ ยังไม่ยืนยันว่ารันบนโปรเจกต์จริง | `supabase/migrations/0001_core.sql`, `seed.sql` |
| 2 | Ingestion: อากาศ (Open-Meteo) + ประกาศกรอกเอง | ✅ โค้ดเสร็จ · ⏳ ยังไม่ทดสอบกับบริการจริง | `src/adapters/openMeteo.ts`, `src/jobs/weatherFetch.ts`, `cli announce` |
| 3 | Lifecycle + dedup + change detection + freshness | ✅ เสร็จและมีเทสต์ | `src/engine/*`, `engine.test.ts`, `scenario.test.ts` |
| 4 | Daily Briefing "ไม่ส่งถ้าไม่มีอะไรใหม่" | ✅ เสร็จและมีเทสต์ | `src/engine/briefing.ts`, `src/services/briefing.ts` |
| 5 | เสียง TTS (น้องจุ่นจ้าน) + LINE Text/Audio | 🟡 LINE Text ✅ · TTS/Audio ❌ | ตาราง `audio_assets` เตรียมไว้ ยังไม่มีโค้ดสร้างเสียง |
| 6 | Admin PWA ขั้นต่ำ | ❌ ยังไม่เริ่ม | ตอนนี้ใช้ผ่าน CLI เท่านั้น |
| 7 | Audit log งานสำคัญ | ✅ เสร็จ | ตาราง append-only (trigger) + บันทึกที่ ingest/publish/resolve/scheduler/briefing |

สัญลักษณ์: ✅ เสร็จ · 🟡 ทำบางส่วน · ⏳ รอยืนยัน/รอปัจจัยภายนอก · ❌ ยังไม่ทำ

## 2. สถานะ 12 โมดูล (ตาม `docs/02-domain-model.md`)

| # | โมดูล | สถานะ |
|---|---|---|
| 1 | Community Core | ✅ schema |
| 2 | Weather | ✅ |
| 3 | Market (ราคาปาล์ม/ยาง) | ❌ Phase 2 — รอ PRD #6 |
| 4 | News | ❌ Phase 2 — รอ PRD #7 |
| 5 | Announcement | ✅ |
| 6 | Event / Schedule | 🟡 มีเตือนล่วงหน้า ยังไม่มีปฏิทิน/ตารางซ้ำ |
| 7 | Document / OCR | ❌ Phase 2 |
| 8 | Audio / TTS | ❌ ขั้นถัดไป |
| 9 | Daily Briefing | ✅ |
| 10 | Notification / Delivery | ✅ LINE Text (idempotent, retry ≤ 3, quiet hours) |
| 11 | User / Role | 🟡 schema + RLS เสร็จ; API/PWA ยังไม่ทำ |
| 12 | Audit / System Jobs | ✅ `audit_logs`, `job_runs` |

## 3. งานอัตโนมัติ (PRD ข้อ 11)

| Job | สถานะ | หมายเหตุ |
|---|---|---|
| `weather_fetch` | ✅ | workflow `jobs.yml` ทุก 3 ชม. |
| `announcement_scheduler` | ✅ | รวมอยู่ใน job `tick` (ทุก 15 นาที — PRD กำหนด 5 นาที) |
| `briefing_morning` | ✅ | 06:30 เวลาไทย (cron 23:30 UTC) |
| `delivery_dispatch` | ✅ | รวมอยู่ใน `tick` |
| `tts_generate` | ❌ | |
| `healthcheck` (NFR-003) | 🟡 โค้ด+เทสต์เสร็จ ⏳ ยังไม่ทดสอบจริง | ทุกชั่วโมง (นาทีที่ 20) ตรวจ job ล้มเหลว/หยุดรัน/ค้าง + คิวส่งค้าง/ล้มเหลว → LINE ถึง `ADMIN_LINE_TARGET`; แจ้งครั้งเดียวต่อปัญหา, job หยุดรันเตือนซ้ำทุก 6 ชม. |
| `retention_cleanup` | ❌ | รอ PRD #10 |
| `briefing_evening` | ❌ | COULD |
| `market_fetch`, `news_fetch` | ❌ | Phase 2 |

## 4. ความไม่สอดคล้องที่ต้องรู้

- PRD ระบุสถานะ "ยังไม่พร้อมเขียนโค้ด (ดูข้อ 18)" แต่โค้ด Phase 1 ถูกเขียนไปแล้ว → **Definition of Ready (PRD ข้อ 18) ยังไม่ผ่านครบ** ค่า threshold ต่าง ๆ ในโค้ดยังเป็น `[สมมติฐาน]` (อยู่ที่ `freshness.ts`, `priority.ts`, `weather.ts`, `briefing.ts`)
- PRD ข้อ 11 กำหนด scheduler ทุก 5 นาที แต่ workflow ตั้ง 15 นาที (ยอมรับได้เพราะ CRITICAL ส่งทันทีตอน publish — ยืนยันกับเจ้าของ)
- เอกสารถัดไปตาม PRD (`03-data-model` … `08-delivery`) ยังไม่ถูกเขียน ทั้งที่ schema จริงมีแล้ว → ต้องเขียนย้อนให้ตรงกับของจริง
- ไม่มี dependency/secret scanning ใน repo (SEC-008)

## 5. คำถามที่ยังรอเจ้าของตัดสิน (PRD ข้อ 17)

| # | คำถาม | บล็อกอะไร |
|---|---|---|
| 1 | ผู้รับ LINE: broadcast / กลุ่ม / push รายบุคคล | โควต้า, `LINE_TARGET`, การเก็บ user ID |
| 2 | ใครอนุมัติ publish กี่ชั้น | สิทธิ์ใน RLS/PWA |
| 4 | อากาศแบบใดนับเป็น "สิ่งใหม่" | กฎใน `weather.ts` |
| 8 | วิธีส่งงาน CRITICAL ให้ทัน (≤ 5 นาที) | สถาปัตยกรรม dispatch |
| 10 | นโยบายเก็บข้อมูล (retention) | job `retention_cleanup` |
| 3, 5, 6, 7, 9 | ขนาดชุมชน, เตือน active นาน, ราคา, ข่าว, ภาษาถิ่น | ไม่บล็อก Phase 1 แต่บล็อก Phase 2 / TTS |

## 6. ความเสี่ยงที่กำลังเปิดอยู่

| ความเสี่ยง | สถานะ |
|---|---|
| R4 cron ของ GitHub ล่าช้า/พลาด | เปิดอยู่ — ยังไม่มี healthcheck |
| R5 / SEC-007 secrets หลุดในแชต | ⚠️ **เคยมีการวางโทเคน GitHub ในแชต — ต้อง revoke แล้วสร้างใหม่ (ทำก่อนปิดงานแรก)** |
| R9 ขอบเขตบวม | ควบคุมด้วย PRD ข้อ 5 |

## 7. งานถัดไปที่แนะนำ (เรียงลำดับ)

1. ตั้ง Secret `ADMIN_LINE_TARGET` แล้วทดสอบ healthcheck บน staging
2. ตอบ PRD ข้อ 17 (#1, #2, #4, #8, #10) และ rotate โทเคนที่หลุด → เจ้าของโปรเจกต์
3. ตั้ง Supabase (staging) + LINE OA/กลุ่มทดสอบ + GitHub Secrets → รัน workflow `jobs` แบบ dry-run
4. Vertical slice จริงแบบ end-to-end: `announce → publish → dispatch → LINE` บน staging
5. TTS น้องจุ่นจ้าน + ส่ง LINE Audio (หลังตอบ PRD #9 เรื่องภาษาถิ่น)
6. ขั้น 5 ที่เหลือ: ตัดสินใจความถี่ scheduler, กลไก CRITICAL (#8), ควบคุมโควต้า LINE, retention_cleanup
7. Admin PWA ขั้นต่ำ (login, จัดการประกาศ, ดูการส่ง, ดู job runs)

## 8. วิธีอัปเดตไฟล์นี้

1. เปลี่ยนสถานะในตารางที่เกี่ยวข้อง (✅/🟡/⏳/❌) พร้อมแก้ "อัปเดตล่าสุด" และ "ความพร้อมภาพรวม"
2. รัน `npm run typecheck && npm test` แล้วอัปเดตบรรทัด "สุขภาพโค้ด"
3. ย้ายข้อที่ตอบแล้วออกจากหัวข้อ 5 และบันทึกคำตอบลง PRD ข้อ 17
4. ติ๊กช่องที่เสร็จใน `CHECKLIST.md`
5. ห้ามใส่ secret/โทเคน/ข้อมูลส่วนบุคคลในไฟล์นี้
