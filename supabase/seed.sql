-- ข้อมูลตั้งต้นสำหรับพัฒนา (UUID คงที่ ตรงกับ .env.example)
insert into public.communities (id, name, subdistrict, district, province, lat, lon)
values ('11111111-1111-4111-8111-111111111111', 'บ้านลำพาย', 'โคกชะงาย', 'เมือง', 'พัทลุง', 7.619729, 100.005932)
on conflict (id) do nothing;

insert into public.sources (id, community_id, name, kind, tier)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'ผู้ดูแลกรอกเอง', 'manual', 1)
on conflict (id) do nothing;
