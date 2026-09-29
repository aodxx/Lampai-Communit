# STATUS — Lampai Community (ระบบชุมชนบ้านลำพาย)

> ไฟล์นี้คือ "ภาพรวมล่าสุด" ของโปรเจกต์ — อ่านไฟล์นี้ก่อนเริ่มงาน แล้วดูรายการงานละเอียดใน [`CHECKLIST.md`](CHECKLIST.md)
> **ทุกครั้งที่ปิดงาน ให้แก้ไฟล์นี้ใน PR เดียวกัน** (ดูหัวข้อ "วิธีอัปเดต" ท้ายไฟล์)

| รายการ | ค่า |
|---|---|
| อัปเดตล่าสุด | 2026-09-29 (ปิด PRD blocker ขั้น 2 + ปรับสิทธิ์/CRITICAL/LINE target/retention policy) |
| เวอร์ชันโค้ด | 0.1.0 |
| เวอร์ชัน PRD | 0.2 (Draft for Review) |
| เฟสปัจจุบัน | **Phase 1 (MVP) — แกนระบบเสร็จ, ปิด blocker ขั้น 2 แล้ว; ยังขาด staging/PWA/TTS/retention cleanup** |
| ความพร้อมภาพรวม Phase 1 | ประมาณ 60% (แกนโค้ดเสร็จ; ขาด TTS, Admin PWA, jobs ปฏิบัติการ/retention, การตั้งค่าจริง) |
| สุขภาพโค้ด | `npm run typecheck` ✅ · `npm test` ✅ 55/55 (ตรวจเมื่อ 2026-09-29) |
| สภาพแวดล้อมจริง | ❓ ยังไม่ยืนยันว่ามี Supabase / LINE OA / GitHub Secrets ตั้งไว้แล้ว |
| Blocker หลัก | **ไม่มีแล้วใน PRD ข้อ 17 #1/#2/#4/#8/#10**; ขั้นต่อไปคือ staging + vertical slice จริง |

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
| 10 | Notification / Delivery | ✅ LINE Text (idempotent, retry ≤ 3, quiet hours, คุมโควต้า: ≥95% ส่งเฉพาะ CRITICAL) |
| 11 | User / Role | 🟡 schema + RLS เสร็จ; API/PWA ยังไม่ทำ |
| 12 | Audit / System Jobs | ✅ `audit_logs`, `job_runs` |

## 3. งานอัตโนมัติ (PRD ข้อ 11)

| Job | สถานะ | หมายเหตุ |
|---|---|---|
| `weather_fetch` | ✅ | workflow `jobs.yml` ทุก 3 ชม. |
| `announcement_scheduler` | ✅ | รวมอยู่ใน job `tick` (ทุก 5 นาทีเป็น fallback; CRITICAL มี immediate path) |
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

## 5. ผลการตัดสินใจ PRD ข้อ 17

**ปิด blocker ขั้น 2 แล้ว (2026-09-29)**

- #1 LINE = กลุ่มหมู่บ้านใน MVP
- #2 ผู้ช่วยทำ Draft → ผู้ใหญ่บ้าน Publish; admin ดูแล/override; SENSITIVE จำกัดตามบทบาท
- #4 อากาศมีนัยสำคัญตามเกณฑ์ใน `src/engine/weather.ts`
- #8 CRITICAL ส่งทันทีใน execution path; GitHub Actions 5 นาทีเป็น fallback
- #10 retention policy ถูกล็อกใน `src/engine/retention.ts`
- #3, #6, #7, #9 ไม่ใช่ blocker ของแกน Phase 1 (รายละเอียดที่เหลือดู PRD ข้อ 17)
## 6. ความเสี่ยงที่กำลังเปิดอยู่

| ความเสี่ยง | สถานะ |
|---|---|
| R4 cron ของ GitHub ล่าช้า/พลาด | เปิดอยู่ — healthcheck มีแล้ว; CRITICAL ไม่พึ่ง cron |
| R5 / SEC-007 secrets หลุดในแชต | ⚠️ **เคยมีการวางโทเคน GitHub ในแชต — ต้อง revoke แล้วสร้างใหม่ (ทำก่อนปิดงานแรก)** |
| R9 ขอบเขตบวม | ควบคุมด้วย PRD ข้อ 5 |

## 7. งานถัดไปที่แนะนำ (เรียงลำดับ)

1. ตั้ง Secret `ADMIN_LINE_TARGET` แล้วทดสอบ healthcheck บน staging
2. ตั้ง Supabase (staging) + LINE OA/กลุ่มทดสอบ + GitHub Secrets → รัน workflow `jobs` แบบ dry-run
3. Vertical slice จริงแบบ end-to-end: `announce → publish → dispatch → LINE` บน staging
4. ทำ `retention_cleanup` ให้บังคับใช้นโยบายที่ตัดสินแล้ว
5. TTS น้องจุ่นจ้าน + ส่ง LINE Audio (ภาษาไทยมาตรฐานเป็น baseline)
6. Admin PWA ขั้นต่ำ (login, จัดการประกาศ, ดูการส่ง, ดู job runs)
7. เขียน docs/03–08 ให้ตรงกับ schema/โค้ดจริง

## 8. วิธีอัปเดตไฟล์นี้

1. เปลี่ยนสถานะในตารางที่เกี่ยวข้อง (✅/🟡/⏳/❌) พร้อมแก้ "อัปเดตล่าสุด" และ "ความพร้อมภาพรวม"
2. รัน `npm run typecheck && npm test` แล้วอัปเดตบรรทัด "สุขภาพโค้ด"
3. ย้ายข้อที่ตอบแล้วออกจากหัวข้อ 5 และบันทึกคำตอบลง PRD ข้อ 17
4. ติ๊กช่องที่เสร็จใน `CHECKLIST.md`
5. ห้ามใส่ secret/โทเคน/ข้อมูลส่วนบุคคลในไฟล์นี้
