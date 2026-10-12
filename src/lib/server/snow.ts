import { cached } from './cache';
import { openMeteoAllowed } from './rateLimit';
import { cumulativeMiles, type LatLon } from '../route';
import { snowStretches, winterDay, type SnowSample, type SnowStretch } from '../snowLine';

const MAX_POINTS = 24;
const MIN_SPACING_MILES = 3;
const METERS_TO_FEET = 3.28084;

export interface SnowReport {
	samples: SnowSample[];
	stretches: SnowStretch[];
}

/** Points spread along the route, always including both ends. */
export function samplePoints(route: LatLon[]): { along: number; lat: number; lon: number }[] {
	const cum = cumulativeMiles(route);
	const total = cum[cum.length - 1] ?? 0;
	const count = Math.max(2, Math.min(MAX_POINTS, Math.ceil(total / MIN_SPACING_MILES) + 1));
	const out: { along: number; lat: number; lon: number }[] = [];
	let j = 0;
	for (let i = 0; i < count; i++) {
		const target = (total * i) / (count - 1);
		while (j < cum.length - 1 && cum[j] < target) j++;
		out.push({ along: target, lat: route[j][0], lon: route[j][1] });
	}
	return out;
}

type Hourly = { time: string[]; temperature_2m: number[]; snowfall: number[] };
type Place = { elevation: number; hourly: Hourly };

/**
 * Where along a drive it will be snowing or freezing, for when you actually get there.
 * Uses Open-Meteo's free forecast (temperature, snowfall and ground height for each point).
 * Returns null when the forecast is not available, so the trip page just leaves this out.
 */
export async function snowAlong(
	route: LatLon[],
	startAt: number,
	minutes: number,
	demo = false
): Promise<SnowReport | null> {
	const points = samplePoints(route);
	const total = points[points.length - 1].along || 1;
	const hour = Math.floor(startAt / 3_600_000);
	const key = `snow${demo ? '-demo' : ''}:${hour}:${points.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';')}:${Math.round(minutes / 15)}`;
	try {
		return await cached(key, 30 * 60 * 1000, async () => {
			if (!openMeteoAllowed()) throw new Error('open-meteo busy');
			const url = new URL('https://api.open-meteo.com/v1/forecast');
			url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(3)).join(','));
			url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(3)).join(','));
			url.searchParams.set('hourly', 'temperature_2m,snowfall');
			url.searchParams.set('temperature_unit', 'fahrenheit');
			url.searchParams.set('precipitation_unit', 'inch');
			url.searchParams.set('timezone', 'GMT');
			url.searchParams.set('forecast_days', '3');
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
			if (!res.ok) throw new Error(`open-meteo ${res.status}`);
			const body = (await res.json()) as Place | Place[];
			const list = Array.isArray(body) ? body : [body];
			if (list.length !== points.length) throw new Error('open-meteo returned the wrong count');
			const samples: SnowSample[] = points.map((p, i) => {
				const { hourly, elevation } = list[i];
				const when = startAt + (minutes * 60_000 * p.along) / total;
				const target = new Date(Math.round(when / 3_600_000) * 3_600_000)
					.toISOString()
					.slice(0, 13);
				let idx = hourly.time.findIndex((t) => t.startsWith(target));
				if (idx < 0) idx = 0;
				const feet = Math.round(elevation * METERS_TO_FEET);
				// The demo keeps the real heights of the road but swaps in an invented winter day.
				const weather = demo
					? winterDay(feet)
					: { tempF: Math.round(hourly.temperature_2m[idx]), snowIn: hourly.snowfall[idx] ?? 0 };
				return { along: p.along, feet, ...weather };
			});
			return { samples, stretches: snowStretches(samples) };
		});
	} catch (err) {
		console.warn(`[snow] forecast unavailable (${(err as Error).message})`);
		return null;
	}
}
