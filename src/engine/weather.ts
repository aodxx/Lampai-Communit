export interface WeatherObs {
  communityId: string;
  observedAt: string; // ISO
  temperatureC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  precipitationMm: number | null;
  precipProbability: number | null; // % สูงสุดของวัน
  weatherCode: number | null; // WMO
  fetchedAt: string;
}

/** เกณฑ์ "อากาศมีนัยสำคัญ" — ใช้เป็นกฎแจ้งเตือนของชุมชน: ฝน/ลม/ร้อนจัด/พายุ */
export const WEATHER_THRESHOLDS = {
  precipProbability: 70,
  precipitationMm: 10,
  windKmh: 40,
  temperatureC: 37,
  stormCodes: [95, 96, 99],
} as const;

export function isSignificantWeather(w: WeatherObs): boolean {
  const t = WEATHER_THRESHOLDS;
  return (
    (w.precipProbability ?? 0) >= t.precipProbability ||
    (w.precipitationMm ?? 0) >= t.precipitationMm ||
    (w.windKmh ?? 0) >= t.windKmh ||
    (w.temperatureC ?? 0) >= t.temperatureC ||
    (w.weatherCode !== null && (t.stormCodes as readonly number[]).includes(w.weatherCode))
  );
}

export function weatherCodeThai(code: number | null): string {
  if (code === null) return 'ไม่ทราบสภาพอากาศ';
  if (code === 0) return 'ท้องฟ้าแจ่มใส';
  if (code <= 3) return 'มีเมฆบางส่วน';
  if (code === 45 || code === 48) return 'มีหมอก';
  if (code >= 51 && code <= 57) return 'มีฝนปรอย';
  if (code >= 61 && code <= 67) return 'มีฝนตก';
  if (code >= 80 && code <= 82) return 'ฝนตกเป็นช่วง ๆ';
  if (code >= 95) return 'พายุฝนฟ้าคะนอง';
  return 'สภาพอากาศแปรปรวน';
}

/** คำแนะนำจากกฎที่กำหนดล่วงหน้าเท่านั้น (FR-802: ไม่ให้ LLM แต่งเอง) */
export function weatherAdvice(w: WeatherObs): string[] {
  const t = WEATHER_THRESHOLDS;
  const out: string[] = [];
  if ((w.weatherCode !== null && (t.stormCodes as readonly number[]).includes(w.weatherCode)) || (w.windKmh ?? 0) >= t.windKmh) {
    out.push('ระวังพายุลมแรง หลีกเลี่ยงการอยู่ใต้ต้นไม้ใหญ่');
  } else if ((w.precipProbability ?? 0) >= t.precipProbability || (w.precipitationMm ?? 0) >= t.precipitationMm) {
    out.push('มีโอกาสฝนตกมาก พกร่มหรือเสื้อกันฝนด้วยนะครับ');
  }
  if ((w.temperatureC ?? 0) >= t.temperatureC) out.push('อากาศร้อนจัด ดื่มน้ำมาก ๆ และหลีกเลี่ยงงานกลางแดด');
  return out;
}

export function weatherSummaryText(w: WeatherObs): string {
  const parts = [weatherCodeThai(w.weatherCode)];
  if (w.temperatureC !== null) parts.push(`อุณหภูมิประมาณ ${Math.round(w.temperatureC)} องศา`);
  if (w.precipProbability !== null) parts.push(`โอกาสฝนตก ${Math.round(w.precipProbability)} เปอร์เซ็นต์`);
  return parts.join(' ');
}
