# STATUS — Lampai Community (ระบบชุมชนบ้านลำพาย)

> ไฟล์นี้คือ "ภาพรวมล่าสุด" ของโปรเจกต์ — อ่านไฟล์นี้ก่อนเริ่มงาน แล้วดูรายการงานละเอียดใน [`CHECKLIST.md`](CHECKLIST.md)
> **ทุกครั้งที่ปิดงาน ให้แก้ไฟล์นี้ใน PR เดียวกัน** (ดูหัวข้อ "วิธีอัปเดต" ท้ายไฟล์)

| รายการ | ค่า |
|---|---|
| อัปเดตล่าสุด | 2026-10-01 (เริ่มเฟส 2: เพิ่ม delivery exponential backoff และตรวจ RLS) |
| เวอร์ชันโค้ด | 0.1.0 |
| เวอร์ชัน PRD | 0.3 (Decision Baseline) |
| เฟสปัจจุบัน | **Phase 2 (Reliability & Safety) — เริ่มดำเนินการหลังผู้ใช้ยืนยันให้ข้ามช่วงเฝ้าระวัง** |
| ความพร้อมภาพรวม Phase 2 | ประมาณ 35% (retry/idempotency/backoff, RLS และ CI มีแล้ว; ยังเหลือ alert จริง, backup/restore, quota review และ pilot) |
| สุขภาพโค้ด | `npm run typecheck` ✅ · `npm test` ✅ 61/61 (ตรวจเมื่อ 2026-10-01) |
| สภาพแวดล้อมจริง | 🟡 Supabase `jwspesomdtycnzjakeiv` ACTIVE_HEALTHY; migration `delivery_backoff` applied; RLS เปิดครบ 14 ตาราง |
| Blocker หลัก | ต้องทดสอบ failure alert กับ `ADMIN_LINE_TARGET`, ตรวจ backup/restore และกำหนด pilot ก่อนปิดเฟส 2 |

---

## 1. สถานะตามขอบเขต Phase 1 (PRD ข้อ 5)

| # | รายการ | สถานะ | หลักฐาน / หมายเหตุ |
|---|---|---|---|
| 1 | Supabase schema แกน + RLS | ✅ รันแล้วบนโปรเจกต์ที่เข้าถึงได้ | โปรเจกต์ `jwspesomdtycnzjakeiv`; ตรวจพบ 14 ตารางและ RLS เปิดครบ; region `ap-south-1` ไม่ใช่ Singapore |
| 2 | Ingestion: อากาศ (Open-Meteo) + ประกาศกรอกเอง | 🟡 weather และ test delivery ผ่าน; CLI announce ยังไม่ทดสอบ end-to-end | `src/adapters/openMeteo.ts`, `src/jobs/weatherFetch.ts`, `cli announce` |
| 3 | Lifecycle + dedup + change detection + freshness | ✅ เสร็จและมีเทสต์ | `src/engine/*`, `engine.test.ts`, `scenario.test.ts` |
| 4 | Daily Briefing "ไม่ส่งถ้าไม่มีอะไรใหม่" | ✅ เสร็จและมีเทสต์ | `src/engine/briefing.ts`, `src/services/briefing.ts` |
| 5 | เสียง TTS (น้องจุ่นจ้าน) + LINE Text/Audio | 🟡 LINE Text ✅ · TTS/Audio ❌ | ตาราง `audio_assets` เตรียมไว้ ยังไม่มีโค้ดสร้างเสียง |
| 6 | Admin PWA ขั้นต่ำ | 🟡 vertical slice เสร็จ · ⏳ ยังไม่ทดสอบ Auth/role บน Supabase จริง | `admin/`, `src/admin/server.ts`, `docs/04-architecture.md`, `docs/05-api-contract.md`; `user_roles` ยังว่าง |
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
| 11 | User / Role | 🟡 schema + RLS + server API เสร็จ; ยังไม่มีผู้ใช้ทดสอบ/แถว `user_roles` |
| 12 | Audit / System Jobs | ✅ `audit_logs`, `job_runs` |

## 3. งานอัตโนมัติ (PRD ข้อ 11)

