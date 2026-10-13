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
	tempF: number | null;
	at: number;
	link: string;
}

const NEAR_MILES = 10;
const NEAR_FEET = 2000;

/** The nearest station within 10 miles whose height is within 2,000 feet of the pass (or null). */
export function nearestStation(
	stations: SnotelStation[],
	p: Point & { elevation_ft?: number }
): (SnotelStation & { miles: number }) | null {
	return (
		stations
			.map((s) => ({ ...s, miles: distanceMiles(p, { lat: s.latitude, lon: s.longitude }) }))
			.filter(
				(s) =>
					s.miles <= NEAR_MILES &&
					(p.elevation_ft === undefined || Math.abs(s.elevation - p.elevation_ft) <= NEAR_FEET)
			)
			.sort((a, b) => a.miles - b.miles)[0] ?? null
	);
}

/** One element's hourly values from the AWDB data service. */
export interface AwdbSeries {
	stationElement: { elementCode: string };
	values: { date: string; value: number | null }[];
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
	const id = station.stationTriplet.split(':')[0];
	return {
		station: station.name,
		elevation_ft: station.elevation,
		miles: station.miles,
		depthIn: Math.max(0, last.value),
		change24: dayBefore ? last.value - dayBefore.value : null,
		hourly: depth.map((v) => ({ t: time(v.date), in: Math.max(0, v.value) })),
		tempF: temp && time(temp.date) >= at - 3 * 3600_000 ? temp.value : null,
		at,
		link: `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${id}`
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
