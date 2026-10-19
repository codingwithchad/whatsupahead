import { timeZoneAt } from '../regions';
import { cached } from './cache';
import { forecastAt } from './openMeteo';

/** The weather at the passes' summits if you left at a given time: the worst of them when you'd be there. */
export interface CrossingSlot {
	/** Minutes from now until you'd leave. */
	leaveIn: number;
	/** When you'd be at that pass's summit. */
	at: number;
	tempF: number | null;
	snowIn: number;
	level: 'snow' | 'freezing' | 'clear';
	/** The pass this slot's weather is for. */
	pass: string;
}

/**
 * When to leave, from when snow reaches the summit in the next day: leave before `leaveBefore` to cross ahead of it,
 * or after `leaveAfter` once it has passed. Times are instants; null where there's no such time in the next day.
 */
export interface LeaveAdvice {
	/** The first stretch of snow at the summit that a crossing in the next 24 hours would meet. */
	snowFrom: number | null;
	snowUntil: number | null;
	leaveBefore: number | null;
	leaveAfter: number | null;
	/** Freezing at the summit at some time you could cross, without snow (ice is possible). */
	freezing: boolean;
}

/** When to leave to miss the snow at every pass on the drive. */
export interface CrossingAdvice {
	/** Each pass where a crossing would meet snow, in road order, with when it snows at its summit. */
	snow: { pass: string; from: number; until: number }[];
	leaveBefore: number | null;
	leaveAfter: number | null;
	freezing: boolean;
}

export interface Crossing {
	/** The passes on the drive, in road order. */
	passes: { name: string; feet: number | null }[];
	timeZone: string;
	slots: CrossingSlot[];
	advice: CrossingAdvice;
}

/** A pass on the drive and the minutes from the start to its summit. */
export interface CrossingStop {
	pass: { id: string; name: string; lat: number; lon: number; elevation_ft?: number };
	minutesToPass: number;
}

type Hourly = { time: string[]; temperature_2m: number[]; snowfall: number[] };

const HOUR = 3_600_000;
const QUARTER = 15 * 60_000;
/** How far ahead a drive page plans: the next 24 hours. */
const AHEAD_HOURS = 24;

/** Leave now, then at the top of each hour for the next day (11 PM, 12 AM, 1 AM...), as minutes from now. */
export function leaveTimes(now: number): number[] {
	const next = Math.ceil((now + 60_000) / HOUR) * HOUR;
	return [
		0,
		...Array.from({ length: AHEAD_HOURS }, (_, h) => Math.round((next + h * HOUR - now) / 60_000))
	];
}

/**
 * The snow a crossing in the next day would meet, and when to leave to miss it. Open-Meteo's snowfall at each hour
 * is what falls in the hour before it, so an hour with snow means snow from an hour before its time until it. A dry
 * hour between two snowy ones doesn't end the storm.
 */
export function leaveAdvice(
	hourly: { times: number[]; snowfall: number[]; temperature: number[] },
	minutesToPass: number,
	now: number
): LeaveAdvice {
	const drive = minutesToPass * 60_000;
	const first = now + drive;
	const last = now + AHEAD_HOURS * HOUR + drive;
	const snowy = (i: number) => (hourly.snowfall[i] ?? 0) >= 0.1;
	let from: number | null = null;
	let until: number | null = null;
	for (let i = 0; i < hourly.times.length; i++) {
		const end = hourly.times[i];
		if (end <= first || end - HOUR > last) continue;
		if (snowy(i)) {
			if (from === null) from = Math.max(end - HOUR, first);
			until = end;
		} else if (from !== null && !(snowy(i + 1) && hourly.times[i + 1] - HOUR <= last)) break;
	}
	const freezing = hourly.times.some(
		(t, i) => t > first && t - HOUR <= last && !snowy(i) && (hourly.temperature[i] ?? 99) <= 32
	);
	if (from === null)
		return { snowFrom: null, snowUntil: null, leaveBefore: null, leaveAfter: null, freezing };
	// Still snowing past the next day's crossings: no "after" to give.
	const next = hourly.times.indexOf(until! + HOUR);
	const keepsOn = next !== -1 && snowy(next) && until! >= last;
	const before = Math.floor((from - drive) / QUARTER) * QUARTER;
	const after = Math.ceil((until! - drive) / QUARTER) * QUARTER;
	return {
		snowFrom: from,
		snowUntil: until,
		// Already snowing by the time you could get there: there's no beating it.
		leaveBefore: from > first && before > now ? before : null,
		leaveAfter: !keepsOn && after <= now + AHEAD_HOURS * HOUR ? after : null,
		freezing
	};
}