| Job | สถานะ | หมายเหตุ |
|---|---|---|
| `weather_fetch` | ✅ | workflow run `36818882083` ผ่านและบันทึก `weather_observations` |
| `announcement_scheduler` | ✅ | tick run `36866884343`; Supabase `job_runs.status=ok` (ทุก 5 นาทีเป็น fallback; CRITICAL มี immediate path) |
| `briefing_morning` | ✅ | 06:30 เวลาไทย (cron 23:30 UTC) |
| `delivery_dispatch` | ✅ | idempotency + retry 3 ครั้ง + exponential backoff 1/2 นาที; migration `0002_delivery_backoff.sql` applied |
| `tts_generate` | ❌ | |
| `healthcheck` (NFR-003) | ✅ | run `36867386900` หลัง deploy grace period ผ่าน; `issues=0`, `newIssues=0` |
| `retention_cleanup` | ❌ | รอ PRD #10 |
| `briefing_evening` | ❌ | COULD |
| `market_fetch`, `news_fetch` | ❌ | Phase 2 |

## 4. ความไม่สอดคล้องที่ต้องรู้

- **[แก้แล้ว 2026-09-29]** workflow `jobs` ตั้ง cron tick เป็นทุก 5 นาที แต่ `case` ยังเป็น 15 นาที → tick ไม่เคยทำงาน (รันแล้วขึ้น "สำเร็จ" เฉยๆ); ตอนนี้แก้แล้วและมีเทสต์ `src/workflow.test.ts` กันซ้ำ
- **[ตรวจแล้ว 2026-10-01]** GitHub Actions รอบ `36802089355` และ `36803579260` ผ่านขั้น checkout/npm แต่ preflight รายงานขาด `COMMUNITY_ID`; จึงยังไม่เริ่มดึง Open-Meteo

- PRD ระบุสถานะ "ยังไม่พร้อมเขียนโค้ด (ดูข้อ 18)" แต่โค้ด Phase 1 ถูกเขียนไปแล้ว → **Definition of Ready (PRD ข้อ 18) ยังไม่ผ่านครบ** ค่า threshold ต่าง ๆ ในโค้ดยังเป็น `[สมมติฐาน]` (อยู่ที่ `freshness.ts`, `priority.ts`, `weather.ts`, `briefing.ts`)
- PRD ข้อ 11 กำหนด scheduler ทุก 5 นาที แต่ workflow ตั้ง 15 นาที (ยอมรับได้เพราะ CRITICAL ส่งทันทีตอน publish — ยืนยันกับเจ้าของ)
- `docs/03-data-model.md` และ `docs/06–08` ยังไม่ถูกเขียน; `docs/04-architecture.md` และ `docs/05-api-contract.md` ถูกเพิ่มแล้วสำหรับ PWA vertical slice
- Secret scanning และ push protection ของ GitHub เปิดอยู่แล้ว; Dependabot alerts ยังปิด และ `main` ยังไม่ถูกป้องกัน

## 5.1 บันทึกการดำเนินการ staging (2026-10-01)

- อ่านคู่มือแนบและเอกสาร/โค้ดในรีโปครบก่อนลงมือ
- Clone รีโป `aodxx/Lampai-Communit` และตรวจ workflow, migration, seed, scripts และเอกสารเจ้าของระบบ
- รัน `npm ci`, `npm run typecheck` และ `npm test`: ผ่าน 59/59
- ตรวจ Supabase: พบโปรเจกต์เดียว `jwspesomdtycnzjakeiv`, สถานะ `ACTIVE_HEALTHY`, region `ap-south-1`
- Apply schema หลักและ seed สำเร็จ; ตรวจพบ community 1 แถว, source 1 แถว, ตารางทั้งหมด 14 ตาราง และ RLS เปิดครบ
- ไม่ได้สร้างผู้ใช้ Auth/admin เนื่องจากยังไม่มีอีเมลผู้ใช้ที่เจ้าของยืนยัน; `user_roles` ยังมี 0 แถว
- ตรวจ GitHub security: secret scanning/push protection เปิด; branch protection ไม่มี; Dependabot alerts ปิด
- ตรวจ workflow run ก่อนและหลังผู้ใช้แจ้งว่าตั้งค่า: รอบล่าสุด `36803579260` ล้มที่ preflight ด้วย `COMMUNITY_ID` ไม่ถูกส่งเข้า workflow
- ไม่บันทึกค่า secret หรือ token ลงไฟล์/commit

