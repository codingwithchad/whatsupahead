import { cached } from './cache';
import { getCatalog } from './catalog';
import { forecastAt } from './openMeteo';
import { alongRoute, cumulativeMiles, type LatLon } from '../route';
import type { Point } from '../geo';
import { snowStretches, winterDay, type SnowSample, type SnowStretch } from '../snowLine';

const MAX_POINTS = 24;
const MIN_SPACING_MILES = 3;
const METERS_TO_FEET = 3.28084;

export interface SnowReport {
	samples: SnowSample[];
	stretches: SnowStretch[];
}

type SamplePoint = { along: number; lat: number; lon: number; feet?: number };

/**
 * Points spread along the route, always including both ends, plus the summit of every pass on the way at its
 * known height: a point every few miles can step right past a summit, and the summit is where snow starts first.
 */
export function samplePoints(
	route: LatLon[],
	passes: (Point & { elevation_ft?: number })[] = []
): SamplePoint[] {
	const cum = cumulativeMiles(route);
	const total = cum[cum.length - 1] ?? 0;
	const count = Math.max(2, Math.min(MAX_POINTS, Math.ceil(total / MIN_SPACING_MILES) + 1));
	const out: SamplePoint[] = [];
	let j = 0;
	for (let i = 0; i < count; i++) {
		const target = (total * i) / (count - 1);
		while (j < cum.length - 1 && cum[j] < target) j++;
		out.push({ along: target, lat: route[j][0], lon: route[j][1] });
	}
	for (const p of alongRoute(passes, route, { corridor: 2, destinationRadius: 0 }))
		if (p.along > 0 && p.along < total)
			out.push({ along: p.along, lat: p.item.lat, lon: p.item.lon, feet: p.item.elevation_ft });
	return out.sort((a, b) => a.along - b.along);
}

type Hourly = { time: string[]; temperature_2m: number[]; snowfall: number[] };
type Place = { elevation: number; hourly: Hourly };

const PARAMS = {
	hourly: 'temperature_2m,snowfall',
	temperature_unit: 'fahrenheit',
	precipitation_unit: 'inch',
	timezone: 'GMT',
	forecast_days: '3'
};

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
	const points = samplePoints(route, getCatalog().passes);
	const total = points[points.length - 1].along || 1;
	const hour = Math.floor(startAt / 3_600_000);
	const key = `snow${demo ? '-demo' : ''}:${hour}:${points.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';')}:${Math.round(minutes / 15)}`;
	try {
		return await cached(key, 30 * 60 * 1000, async () => {
			const list = await forecastAt<Place>(points, PARAMS);
			const samples: SnowSample[] = points.map((p, i) => {
				const { hourly, elevation } = list[i];
				const when = startAt + (minutes * 60_000 * p.along) / total;
				const target = new Date(Math.round(when / 3_600_000) * 3_600_000)
					.toISOString()
					.slice(0, 13);
				let idx = hourly.time.findIndex((t) => t.startsWith(target));
				if (idx < 0) idx = 0;
				const feet = points[i].feet ?? Math.round(elevation * METERS_TO_FEET);
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
