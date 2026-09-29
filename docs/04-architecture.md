# Architecture — Admin PWA

## เป้าหมาย

Admin PWA เป็นเครื่องมือผู้ดูแลบนมือถือสำหรับสร้างร่าง ตรวจสอบ และเปลี่ยนสถานะประกาศ โดย business rules เดิมใน `src/engine/` และ `src/services/` เป็นแหล่งตัดสินใจเดียว ไม่ทำซ้ำกฎใน browser

## ส่วนประกอบ

```text
Browser (admin/)
  ├─ static PWA shell: HTML/CSS/JS + manifest + service worker
  └─ Bearer access token
          │ same-origin /api
          v
Node Admin Server (src/admin/server.ts)
  ├─ Supabase Auth: ตรวจ access token และ user_roles
  ├─ server-only service-role client
  ├─ Announcement services: ingest / publish / resolve
  └─ Repo contract: SupabaseRepo หรือ MemoryRepo (local demo)
          │
          v
Supabase: Auth + Postgres + RLS + audit_logs
```

## การเลือก deployment

- Frontend เป็น browser-rendered static shell เพราะข้อมูล dashboard เป็นข้อมูลส่วนตัวที่ต้องโหลดผ่าน API หลัง login
- `/api/*` ต้องส่งไปยัง Node server เท่านั้น
- static assets cache ได้แบบสั้น; `index.html` ใช้ `no-cache` เพื่อรับ release ใหม่
- ห้ามใช้ service-role key ใน `admin/` หรือส่งกลับไป browser
- production ต้องมี `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` และ `COMMUNITY_ID`
- โหมดสาธิตเปิดได้ด้วย `ADMIN_DEMO=true` เท่านั้น หรือใน local ที่ไม่ได้กำหนด `NODE_ENV=production`; production จะไม่เปิด demo โดยอัตโนมัติ

## สิทธิ์

| งาน | admin | village_head | assistant | editor | viewer |
|---|---:|---:|---:|---:|---:|
| อ่าน dashboard/ประกาศ | ✓ | ✓ | ✓ | ✓ | ✓ |
| สร้างร่าง | ✓ | ✓ | ✓ | ✓ | — |
| แก้ไขร่าง | ✓ | ✓ | ✓ | ✓ | — |
| เผยแพร่ | ✓ | ✓ | — | — | — |
| ปิดเรื่อง | ✓ | ✓ | — | — | — |
| ดู deliveries | ✓ | ✓ | ✓ | — | — |
| ดู job runs | ✓ | ✓ | — | — | — |

การตรวจสิทธิ์ทำสองชั้น: server เรียก `auth.getUser(accessToken)` และอ่าน role จาก `user_roles`; business service ตรวจสิทธิ์การเปลี่ยนสถานะซ้ำอีกชั้นหนึ่ง

## โหมดสาธิต

โหมดสาธิตใช้ `MemoryRepo` พร้อมข้อมูลตัวอย่างและไม่เรียก Supabase/LINE เหมาะสำหรับ preview และ development เท่านั้น ข้อมูลหายเมื่อ process restart