- เริ่ม Roadmap เฟส 1: tick run `36866884343` สำเร็จ; `scheduler` และ `dispatch` มี `status=ok`
- เพิ่ม `STARTUP_GRACE_HOURS=2` ใน health engine และเพิ่ม unit tests รวมเป็น 61 tests
- เริ่มเฟส 2 ตามคำสั่งผู้ใช้โดยไม่รอเฝ้าระวัง 3 วัน
- เพิ่ม `deliveries.next_attempt_at` และ migration `0002_delivery_backoff.sql` บน Supabase สำเร็จ
- เพิ่ม exponential backoff สำหรับ retry: 1 นาทีหลังครั้งที่ 1, 2 นาทีหลังครั้งที่ 2, ล้มถาวรหลังครั้งที่ 3
- ตรวจ Supabase แล้ว: RLS เปิดครบ 14 ตาราง และมี SELECT policy ตามบทบาท; audit_logs มี trigger append-only
- เพิ่ม `docs/08-delivery.md` และยืนยัน CI มี typecheck + test สำหรับ pull request

## 6. ผลการตัดสินใจ PRD ข้อ 17

**ปิด blocker ขั้น 2 แล้ว (2026-09-29)**

- #1 LINE = กลุ่มหมู่บ้านใน MVP
- #2 ผู้ช่วยทำ Draft → ผู้ใหญ่บ้าน Publish; admin ดูแล/override; SENSITIVE จำกัดตามบทบาท
- #4 อากาศมีนัยสำคัญตามเกณฑ์ใน `src/engine/weather.ts`
- #8 CRITICAL ส่งทันทีใน execution path; GitHub Actions 5 นาทีเป็น fallback
- #10 retention policy ถูกล็อกใน `src/engine/retention.ts`
- #3, #6, #7, #9 ไม่ใช่ blocker ของแกน Phase 1 (รายละเอียดที่เหลือดู PRD ข้อ 17)
## 7. ความเสี่ยงที่กำลังเปิดอยู่

| ความเสี่ยง | สถานะ |
|---|---|
| R4 cron ของ GitHub ล่าช้า/พลาด | เปิดอยู่ — healthcheck มีแล้ว; CRITICAL ไม่พึ่ง cron |
| R5 / SEC-007 secrets หลุดในแชต | ⚠️ **เคยมีการวางโทเคน GitHub ในแชต — ต้อง revoke แล้วสร้างใหม่ (ทำก่อนปิดงานแรก)** |
| R9 ขอบเขตบวม | ควบคุมด้วย PRD ข้อ 5 |

## 8. งานถัดไปที่แนะนำ (เรียงลำดับ)

1. ตั้ง Secret `ADMIN_LINE_TARGET` แล้วทดสอบ healthcheck บน staging
2. ตั้ง Supabase (staging) + LINE OA/กลุ่มทดสอบ + Secrets → รัน workflow `jobs` แบบ dry-run
3. เชื่อม Admin PWA กับ Supabase Auth จริง และทดสอบสิทธิ์แต่ละ role
4. Vertical slice จริงแบบ end-to-end: `announce → publish → dispatch → LINE` บน staging
5. ทำ `retention_cleanup` ให้บังคับใช้นโยบายที่ตัดสินแล้ว
6. TTS น้องจุ่นจ้าน + ส่ง LINE Audio (ภาษาไทยมาตรฐานเป็น baseline)
7. เขียน docs/03 และ docs/06–08 ให้ตรงกับ schema/โค้ดจริง

## 9. วิธีอัปเดตไฟล์นี้

1. เปลี่ยนสถานะในตารางที่เกี่ยวข้อง (✅/🟡/⏳/❌) พร้อมแก้ "อัปเดตล่าสุด" และ "ความพร้อมภาพรวม"
2. รัน `npm run typecheck && npm test` แล้วอัปเดตบรรทัด "สุขภาพโค้ด"
3. ย้ายข้อที่ตอบแล้วออกจากหัวข้อ 5 และบันทึกคำตอบลง PRD ข้อ 17
4. ติ๊กช่องที่เสร็จใน `CHECKLIST.md`
5. ห้ามใส่ secret/โทเคน/ข้อมูลส่วนบุคคลในไฟล์นี้
