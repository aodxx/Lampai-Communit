import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yml = readFileSync(new URL('../.github/workflows/jobs.yml', import.meta.url), 'utf8');

// บั๊กที่เคยเกิด: แก้ cron จาก 15 นาทีเป็น 5 นาที แต่ case ยังเป็นของเดิม → job ว่างและ workflow "สำเร็จ" โดยไม่ทำอะไรเลย
test('jobs.yml: ทุก cron ต้องมี case map ไปยัง job (และไม่มี case ค้างที่ไม่มี cron)', () => {
  const crons = [...yml.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]!);
  const cases = [...yml.matchAll(/"([^"]+)"\)\s*job=(\w+)/g)].map((m) => ({ cron: m[1]!, job: m[2]! }));
  assert.ok(crons.length >= 4);
  for (const c of crons) assert.ok(cases.some((x) => x.cron === c), `cron '${c}' ไม่มี case map ใน "เลือกงาน"`);
  for (const x of cases) assert.ok(crons.includes(x.cron), `case '${x.cron}' → ${x.job} ไม่มี cron ตรงกัน`);
});

test('jobs.yml: ทุก job ที่ map ได้ มี step ให้รัน และ workflow เรียก preflight', () => {
  const jobs = new Set([...yml.matchAll(/"[^"]+"\)\s*job=(\w+)/g)].map((m) => m[1]!));
  for (const j of jobs) assert.match(yml, new RegExp(`steps\\.pick\\.outputs\\.job == '${j}'`), `ไม่มี step สำหรับ job ${j}`);
  assert.match(yml, /scripts\/preflight\.sh/);
});
