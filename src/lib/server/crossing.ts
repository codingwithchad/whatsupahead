import { cached } from './cache';
import { forecastAt } from './openMeteo';

/** The weather at a pass's summit if you left at a given time. */
export interface CrossingSlot {
	/** Minutes from now until you'd leave. */
	leaveIn: number;
	/** When you'd be at the summit. */
	at: number;
	tempF: number | null;
	snowIn: number;
	level: 'snow' | 'freezing' | 'clear';
}

export interface Crossing {
	pass: string;
	feet: number | null;
	slots: CrossingSlot[];
}

type Hourly = { time: string[]; temperature_2m: number[]; snowfall: number[] };

/** Leave now, or in 1 to 12 hours (as far ahead as a drive page plans). */
const LEAVE_HOURS = Array.from({ length: 13 }, (_, h) => h * 60);

/**
 * "Best time to cross": the summit forecast for each time you could leave, so you can see whether a storm comes
 * before, while or after you'd cross. One forecast at the summit's own height, kept 30 minutes.
 */
export async function crossingTimes(
	pass: { id: string; name: string; lat: number; lon: number; elevation_ft?: number },
	minutesToPass: number,
	now = Date.now()
): Promise<Crossing | null> {
	try {
		const hourly = await cached(`crossing:${pass.id}`, 30 * 60_000, async () => {
			const [place] = await forecastAt<{ hourly: Hourly }>(
				[{ lat: pass.lat, lon: pass.lon, feet: pass.elevation_ft }],
				{
					hourly: 'temperature_2m,snowfall',
					temperature_unit: 'fahrenheit',
					precipitation_unit: 'inch',
					timezone: 'GMT',
					forecast_days: '3'
				}
			);
			return place.hourly;
		});
		const times = hourly.time.map((t) => Date.parse(`${t}:00Z`));
		const slots = LEAVE_HOURS.flatMap((leaveIn): CrossingSlot[] => {
			const at = now + (leaveIn + minutesToPass) * 60_000;
			// The hour you'd be there: snowfall is the amount in the hour before each time, so take the next one.
			const i = times.findIndex((t) => t > at);
			if (i === -1) return [];
			const tempF = Math.round(hourly.temperature_2m[i] ?? NaN);
			const snowIn = hourly.snowfall[i] ?? 0;
			const known = Number.isFinite(tempF);
			return [
				{
					leaveIn,
					at,
					tempF: known ? tempF : null,
					snowIn,
					level: snowIn >= 0.1 ? 'snow' : known && tempF <= 32 ? 'freezing' : 'clear'
				}
			];
		});
		return slots.length ? { pass: pass.name, feet: pass.elevation_ft ?? null, slots } : null;
	} catch (err) {
		console.warn(`[crossing] ${pass.id}: ${(err as Error).message}`);
		return null;
	}
}
