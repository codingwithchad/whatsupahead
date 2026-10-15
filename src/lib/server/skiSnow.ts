import type { Point } from '../geo';
import { mountainStation, snowReading, snowSinceSix, todayAt, type AwdbSeries } from '../mountain';
import { timeZoneAt } from '../regions';
import { cachedMany } from './cache';
import { stations } from './mountain';
import { forecastAt } from './openMeteo';

const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';
const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';
const HOUR = 3600_000;

/** Snow at a ski area: the nearest SNOTEL gauge, and Open-Meteo's snowfall for the rest of today. */
export interface SkiSnow {
	/** The gauge, as USDA names it, its height and how far from the ski area. */
	station: string | null;
	stationFeet: number | null;
	miles: number | null;
	link: string | null;
	depthIn: number | null;
	change24: number | null;
	sinceSix: number | null;
	/** When the gauge last reported. */
	at: number | null;
	/** Snow forecast from now until midnight there, in inches. */
	forecastIn: number | null;
	/** The ski area's time zone, for the gauge's time. */
	timeZone: string;
}

type Place = Point & { id: string };
/** A place to forecast, at the height of its gauge on the mountain when there is one. */
type ForecastPlace = Place & { feet?: number };

/** The hourly readings of many gauges in one request to USDA, each kept 30 minutes. */
async function gaugeReadings(triplets: string[]): Promise<Map<string, AwdbSeries[]>> {
	return cachedMany(
		triplets.map((t) => `mountain:series:${t}`),
		30 * 60_000,
		async (missing) => {
			const ids = missing.map((k) => k.slice('mountain:series:'.length));
			// Station clocks are behind UTC, so a begin date two days back in UTC always covers the last 24 hours.
			const begin = new Date(Date.now() - 48 * HOUR).toISOString().slice(0, 13).replace('T', ' ');
			const res = await fetch(
				`${AWDB}/data?stationTriplets=${encodeURIComponent(ids.join(','))}&elements=SNWD,TOBS&duration=HOURLY&beginDate=${encodeURIComponent(`${begin}:00`)}&endDate=2100-01-01`,
				{ headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) }
			);
			if (!res.ok) throw new Error(`snow gauges answered ${res.status}`);
			const body = (await res.json()) as { stationTriplet?: string; data?: AwdbSeries[] }[];
			return new Map(
				body
					.filter((b) => b.stationTriplet)
					.map((b) => [`mountain:series:${b.stationTriplet}`, b.data ?? []] as const)
			);
		}
	).then((m) => new Map([...m].map(([k, v]) => [k.slice('mountain:series:'.length), v])));
}

type Hourly = { time: string[]; snowfall: number[] };

/**
 * Open-Meteo's snowfall from now until midnight at each place, in one request, each kept 30 minutes. Asked for at
 * the height of the ski area's gauge, so it is the mountain's snow, matching the gauge's numbers.
 */
async function snowForecast(places: ForecastPlace[], now: number): Promise<Map<string, number>> {
	const byId = new Map(places.map((p) => [`ski-forecast:${p.id}`, p]));
	const got = await cachedMany([...byId.keys()], 30 * 60_000, async (missing) => {
		const asked = missing.map((k) => byId.get(k)!);
		const list = await forecastAt<{ hourly: Hourly }>(asked, {
			hourly: 'snowfall',
			precipitation_unit: 'inch',
			timezone: 'GMT',
			forecast_days: '2'
		});
		return new Map(
			asked.map((p, i) => {
				const end = todayAt(0, timeZoneAt(p.lat, p.lon), now) + 24 * HOUR;
				const hourly = list[i].hourly;
				let sum = 0;
				hourly.time.forEach((t, h) => {
					const at = Date.parse(`${t}:00Z`);
					// Each hour's snowfall is for the hour before its time.
					if (at > now && at - HOUR < end) sum += hourly.snowfall[h] ?? 0;
				});
				return [`ski-forecast:${p.id}`, Math.round(sum * 10) / 10] as const;
			})
		);
	});
	return new Map([...got].map(([k, v]) => [k.slice('ski-forecast:'.length), v]));
}

/** Snow at each ski area, by id. Parts that don't answer are left null; nothing is made up. */
export async function skiSnow(places: Place[], now = Date.now()): Promise<Record<string, SkiSnow>> {
	const list = await stations().catch(() => []);
	// The highest gauge near: the snow on the slopes, not down at the road (see mountainStation).
	const near = new Map(places.map((p) => [p.id, mountainStation(list, p)]));
	const triplets = [...new Set([...near.values()].flatMap((s) => (s ? [s.stationTriplet] : [])))];
	const [readings, forecast] = await Promise.all([
		triplets.length
			? gaugeReadings(triplets).catch((err) => {
					console.warn(`[ski-snow] gauges: ${(err as Error).message}`);
					return new Map<string, AwdbSeries[]>();
				})
			: new Map<string, AwdbSeries[]>(),
		snowForecast(
			places.map((p) => ({ ...p, feet: near.get(p.id)?.elevation })),
			now
		).catch((err) => {
			console.warn(`[ski-snow] forecast: ${(err as Error).message}`);
			return new Map<string, number>();
		})
	]);
	const out: Record<string, SkiSnow> = {};
	for (const p of places) {
		const station = near.get(p.id) ?? null;
		const reading = station
			? snowReading(station, readings.get(station.stationTriplet) ?? [])
			: null;
		// A reading more than a day old is not today's snow.
		const fresh = reading && now - reading.at < 26 * HOUR ? reading : null;
		out[p.id] = {
			station: station?.name ?? null,
			stationFeet: station?.elevation ?? null,
			miles: station ? Math.round(station.miles * 10) / 10 : null,
			link: reading?.link ?? null,
			depthIn: fresh ? fresh.depthIn : null,
			change24: fresh ? fresh.change24 : null,
			sinceSix: fresh ? snowSinceSix(fresh.hourly, timeZoneAt(p.lat, p.lon), now) : null,
			at: fresh?.at ?? null,
			forecastIn: forecast.get(p.id) ?? null,
			timeZone: timeZoneAt(p.lat, p.lon)
		};
	}
	return out;
}
