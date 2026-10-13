import type { Point } from './geo';
import { projectNear, type LatLon } from './route';

// Road surface temperature from WSDOT's roadside weather stations: a measurement of the pavement itself, so
// "the road is at 31°F" is known when it happens, not forecast. Ice forms on wet pavement at or below freezing,
// often in shade and after sunset while the air is still above freezing.

/** One WSDOT road weather station reading (the fields we use; temperatures in °C, height in metres). */
export interface ScanwebStation {
	StationId: number;
	StationName: string;
	Latitude: number;
	Longitude: number;
	ReadingTime: string | null;
	AirTemperature: number | null;
	PrecipitationPast6Hours?: number | null;
	SurfaceMeasurements?: { SurfaceTemperature: number | null }[] | null;
}

export interface SurfaceReading extends Point {
	name: string;
	surfaceF: number;
	airF: number | null;
	/** Wet in the last 6 hours (rain or snow), when ice on a freezing surface is most likely. */
	wet: boolean;
	at: number;
}

export type SurfaceOnRoute = SurfaceReading & { along: number };

const toF = (c: number) => Math.round((c * 9) / 5 + 32);

/** "2026-10-12T13:14:00" in Pacific time, to a time in ms. */
// Made once: building a date formatter is slow, and a route has dozens of stations.
const PACIFIC_OFFSET = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/Los_Angeles',
	timeZoneName: 'shortOffset'
});

export function pacificTime(local: string | null | undefined): number {
	const asUtc = Date.parse(`${local}Z`);
	if (!Number.isFinite(asUtc)) return NaN;
	const offset = PACIFIC_OFFSET.formatToParts(asUtc)
		.find((p) => p.type === 'timeZoneName')
		?.value.match(/GMT([+-]\d+)/)?.[1];
	return asUtc - Number(offset ?? -8) * 3600_000;
}

/** The coldest working pavement sensor at a station, or null when it has none or the reading is old. */
export function surfaceReading(
	s: ScanwebStation,
	now = Date.now(),
	maxAgeMs = 2 * 3600_000
): SurfaceReading | null {
	const temps = (s.SurfaceMeasurements ?? [])
		.map((m) => m.SurfaceTemperature)
		.filter((t): t is number => typeof t === 'number' && t > -40 && t < 70);
	if (!temps.length || !s.Latitude || !s.Longitude) return null;
	const at = pacificTime(s.ReadingTime);
	if (!(now - at <= maxAgeMs)) return null;
	return {
		name: s.StationName.replace(/\s+/g, ' ').trim(),
		lat: s.Latitude,
		lon: s.Longitude,
		surfaceF: toF(Math.min(...temps)),
		airF: typeof s.AirTemperature === 'number' ? toF(s.AirTemperature) : null,
		wet: (s.PrecipitationPast6Hours ?? 0) > 0,
		at
	};
}

/** Readings beside the road you will drive (within half a mile), in driving order. */
export function surfaceOnRoute(
	readings: SurfaceReading[],
	route: LatLon[],
	cum: number[],
	miles = 0.5
): SurfaceOnRoute[] {
	return readings
		.map((r) => ({ r, p: projectNear(r, route, cum, miles) }))
		.filter((x): x is { r: SurfaceReading; p: NonNullable<typeof x.p> } => x.p !== null)
		.map(({ r, p }) => ({ ...r, along: p.along }))
		.sort((a, b) => a.along - b.along);
}

/** At or below freezing: ice can form. Up to 35°F: close, and falling fast after dark. */
export const FREEZING_F = 32;
export const NEAR_FREEZING_F = 35;
