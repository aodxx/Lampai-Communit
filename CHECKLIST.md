# CHECKLIST — ทำงานต่อจากจุดนี้อย่างเป็นขั้นตอน

ทำตามลำดับขั้น (0 → 9) แต่ละขั้นมี "เกณฑ์ผ่าน" ให้ครบก่อนไปขั้นถัดไป
ภาพรวมล่าสุดดูที่ [`STATUS.md`](STATUS.md) · ข้อกำหนดเต็มดู [`PRD.md`](PRD.md) · โครงสร้างโค้ดดู [`docs/02-domain-model.md`](docs/02-domain-model.md)

สัญลักษณ์: `[x]` เสร็จแล้ว · `[ ]` ยังไม่ทำ · 👤 ต้องเป็นเจ้าของ/ผู้ตัดสินใจ · 💻 งานโค้ด · ⚙️ งานตั้งค่าระบบ · `FR-`/`NFR-`/`SEC-` = รหัสใน PRD

---

## ขั้น 0 — เตรียมเครื่องและทำความเข้าใจ (ทุกคนที่เข้าใหม่)

- [ ] ติดตั้ง Node.js ≥ 22.18 (ดู `engines` ใน `package.json`)
- [ ] `git clone` แล้ว `npm ci`
- [ ] `npm run typecheck && npm test` ต้องผ่านทั้งหมด (ตอนนี้ 56 เทสต์)
- [ ] อ่าน `README.md` → `docs/02-domain-model.md` → PRD ข้อ 1, 5, 6, 9, 21
- [ ] จำหลักคิดสูงสุด: **ถ้าไม่มีอะไรใหม่ ระบบไม่พูดซ้ำ** และข้อความต้องมาจากแม่แบบ + ข้อมูลจริง ห้ามให้ LLM แต่งข้อเท็จจริง
- [ ] ตั้งกติกาทีม: ทำงานผ่าน branch + PR, CI (`ci.yml`) ต้องเขียว, ห้ามใส่ secret ในโค้ด/แชต/issue

**เกณฑ์ผ่าน:** รันเทสต์ผ่านบนเครื่องตัวเอง และอธิบาย data flow (ingest → publish → briefing/dispatch) ได้

---

## ขั้น 1 — ปิดความปลอดภัยที่ค้างอยู่ (ทำก่อนเสมอ)

- [ ×] 👤 **Revoke โทเคน GitHub ที่เคยถูกวางในแชต** แล้วสร้างใหม่แบบ fine-grained จำกัดเฉพาะรีโปนี้ (SEC-007, R5)
- [ ] ⚙️ เปิด GitHub secret scanning + Dependabot ใน repo (SEC-008)
- [ ] ⚙️ ตั้ง branch protection บน `main` (ต้องผ่าน CI + ต้องมี review)
- [ ] ตรวจว่า `.env` ไม่ถูก commit (ตอนนี้ `.gitignore` กันไว้แล้ว) และ `git log -p | grep -iE "key|token|secret"` ไม่พบค่าจริง
- [ ] วางแผน rotate: Supabase service-role key, LINE channel access token (เมื่อสร้างแล้ว)

**เกณฑ์ผ่าน:** ไม่มี secret ที่เคยหลุดยังใช้งานได้; `main` ถูกป้องกัน

---

## ขั้น 2 — ตัดสินใจเรื่องที่บล็อกงาน (PRD ข้อ 17)

**ปิดขั้น 2 แล้ว — คำตอบถูกบันทึกใน PRD ข้อ 17 และผูกกับโค้ดที่เกี่ยวข้อง**

- [x] 👤 #1 ผู้รับ LINE = **กลุ่มหมู่บ้าน** ใน MVP; ไม่ fallback เป็น broadcast
- [x] 👤 #2 **ผู้ช่วย/ผู้แก้ไขทำ Draft → ผู้ใหญ่บ้าน Publish**; admin ดูแล/override; SENSITIVE จำกัดตามบทบาท
- [x] 👤 #4 อากาศมีนัยสำคัญ = ฝน ≥70% หรือ ≥10 มม. หรือ ลม ≥40 กม./ชม. หรือ ≥37°C หรือพายุ WMO 95/96/99
- [x] 👤 #8 CRITICAL = **ส่งทันทีใน execution path ตอน publish/update/resolve**; GitHub Actions ทุก 5 นาทีเป็น fallback
- [x] 👤 #10 retention = ประกาศ 24 เดือน, audio 12 เดือน, delivery/attempt/job 90 วัน, weather 90 วัน, audit ไม่ลบ
- [x] 👤 #9 MVP ใช้ภาษาไทยมาตรฐานก่อน; dialect เป็นงานหลัง field test
- [x] 👤 #3 ยังไม่ล็อกจำนวนสมาชิก; MVP ใช้กลุ่มเดียว และเก็บตัวเลขจริงตอน staging
- [x] 💻 ล็อกค่าในโค้ดตามคำตอบ: `weather.ts`, `retention.ts`, publish permissions, LINE target และ CRITICAL immediate dispatch

