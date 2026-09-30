#!/usr/bin/env bash
# ตรวจ secrets/variables ที่ job ต้องใช้ ก่อนรันจริง
# ใช้: scripts/preflight.sh <job> <scheduled:true|false>   (อ่านค่าจาก environment)
# - ยังไม่ตั้งค่าอะไรเลย (ยังไม่เปิดใช้ระบบ) + รันตามเวลา → ข้ามพร้อมคำเตือน ไม่ทำให้ workflow ล้มรัว ๆ
# - ตั้งค่าไม่ครบ หรือสั่งรันเอง → ล้มพร้อมบอกว่าขาดอะไร
set -u
job="${1:-}"; scheduled="${2:-false}"
out="${GITHUB_OUTPUT:-/dev/null}"

case "$job" in
  weather|healthcheck) need="SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY COMMUNITY_ID" ;;
  tick|briefing)       need="SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY COMMUNITY_ID LINE_CHANNEL_ACCESS_TOKEN LINE_TARGET" ;;
  "")                  echo "::error::ไม่รู้ว่าจะรัน job อะไร (schedule ไม่ตรงกับที่ map ไว้ใน jobs.yml — ตรวจ cron กับ case ให้ตรงกัน)"; exit 1 ;;
  *)                   echo "::error::ไม่รู้จัก job '$job'"; exit 1 ;;
esac

missing=""
for v in $need; do [ -z "${!v:-}" ] && missing="$missing $v"; done

if [ -z "${SUPABASE_URL:-}" ] && [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && [ "$scheduled" = "true" ]; then
  echo "::warning::ยังไม่ได้ตั้งค่า Supabase ใน GitHub Secrets — ข้าม job '$job' (ดู docs/OWNER-TODO.md ขั้น 3)"
  echo "skip=true" >> "$out"
  exit 0
fi

if [ -n "$missing" ]; then
  echo "::error::job '$job' ต้องตั้งค่าเพิ่ม:$missing"
  exit 1
fi

if [ "${LINE_TARGET:-}" = "broadcast" ]; then
  echo "::error::LINE_TARGET=broadcast ไม่อนุญาต (PRD ข้อ 17 #1: ใช้ group ID ของกลุ่มหมู่บ้าน)"
  exit 1
fi
echo "skip=false" >> "$out"
