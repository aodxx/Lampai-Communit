import type { WeatherObs } from '../engine/weather.ts';

interface OpenMeteoResponse {
  current?: { time: string; temperature_2m?: number; relative_humidity_2m?: number; precipitation?: number; weather_code?: number; wind_speed_10m?: number };
  daily?: { precipitation_probability_max?: (number | null)[] };
}

/** ดึงอากาศปัจจุบัน + โอกาสฝนสูงสุดของวัน จาก Open-Meteo (เวลาที่ได้เป็นเวลาไทย ไม่มี offset → เติม +07:00) */
export async function fetchWeather(communityId: string, lat: number, lon: number, now: Date, fetchImpl: typeof fetch = fetch): Promise<WeatherObs> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('daily', 'precipitation_probability_max');
  url.searchParams.set('timezone', 'Asia/Bangkok');
  url.searchParams.set('forecast_days', '1');

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const j = (await res.json()) as OpenMeteoResponse;
  if (!j.current?.time) throw new Error('Open-Meteo: ไม่มีข้อมูล current');
  const c = j.current;
  return {
    communityId,
    observedAt: new Date(`${c.time}:00+07:00`).toISOString(),
    temperatureC: c.temperature_2m ?? null,
    humidityPct: c.relative_humidity_2m ?? null,
    windKmh: c.wind_speed_10m ?? null,
    precipitationMm: c.precipitation ?? null,
    precipProbability: j.daily?.precipitation_probability_max?.[0] ?? null,
    weatherCode: c.weather_code ?? null,
    fetchedAt: now.toISOString(),
  };
}
