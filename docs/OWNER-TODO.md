# สิ่งที่เจ้าของโปรเจกต์ต้องทำเอง (Claude ทำแทนไม่ได้)

ทำตามลำดับ ติ๊กเมื่อเสร็จ และอัปเดต [`STATUS.md`](../STATUS.md) ตอนจบ
ทุกข้อใช้เวลาไม่นาน แต่ **ขั้น 1–3 คือสิ่งที่ปิดกั้นการทดสอบจริงทั้งหมด**

## ขั้น 1 — ให้ทีมทำงานไม่ชนกัน (ประมาณ 10 นาที)
- [ ] 1.1 เชิญเพื่อนแต่ละคนเป็น Collaborator ด้วย **บัญชี GitHub ของตัวเอง**: Repo → Settings → Collaborators → Add people (เพื่อให้เห็นว่าใครทำอะไร)
- [ ] 1.2 ตั้งกฎป้องกัน `main`: Settings → Branches → Add branch protection rule → `main` → ติ๊ก *Require a pull request before merging* (1 approval) และ *Require status checks to pass* (เลือก `ci`)
- [ ] 1.3 เปิด Dependabot alerts และ Secret scanning: Settings → Code security
- [ ] 1.4 ส่งลิงก์ `CONTRIBUTING.md` ให้ทีม และตกลงกันว่า "รับงานจาก Issues เท่านั้น"

## ขั้น 2 — สร้างสภาพแวดล้อมทดสอบ (staging) (ประมาณ 30–45 นาที)
- [ ] 2.1 สร้างโปรเจกต์ Supabase ใหม่สำหรับ **staging** (อย่าใช้โปรเจกต์ที่จะใช้จริง)
- [ ] 2.2 Supabase → SQL Editor → รันไฟล์ `supabase/migrations/0001_core.sql` ทั้งไฟล์ แล้วรัน `supabase/seed.sql` (จด `community id` ที่ได้)
- [ ] 2.3 Supabase → Authentication → สร้างผู้ใช้ทดสอบ 1 คน แล้วเพิ่มแถวใน `user_roles` ให้เป็น `admin` (ใช้ล็อกอิน Admin PWA)
- [ ] 2.4 สร้าง LINE Official Account (หรือ Messaging API channel) สำหรับทดสอบ และสร้าง **กลุ่ม LINE ทดสอบ** ที่มีเฉพาะทีม เพิ่มบอทเข้ากลุ่ม
- [ ] 2.5 หา group ID ของกลุ่มทดสอบ (ตั้ง webhook ชั่วคราวเพื่ออ่านค่า `groupId` จาก event ที่บอทได้รับ) และ userId ของผู้ดูแลหนึ่งคน (สำหรับ `ADMIN_LINE_TARGET`)
- [ ] 2.6 เปิดหน้า LINE Developers ดูแผนและโควต้าข้อความต่อเดือนที่ใช้จริง แล้วจดตัวเลขไว้ (ตอบ PRD ข้อ 17 #3)

## ขั้น 3 — ใส่ค่าลับใน GitHub (ประมาณ 10 นาที)
Repo → Settings → Secrets and variables → Actions

- [ ] 3.1 **Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `ADMIN_LINE_TARGET`
- [ ] 3.2 **Variables:** `COMMUNITY_ID` (จากขั้น 2.2), `LINE_TARGET` (= group ID ของกลุ่มทดสอบ — **ห้ามใส่ `broadcast`**), `HEALTH_EXPECTED_JOBS` (บน staging ที่ยังไม่เปิด Briefing ให้ใส่ `weather,scheduler,dispatch`)
- [ ] 3.3 Actions → `jobs` → Run workflow → เลือก `weather` (dry_run ไม่มีผลกับ weather) → ต้องสำเร็จ และมีแถวใหม่ใน `weather_observations`
- [ ] 3.4 Run workflow → `healthcheck` แบบ dry_run → ดูผลใน log
- [ ] 3.5 **จนกว่าจะทำข้อ 3.1–3.2 ครบ** งานตามเวลาจะถูก "ข้าม" พร้อมคำเตือนสีเหลือง (ไม่ล้มรัว ๆ)
- [ ] 3.6 ห้ามใช้ค่าชุดนี้บน production — ตอน go-live ให้สร้างชุดใหม่

## ขั้น 4 — ทดสอบส่งจริง 1 รอบ (ประมาณ 20 นาที)
ทำหลังขั้น 1–3 เสร็จ (เปิด Issue "vertical slice staging" แล้วแนบผลลัพธ์)

- [ ] 4.1 ล็อกอิน Admin PWA (Vercel หรือ `npm run` ในเครื่อง) ด้วยผู้ใช้ทดสอบ สร้างประกาศร่าง → publish → ข้อความต้องเข้ากลุ่มทดสอบ
- [ ] 4.2 สร้างประกาศ CRITICAL → ต้องถึงกลุ่มภายใน 5 นาที
- [ ] 4.3 ตั้ง `ADMIN_LINE_TARGET` แล้วจงใจให้ job ล้ม (เช่น ใส่ LINE token ผิดชั่วคราว) → ผู้ดูแลต้องได้รับข้อความแจ้งเตือน

## ขั้น 5 — ก่อนเปิดใช้จริง
- [ ] 5.1 ตอบข้อที่ยังเปิด: PRD ข้อ 17 #3 (ขนาดชุมชน), #6 (แหล่งราคาปาล์ม/ยาง), #7 (แหล่งข่าว) — ไม่บล็อก Phase 1
- [ ] 5.2 **ห้ามตั้ง `ADMIN_DEMO=true` บน Vercel/production** (โหมดสาธิตให้ทุกคนเป็น admin)
- [ ] 5.3 สร้าง Supabase + LINE ชุด production แยกจาก staging และตั้ง Secrets ชุดใหม่
- [ ] 5.4 ทดสอบกับผู้สูงอายุอย่างน้อย 3 คนก่อนขยายทั้งหมู่บ้าน