/**
 * The advice for a drive over several passes: leave before the snow reaches the first summit it reaches, or after
 * it has passed the last one. A pass already snowing by the time you could get there leaves no "before"; one where
 * it keeps on all day leaves no "after".
 */
export function combineAdvice(per: { pass: string; advice: LeaveAdvice }[]): CrossingAdvice {
	const freezing = per.some((p) => p.advice.freezing);
	const snowy = per.filter((p) => p.advice.snowFrom !== null);
	const befores = snowy.map((p) => p.advice.leaveBefore);
	const afters = snowy.map((p) => p.advice.leaveAfter);
	return {
		snow: snowy.map((p) => ({
			pass: p.pass,
			from: p.advice.snowFrom!,
			until: p.advice.snowUntil!
		})),
		leaveBefore:
			snowy.length && !befores.includes(null) ? Math.min(...(befores as number[])) : null,
		leaveAfter: snowy.length && !afters.includes(null) ? Math.max(...(afters as number[])) : null,
		freezing
	};
}

const RANK: Record<CrossingSlot['level'], number> = { snow: 2, freezing: 1, clear: 0 };

/** One summit's hourly forecast at its own height, kept 30 minutes. */
const summitHourly = (pass: CrossingStop['pass']) =>
	cached(`crossing:${pass.id}`, 30 * 60_000, async () => {
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

/**
 * "Best time to cross": the summit forecasts for each time you could leave in the next day, so you can see whether
 * a storm comes before, while or after you'd cross, and when to leave to miss it (looked up at 10 PM: "leave before
 * 5:30 AM"). Every pass on the drive counts: Bellevue to Wenatchee is Snoqualmie and then Blewett, and the snow may
 * reach the lower one first. A pass whose forecast doesn't answer is left out.
 */
export async function crossingTimes(
	stops: CrossingStop[],
	now = Date.now()
): Promise<Crossing | null> {
	const read = await Promise.all(
		stops.map(async (stop) => {
			try {
				const hourly = await summitHourly(stop.pass);
				return { ...stop, hourly, times: hourly.time.map((t) => Date.parse(`${t}:00Z`)) };
			} catch (err) {
				console.warn(`[crossing] ${stop.pass.id}: ${(err as Error).message}`);
				return null;
			}
		})
	);
	const known = read.filter((r): r is NonNullable<typeof r> => r !== null);
	if (!known.length) return null;
	const slots = leaveTimes(now).flatMap((leaveIn): CrossingSlot[] => {
		const each = known.flatMap(({ pass, minutesToPass, hourly, times }): CrossingSlot[] => {
			const at = now + (leaveIn + minutesToPass) * 60_000;
			// The hour you'd be there: snowfall is the amount in the hour before each time, so take the next one.
			const i = times.findIndex((t) => t > at);
			if (i === -1) return [];
			const tempF = Math.round(hourly.temperature_2m[i] ?? NaN);
			const snowIn = hourly.snowfall[i] ?? 0;
			const sure = Number.isFinite(tempF);
			return [
				{
					leaveIn,
					at,
					tempF: sure ? tempF : null,
					snowIn,
					level: snowIn >= 0.1 ? 'snow' : sure && tempF <= 32 ? 'freezing' : 'clear',
					pass: pass.name
				}
			];
		});
		// The worst summit at that time, the colder one between two alike.
		const worst = each.sort(
			(a, b) => RANK[b.level] - RANK[a.level] || (a.tempF ?? 99) - (b.tempF ?? 99)
		)[0];
		return worst ? [worst] : [];
	});
	if (!slots.length) return null;
	const advice = combineAdvice(
		known.map(({ pass, minutesToPass, hourly, times }) => ({
			pass: pass.name,
			advice: leaveAdvice(
				{ times, snowfall: hourly.snowfall, temperature: hourly.temperature_2m },
				minutesToPass,
				now
			)
		}))
	);
	return {
		passes: known.map(({ pass }) => ({ name: pass.name, feet: pass.elevation_ft ?? null })),
		timeZone: timeZoneAt(known[0].pass.lat, known[0].pass.lon),
		slots,
		advice
	};
}
