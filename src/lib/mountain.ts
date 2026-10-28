import { distanceMiles, type Point } from './geo';
import { inGeometry } from './roadAhead';

// Snow on the ground (USDA SNOTEL stations) and avalanche danger (avalanche.org zones) near a mountain pass.

/** One SNOTEL station (the fields we use). */
export interface SnotelStation {
	stationTriplet: string;
	name: string;
	elevation: number;
	latitude: number;
	longitude: number;
	/** Hours from UTC of the station's clock (standard time all year). */
	dataTimeZone?: number;
}

export interface SnowReading {
	station: string;
	elevation_ft: number;
	miles: number;
	depthIn: number;
	/** Change over the last 24 hours, when there is a reading from then. */
	change24: number | null;
	/** Every hourly depth reading of the last day or two, oldest first (for "new snow since 6 AM"). */
	hourly: { t: number; in: number }[];
	/** The water in the snow (snow water equivalent) each hour, oldest first: new snow adds to it, wobble doesn't. */
	water: { t: number; in: number }[];
	tempF: number | null;
	at: number;
	link: string;
}

const NEAR_MILES = 10;
const NEAR_FEET = 2000;
/** A gauge for the road: no more than this far above or below the road's height. */
const ROAD_FEET = 1000;

/** The nearest station within 10 miles whose height is within 2,000 feet of the pass (or null). */
export function nearestStation(
	stations: SnotelStation[],
	p: Point & { elevation_ft?: number }
): (SnotelStation & { miles: number }) | null {
	return (
		withMiles(stations, p)
			.filter(
				(s) => p.elevation_ft === undefined || Math.abs(s.elevation - p.elevation_ft) <= NEAR_FEET
			)
			.sort((a, b) => a.miles - b.miles)[0] ?? null
	);
}

const withMiles = (stations: SnotelStation[], p: Point) =>
	stations
		.map((s) => ({ ...s, miles: distanceMiles(p, { lat: s.latitude, lon: s.longitude }) }))
		.filter((s) => s.miles <= NEAR_MILES);

// Two kinds of people read snow numbers. Someone driving over a pass needs the snow at the road: a gauge 1,000 feet
// up the hill can show a foot of new snow while the highway only got rain. Someone going skiing needs the snow on
// the mountain, which is often well above the road. So each picks its own gauge, and the page says how high it is.

/** For the road: the gauge closest in height to the road (within 10 miles and 1,000 feet of it), or null. */
export function roadStation(
	stations: SnotelStation[],
	pass: Point & { elevation_ft?: number }
): (SnotelStation & { miles: number }) | null {
	const road = pass.elevation_ft;
	if (road === undefined) return null;
	return (
		withMiles(stations, pass)
			.filter((s) => Math.abs(s.elevation - road) <= ROAD_FEET)
			.sort(
				(a, b) => Math.abs(a.elevation - road) - Math.abs(b.elevation - road) || a.miles - b.miles
			)[0] ?? null
	);
}

/** For skiing: the highest gauge within 10 miles, the nearest to the snow on the slopes, or null. */
export function mountainStation(
	stations: SnotelStation[],
	place: Point
): (SnotelStation & { miles: number }) | null {
	return (
		withMiles(stations, place).sort((a, b) => b.elevation - a.elevation || a.miles - b.miles)[0] ??
		null
	);
}

/** One element's hourly values from the AWDB data service. */
export interface AwdbSeries {
	stationElement: { elementCode: string };
	values: { date: string; value: number | null }[];
}

/**
 * USDA's table of a gauge's last 48 hours (snow depth, snow water, temperature), so anyone can check our numbers.
 * The station's own page shows none of them.
 */
function gaugeTable(triplet: string): string {
	return `https://wcc.sc.egov.usda.gov/reportGenerator/view/customSingleStationReport/hourly/start_of_period/${triplet}%7Cid=%22%22%7Cname/-47,0/SNWD::value,WTEQ::value,TOBS::value`;
}

