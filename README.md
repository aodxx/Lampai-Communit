# Lampai Community — ระบบชุมชนบ้านลำพาย

ระบบข้อมูลและการสื่อสารของชุมชน: รวบรวม → จำ → ตรวจว่า **อะไรเปลี่ยน** → แจ้งเฉพาะสิ่งที่ชาวบ้านควรรู้ (LINE)

- ข้อกำหนด: [`PRD.md`](PRD.md) · โครงสร้าง: [`docs/02-domain-model.md`](docs/02-domain-model.md)
- หลักคิด: ถ้าไม่มีอะไรใหม่ ระบบไม่พูดซ้ำ
- สถานะโปรเจกต์: [`STATUS.md`](STATUS.md) · เช็คลิสต์ทำงานต่อ: [`CHECKLIST.md`](CHECKLIST.md) · วิธีทำงานร่วมกัน: [`CONTRIBUTING.md`](CONTRIBUTING.md) · สิ่งที่เจ้าของต้องทำเอง: [`docs/OWNER-TODO.md`](docs/OWNER-TODO.md)

## เริ่มใช้งาน

```bash
npm ci
npm run typecheck && npm test      # ทดสอบ Engine + สถานการณ์จริง (ไม่ต้องมีฐานข้อมูล)
```

### ตั้งค่า Supabase
1. สร้างโปรเจกต์ Supabase แล้วรัน `supabase/migrations/0001_core.sql` ตามด้วย `supabase/seed.sql` (SQL Editor หรือ `supabase db push`)
2. คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่า (**service-role key ห้ามอยู่ในโค้ด/ฝั่ง client**)

### ใช้งานผ่าน CLI
```bash
node --env-file=.env src/cli.ts announce examples/meeting.json --publish
node --env-file=.env src/cli.ts job briefing --dry-run     # ดูว่าจะพูดอะไร (ไม่บันทึก ไม่ส่ง)
node --env-file=.env src/cli.ts job dispatch --dry-run     # ดูคิวที่จะส่ง
node --env-file=.env src/cli.ts resolve <id> "ถนนเปิดใช้งานแล้ว"
node --env-file=.env src/cli.ts job healthcheck --dry-run  # ตรวจสุขภาพระบบ ดูว่าจะแจ้งผู้ดูแลว่าอะไร (ไม่ส่ง)
```

### งานอัตโนมัติ (GitHub Actions)
ตั้ง Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `ADMIN_LINE_TARGET` และ Variables: `COMMUNITY_ID`, `LINE_TARGET`, `HEALTH_EXPECTED_JOBS`
แล้วรัน workflow `jobs` แบบ manual โดยเลือกงานและ `dry_run` ให้ตรงกับการทดสอบ ก่อนปล่อยให้ทำงานตามเวลา

คำสั่งผ่าน GitHub CLI:

```bash
gh workflow run jobs.yml --ref main -f job=weather -f dry_run=false
gh workflow run jobs.yml --ref main -f job=tick -f dry_run=false
gh workflow run jobs.yml --ref main -f job=healthcheck -f dry_run=true
gh run list --workflow jobs.yml
gh run watch <run-id> --exit-status
```

ลำดับตรวจเฟส 1 คือ `weather → tick (scheduler + dispatch) → healthcheck` โดยตรวจผลย้อนหลังใน Supabase ตาราง `job_runs`, `deliveries` และ `delivery_attempts` ควบคู่กับ log ของ workflow

Healthcheck มี startup grace period 2 ชั่วโมงหลังเริ่มมี job run จริง เพื่อไม่แจ้งเตือนว่า job ที่ยังไม่เคยสำเร็จหยุดทำงานทันทีหลังเปิดระบบ

## โครงสร้าง
```
src/engine/    สมองของระบบ (ฟังก์ชันบริสุทธิ์): dedup, lifecycle, freshness, priority, briefing
src/services/  ประกาศ, Briefing, การส่ง
src/repo/      ช่องทางเดียวสู่ฐานข้อมูล (Supabase / in-memory)
src/adapters/  Open-Meteo, LINE
supabase/      schema + RLS + seed
```
