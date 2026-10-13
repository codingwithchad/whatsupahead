import type { Point } from '../geo';
import { cached } from './cache';
import { allow } from './rateLimit';
import type { LatLon } from '../route';
import { azureMapsKey, azureRoute } from './azureMaps';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';

export interface DrivingRoute {
	coords: LatLon[];
	miles: number;
	minutes: number;
	/** Miles on very slow roads (unpaved or forest roads): often not plowed, and where GPS detours strand people. */
	roughMiles?: number;
}

interface OsrmRoute {
	distance: number;
	duration: number;
	geometry: { coordinates: [number, number][] };
	legs?: { steps?: { distance: number; duration: number }[] }[];
}

const MPH = 0.44704;

/**
 * Drive time in minutes. OSRM's seconds are used as given, except for long slow stretches (under 10 mph over
 * a mile or more), which are unpaved forest-road segments it rates at walking pace; those count as 25 mph.
 */
export function driveMinutes(route: Pick<OsrmRoute, 'duration' | 'legs'>): number {
	const steps = route.legs?.flatMap((l) => l.steps ?? []);
	if (!steps?.length) return route.duration / 60;
	let seconds = 0;
	for (const s of steps) {
		const slow = s.distance >= 1609 && s.duration > s.distance / (10 * MPH);
		seconds += slow ? s.distance / (25 * MPH) : s.duration;
	}
	return seconds / 60;
}

/** Miles of long stretches OSRM rates under 10 mph: unpaved and forest roads. */
export function roughMiles(route: Pick<OsrmRoute, 'legs'>): number {
	const steps = route.legs?.flatMap((l) => l.steps ?? []) ?? [];
	let meters = 0;
	for (const s of steps)
		if (s.distance >= 1609 && s.duration > s.distance / (10 * MPH)) meters += s.distance;
	return meters / 1609.344;
}

export function toDrivingRoute(route: OsrmRoute): DrivingRoute {
	return {
		roughMiles: roughMiles(route),
		coords: route.geometry.coordinates.map(
			([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5] as LatLon
		),
		miles: route.distance / 1609.344,
		minutes: driveMinutes(route)
	};
}

/**
 * Driving route between two points, through any stops in between (in order). Azure Maps first when it is set up
 * (live traffic), otherwise or on failure the free public OSRM demo server. Results are cached.
 */
export function drivingRoute(
	from: Point,
	to: Point,
	via: Point[] = [],
	{ free = false }: { free?: boolean } = {}
): Promise<DrivingRoute> {
	const stops = [from, ...via, to];
	// `free` (the other ways over the mountains a drive page offers) never spends Azure Maps' allowance.
	const key = `route${free ? '-free' : ''}:${stops.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join('>')}`;
	return cached(key, 10 * 60 * 1000, async () => {
		if (azureMapsKey() && !free) {
			try {
				return await azureRoute(stops);
			} catch (err) {
				console.warn(`[routing] azure maps: ${(err as Error).message}; using OSRM`);
			}
		}
		// The demo server allows about one request a second for everyone using it; stay well under that.
		if (!allow('upstream:osrm', 30)) throw new Error('routing busy');
		const url = `${OSRM}/${stops.map((p) => `${p.lon},${p.lat}`).join(';')}?overview=full&geometries=geojson&steps=true`;
		const res = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) throw new Error(`routing ${res.status}`);
		const body = (await res.json()) as { code: string; routes?: OsrmRoute[] };
		const route = body.routes?.[0];
		if (body.code !== 'Ok' || !route) throw new Error('no route');
		return toDrivingRoute(route);
	});
}