/** The latest snow depth, its change over 24 hours and the temperature, from hourly readings. */
export function snowReading(
	station: SnotelStation & { miles: number },
	series: AwdbSeries[]
): SnowReading | null {
	const offset = station.dataTimeZone ?? -8;
	const sign = offset < 0 ? '-' : '+';
	const zone = `${sign}${String(Math.abs(offset)).padStart(2, '0')}:00`;
	const time = (d: string) => Date.parse(`${d.replace(' ', 'T')}:00${zone}`);
	const valid = (code: string) =>
		(series.find((s) => s.stationElement.elementCode === code)?.values ?? []).filter(
			(v): v is { date: string; value: number } => typeof v.value === 'number'
		);
	const depth = valid('SNWD');
	const last = depth.at(-1);
	if (!last) return null;
	const at = time(last.date);
	// The reading closest to 24 hours before the latest, if there is one within an hour of it.
	const dayBefore = depth
		.map((v) => ({ v, gap: Math.abs(at - 24 * 3600_000 - time(v.date)) }))
		.filter((x) => x.gap <= 3600_000)
		.sort((a, b) => a.gap - b.gap)[0]?.v;
	const temp = valid('TOBS').at(-1);
	return {
		station: station.name,
		elevation_ft: station.elevation,
		miles: station.miles,
		depthIn: Math.max(0, last.value),
		change24: dayBefore ? last.value - dayBefore.value : null,
		hourly: depth.map((v) => ({ t: time(v.date), in: Math.max(0, v.value) })),
		water: valid('WTEQ').map((v) => ({ t: time(v.date), in: Math.max(0, v.value) })),
		tempF: temp && time(temp.date) >= at - 3 * 3600_000 ? temp.value : null,
		at,
		link: gaugeTable(station.stationTriplet)
	};
}

/**
 * New snow at the gauge between two times, in inches, from its hourly readings: the reading nearest each time
 * (within 45 minutes of the start, and up to 90 minutes before the end, as gauges report late). Null when
 * there is no reading near either time. Snow settles, so a small loss is reported as it is, not hidden.
 */
export function snowBetween(
	hourly: { t: number; in: number }[],
	from: number,
	to: number
): number | null {
	const near = (t: number, before: number, after: number) =>
		hourly
			.filter((h) => h.t >= t - before && h.t <= t + after)
			.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
	const a = near(from, 45 * 60_000, 45 * 60_000);
	const b = near(to, 90 * 60_000, 15 * 60_000);
	return a && b && b.t > a.t ? Math.round(b.in - a.in) : null;
}

/** One avalanche forecast zone from avalanche.org's map layer (the fields we use). */
export interface AvalancheZone {
	geometry: { type: string; coordinates: unknown };
	properties: {
		name: string;
		center: string;
		center_id: string;
		danger: string;
		danger_level: number;
		travel_advice?: string;
		link: string;
		off_season?: boolean;
	};
}

export interface AvalancheDanger {
	zone: string;
	center: string;
	/** 1 low to 5 extreme; null when there is no rating (off season or not issued). */
	level: number | null;
	danger: string;
	link: string;
}

const DANGER = ['', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];

/** The forecast zone the point is in, and its danger today. */
export function avalancheAt(zones: AvalancheZone[], p: Point): AvalancheDanger | null {
	const z = zones.find((f) => f.geometry && inGeometry(p, f.geometry));
	if (!z) return null;
	const level = z.properties.danger_level >= 1 ? Math.min(5, z.properties.danger_level) : null;
	return {
		zone: z.properties.name,
		center: z.properties.center,
		level,
		danger: level ? DANGER[level] : 'No rating',
		link: z.properties.link
	};
}

/** The moment it is `hour`:00 today where `timeZone` is ("America/Los_Angeles"). */
export function todayAt(hour: number, timeZone: string, now = Date.now()): number {
	const ymd = new Date(now).toLocaleDateString('en-CA', { timeZone });
	const guess = Date.parse(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
	const shown = Date.parse(
		`${new Date(guess).toLocaleString('sv-SE', { timeZone }).replace(' ', 'T')}Z`
	);
	return guess - (shown - guess);
}

/** New snow at the gauge since 6 AM today where it is; null before 6 AM or without readings. */
export function snowSinceSix(
	hourly: { t: number; in: number }[],
	timeZone: string,
	now = Date.now()
): number | null {
	const six = todayAt(6, timeZone, now);
	return now > six + 3600_000 ? snowBetween(hourly, six, now) : null;
}
