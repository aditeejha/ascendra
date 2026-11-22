import type { Weather, WeatherReading } from '../../shared/types';

const USER_AGENT = 'ASCENDRA/1.0 (smart traffic research prototype)';

const DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Heavy rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

const HEAVY = new Set([65, 67, 75, 82, 86, 95, 96, 99]);
const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 66, 71, 73, 80, 81, 85]);

export function classifyWeather(code: number, rainMmPerHour: number, visibilityM: number | null): Weather {
  if (code === 45 || code === 48 || (visibilityM !== null && visibilityM < 1000)) return 'fog';
  if (HEAVY.has(code) || rainMmPerHour >= 7.6) return 'heavy_rain';
  if (RAIN.has(code) || rainMmPerHour >= 0.5) return 'rain';
  return 'clear';
}

export class LiveWeather {
  reading: WeatherReading | null = null;
  error: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private lat: number,
    private lon: number,
    private intervalMin: number,
    private onReading: (reading: WeatherReading) => void,
  ) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMin * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}` +
      '&current=temperature_2m,precipitation,visibility,weather_code,wind_speed_10m&timezone=auto';
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Open-Meteo answered HTTP ${res.status}`);
      const data = (await res.json()) as {
        current: { time: string; interval: number; temperature_2m: number; precipitation: number; visibility?: number; weather_code: number; wind_speed_10m: number };
      };
      const c = data.current;
      const rate = (c.precipitation * 3600) / Math.max(60, c.interval || 900);
      const visibility = typeof c.visibility === 'number' ? c.visibility : null;
      this.reading = {
        temperatureC: c.temperature_2m,
        precipitationMm: c.precipitation,
        visibilityM: visibility,
        weatherCode: c.weather_code,
        windKmh: c.wind_speed_10m,
        condition: classifyWeather(c.weather_code, rate, visibility),
        description: DESCRIPTIONS[c.weather_code] ?? `Weather code ${c.weather_code}`,
        observedAt: c.time,
        fetchedAt: new Date().toISOString(),
      };
      this.error = null;
      this.onReading(this.reading);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
}