**เกณฑ์ผ่าน:** PRD ข้อ 18 ข้อแรก (#1, #2, #4, #8, #10) มีคำตอบแล้ว และไม่เหลือ blocker ของขั้น 2
## ขั้น 3 — ตั้งค่าสภาพแวดล้อมจริง (Staging ก่อน)

- [ ] ⚙️ สร้างโปรเจกต์ Supabase **staging** (แยกจาก production — NFR-012)
- [ ] ⚙️ รัน `supabase/migrations/0001_core.sql` แล้ว `supabase/seed.sql`
- [ ] ⚙️ ตรวจว่า RLS เปิดทุกตาราง และ `audit_logs` แก้/ลบไม่ได้ (ทดสอบ `update`/`delete` ต้อง error) (SEC-001, SEC-004)
- [ ] ⚙️ สร้าง LINE Official Account + **กลุ่ม/บัญชีทดสอบ** แยกจากของจริง
- [ ] ⚙️ ตรวจโควต้าและเงื่อนไขแผนของ LINE / Supabase / (TTS ที่จะเลือก) (PRD ข้อ 18)
- [ ] ⚙️ ตั้ง GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`
- [ ] ⚙️ ตั้ง GitHub Variables: `COMMUNITY_ID`, `LINE_TARGET` (และ Secret `ADMIN_LINE_TARGET` สำหรับ healthcheck)
- [ ] ⚙️ คัดลอก `.env.example` → `.env` (เครื่องนักพัฒนา) กรอกค่า staging
- [ ] ⚙️ เปิด backup ของ Supabase ตามแผนที่ใช้ (NFR-008)

**เกณฑ์ผ่าน:** `node --env-file=.env src/cli.ts job weather` รันสำเร็จและมีแถวใน `weather_observations` + `job_runs`

---

## ขั้น 4 — พิสูจน์ vertical slice จริง (staging)

ลำดับตามคำแนะนำ PRD ข้อ 16: ประกาศกรอกเอง → lifecycle+dedup → deliveries → LINE Text

- [ ] `announce examples/meeting.json` → ได้ draft (ตรวจแถวใน `announcements`, `announcement_updates`, `audit_logs`)
- [ ] รัน `announce` ซ้ำไฟล์เดิม → ต้องได้ `unchanged` ไม่เกิดการแจ้งซ้ำ
- [ ] `publish <id>` แล้ว `job dispatch --dry-run` → เห็นคิวที่จะส่ง
- [ ] `job dispatch` (จริง) → ข้อความเข้ากลุ่ม LINE ทดสอบ; รันซ้ำต้องไม่ส่งซ้ำ (NFR-002)
- [ ] ทดสอบประกาศ `critical` → ส่งทันที ไม่รอ Briefing; วัดเวลาถึงผู้รับ ≤ 5 นาที (NFR-004)
- [ ] ทดสอบ quiet hours: ประกาศไม่ critical ต้องรอ ไม่ส่งกลางคืน
- [ ] ทดสอบ `resolve <id> "..."` → แจ้งปิดเรื่องหนึ่งครั้ง
- [ ] `job briefing --dry-run` วันที่ไม่มีอะไรใหม่ → ต้อง `skip_no_change`
- [ ] รัน workflow `jobs` (manual, dry-run) ตามด้วยแบบจริงบน staging
- [ ] ทดสอบล้มเหลวจงใจ (LINE token ผิด) → `job_runs` เป็น `error` และ workflow ล้ม (NFR-003)

**เกณฑ์ผ่าน:** ครบทุกข้อ และบันทึกผลการทดสอบใน PR/issue

---

## ขั้น 5 — ความน่าเชื่อถือของงานอัตโนมัติ (Phase 1 ที่ยังขาด)

- [x] 💻 เพิ่ม job `healthcheck` (ทุกชั่วโมง): ตรวจ job ที่ไม่รัน/รันล้มเหลว/ค้าง และ deliveries ค้างหรือส่งล้มเหลว แล้วแจ้งผู้ดูแล (NFR-003, R4) — โค้ด+เทสต์เสร็จ (`src/engine/health.ts`, `src/services/healthcheck.ts`); ⏳ ยังไม่ทดสอบกับ Supabase/LINE จริง
- [x] 💻 กำหนดช่องทางแจ้งผู้ดูแลเมื่อระบบมีปัญหา — ใช้ LINE push ไป `ADMIN_LINE_TARGET` (ห้ามเป็น broadcast); ถ้าไม่ตั้งค่าแล้วพบปัญหา job จะล้มให้ workflow แจ้งเตือน (ไม่เงียบ)
- [ ] ⚙️ ตั้ง GitHub Secret `ADMIN_LINE_TARGET` (userId/groupId ของผู้ดูแล) และ Variable `HEALTH_EXPECTED_JOBS` (ถ้าต้องการลดรายการบน staging) แล้วรัน workflow `jobs` → healthcheck แบบ dry-run
- [ ] 💻 ตัดสินใจเรื่องความถี่ scheduler (ตอนนี้ 15 นาที vs PRD 5 นาที) และปรับ `jobs.yml`
- [ ] 💻 กลไกงาน CRITICAL ตามคำตอบ #8 (เช่น trigger `workflow_dispatch` ทันทีหลัง publish)
- [ ] 💻 ตรวจ/เพิ่ม structured log ต่อ job: new/updated/skipped/failed (NFR-006)
- [x] 💻 ควบคุมโควต้า LINE + แจ้งเตือนก่อนเต็ม (NFR-005, R3) — โค้ด+เทสต์เสร็จ: แจ้งผู้ดูแลที่ 80%/95%/หมด, โควต้า ≥95% ส่งเฉพาะ CRITICAL (`src/engine/quota.ts`, `src/adapters/lineQuota.ts`); ⏳ ยังไม่ทดสอบกับ LINE จริง และยังไม่ได้ตั้งเพดานตามแผนที่ใช้จริง (PRD ข้อ 17 #3)
- [ ] 💻 (SHOULD) ตรวจการเปลี่ยนแปลงสำคัญของอากาศเทียบรอบก่อน (FR-803)
- [ ] 💻 job `retention_cleanup` ตามนโยบาย #10
- [ ] ✏️ เพิ่มเทสต์สำหรับทุกฟีเจอร์ใหม่ (ทั้ง engine และ scenario)

**เกณฑ์ผ่าน:** จำลอง job พัง/cron พลาดแล้วผู้ดูแลได้รับแจ้งภายในเวลาที่กำหนด

---

## ขั้น 6 — Admin PWA ขั้นต่ำ (FR-D01 – D07)

- [ ] 👤 ยืนยันตารางสิทธิ์ PRD ข้อ 12 และการตัดสินเรื่อง SENSITIVE/admin
- [ ] 💻 เลือกสแต็ก PWA + โฮสติ้ง แล้วเขียน `docs/04-architecture.md` และ `docs/05-api-contract.md` (PWA ↔ Supabase/Automation)
- [ ] 💻 Login ด้วย Supabase Auth และแสดงเฉพาะสิ่งที่ role อนุญาต (FR-D01)
- [ ] 💻 สร้าง/แก้/publish/resolve/ยกเลิกประกาศ (FR-D02)
- [ ] 💻 ดูสถานะการส่ง: สำเร็จ/ล้มเหลว/ข้าม+เหตุผล (FR-D03)
- [ ] 💻 ดู job runs และข้อผิดพลาด (FR-D04)
- [ ] 💻 (SHOULD) คิวตรวจ `review_queue` (dedup กำกวม) (FR-D05)
- [ ] 💻 (SHOULD) จัดการ sources (FR-D06) · ใช้งานได้ดีบนมือถือ (FR-D07)
- [ ] 💻 ตรวจสิทธิ์ฝั่ง server ทุก API ไม่พึ่งการซ่อนปุ่ม (SEC-005)
- [ ] 💻 ยืนยันว่า service-role key ไม่อยู่ฝั่ง client (SEC-002)
- [ ] 💻 หน้าหลักโหลด ≤ 3 วินาทีบน 4G (NFR-004)

**เกณฑ์ผ่าน:** ผู้ช่วยผู้ใหญ่บ้านสร้างร่าง → ผู้ใหญ่บ้าน publish → เห็นสถานะการส่ง โดยไม่ต้องใช้ CLI

---

## ขั้น 7 — เสียง TTS "น้องจุ่นจ้าน" + LINE Audio (PRD ข้อ 9.6)

- [ ] 👤 ตอบ #9 (ภาษาถิ่น) และเลือกผู้ให้บริการ TTS ตามโควต้า/ต้นทุน
- [ ] 💻 pre-processing สคริปต์เสียง: อ่านตัวเลข/วันที่ พ.ศ./หน่วย ให้ถูก (FR-601, R7)
- [ ] 💻 job `tts_generate` (key = hash ของสคริปต์ → cache ไม่สร้างซ้ำ) เก็บลง `audio_assets`
- [ ] 💻 ส่ง LINE Audio และมีเสียงเป็นทางเลือกเสมอสำหรับ IMPORTANT ขึ้นไป (NFR-007)
- [ ] 💻 ควบคุมโควต้า TTS + fallback เป็น Text เมื่อโควต้าต่ำ (R3)
- [ ] ทดสอบภาคสนามกับผู้สูงอายุ/ชาวบ้านตัวอย่าง (FR-606)

**เกณฑ์ผ่าน:** ข้อความ IMPORTANT/CRITICAL มีเสียงที่ผู้ฟังเข้าใจถูกต้อง (ตัวชี้วัดข้อ 3.3)

---

## ขั้น 8 — เอกสารและ Runbook (ลด bus factor — R8)

- [ ] เขียน `docs/03-data-model.md` ให้ตรงกับ schema จริง (PK/FK/index/RLS/retention)
- [ ] เขียน `docs/06-security-roles.md` (ตารางสิทธิ์เต็ม, SENSITIVE, PDPA/SEC-006)
- [ ] เขียน `docs/07-jobs.md` (runbook แต่ละ job: ทำอะไร, ตรวจอย่างไร, พังแล้วแก้อย่างไร)
- [ ] เขียน `docs/08-delivery.md` (LINE, โควต้า, quiet hours, retry)
- [ ] ทดสอบกู้คืนข้อมูลจาก backup อย่างน้อย 1 ครั้ง (NFR-008)
- [ ] ทดสอบ export ข้อมูล CSV/JSON (NFR-009)
- [ ] อัปเดตสถานะและ Definition of Ready ใน PRD (ข้อ 18) + ประวัติเอกสาร (ภาคผนวก C)

**เกณฑ์ผ่าน:** คนใหม่ทำตาม runbook แล้วดูแลระบบพื้นฐานได้โดยไม่ต้องถามผู้เขียนเดิม

---

## ขั้น 9 — ก่อน Go-live และหลังเปิดใช้

- [ ] ทำ Definition of Ready (PRD ข้อ 18) ให้ครบทุกข้อ
- [ ] ตรวจรับตาม FR ทั้งหมดของ Phase 1 (ไล่ตาราง `STATUS.md` หัวข้อ 1 ต้องเป็น ✅ ทุกแถว)
- [ ] ตั้งค่า production: Supabase, LINE OA จริง, Secrets ชุดใหม่ (ไม่ใช้ร่วมกับ staging)
- [ ] เริ่มจาก dry-run 3–7 วัน: เทียบ Briefing ที่ระบบจะพูดกับความจริง
- [ ] เปิดใช้จริงแบบจำกัดกลุ่มก่อน แล้วขยาย
- [ ] เฝ้าระวัง 2 สัปดาห์: ไม่มี Sev-1, ไม่มีการแจ้งซ้ำ
- [ ] ทบทวนตัวชี้วัด PRD ข้อ 3.3 และตัดสินใจเริ่ม Phase 2

---

## Backlog เฟสถัดไป (ยังไม่ต้องทำ — อย่าให้ขอบเขตบวม R9)

**Phase 2:** ราคาปาล์ม/ยาง (#6) · ข่าวท้องถิ่น/ราชการ (#7) · Events/ปฏิทิน + เตือนล่วงหน้า · Documents/OCR (ต้องมีมนุษย์ตรวจก่อนส่ง FR-B01)
**Phase 3:** โดเมน อสม. (SENSITIVE) · Community Board · พอร์ทัลชาวบ้าน/ผู้ช่วยผู้ใหญ่บ้าน · API เชื่อมระบบอื่น
**นอกขอบเขต:** UI/ธีมละเอียด, Flex Message ซับซ้อน, แชตบอทถามตอบอิสระ, ระบบชำระเงิน, แอป native

---

## กติกาต่อทุกงาน (Definition of Done)

- [ ] `npm run typecheck` และ `npm test` ผ่าน, CI เขียว
- [ ] มีเทสต์ครอบคลุมพฤติกรรมใหม่ (โดยเฉพาะ "ไม่ส่งซ้ำ / ไม่พูดถ้าไม่มีอะไรใหม่")
- [ ] ไม่มี secret/ข้อมูลส่วนบุคคล/ข้อมูล SENSITIVE ในโค้ด ข้อความ LINE หรือ log
- [ ] ถ้าเพิ่ม threshold ให้ใส่ในไฟล์กลางของหมวดนั้นและระบุ `[สมมติฐาน]`
- [ ] อัปเดต `STATUS.md` และติ๊ก `CHECKLIST.md` ใน PR เดียวกัน
