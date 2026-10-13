import {
	alertsOnRoute,
	caltransClosure,
	chainControlsOnRoute,
	closuresOnRoute,
	odotClosure,
	samplePoints,
	wsdotClosure,
	type NwsAlert,
	type RoadClosure,
	type RoadWarnings,
	type RouteAlert,
	type Sample,
	type WsdotAlert
} from '../roadAhead';
import { regionAt } from '../regions';
import {
	surfaceOnRoute,
	surfaceReading,
	type ScanwebStation,
	type SurfaceReading
} from '../roadSurface';
import { cumulativeMiles, type LatLon } from '../route';
import { cached, cachedStale } from './cache';
import { allow } from './rateLimit';
import { idahoClosure, idahoSurface } from '../idaho';
import {
	caltransCheckpoints,
	caltransClosures,
	idahoFeeds,
	nevadaFeeds,
	odotFeeds
} from './passes';
import { nearestTown } from './gazetteer';

const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';
const NWS = 'https://api.weather.gov';
const WSDOT_SURFACE = 'https://wsdot.wa.gov/Traffic/api/api/Scanweb';
const WSDOT_ALERTS =
	'https://wsdot.wa.gov/Traffic/api/HighwayAlerts/HighwayAlertsREST.svc/GetAlertsAsJson';

/** WSDOT road weather station readings with a pavement temperature, or null when WSDOT can't be reached. */
async function wsdotSurface(): Promise<SurfaceReading[] | null> {
	const key = process.env.WSDOT_CODE;
	if (!key) return null;
	try {
		const stations = await cachedStale('road:wsdot-surface', 5 * 60 * 1000, () =>
			getJson<ScanwebStation[]>(`${WSDOT_SURFACE}?AccessCode=${encodeURIComponent(key)}`)
		);
		const now = Date.now();
		return stations
			.map((s) => surfaceReading(s, now))
			.filter((r): r is SurfaceReading => r !== null);
	} catch (err) {
		console.warn(`[road] wsdot surface: ${(err as Error).message}`);
		return null;
	}
}

async function getJson<T>(
	url: string,
	headers: Record<string, string> = {},
	ms = 10000
): Promise<T> {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
	if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
	return (await res.json()) as T;
}

/** WSDOT's highway alerts that close the whole road, or null when WSDOT can't be reached. */
async function wsdotClosures(): Promise<RoadClosure[] | null> {
	const key = process.env.WSDOT_CODE;
	if (!key) return null;
	try {
		const alerts = await cachedStale('road:wsdot-alerts', 2 * 60 * 1000, () =>
			getJson<WsdotAlert[]>(`${WSDOT_ALERTS}?AccessCode=${encodeURIComponent(key)}`)
		);
		const now = Date.now();
		return alerts.map((a) => wsdotClosure(a, now)).filter((c): c is RoadClosure => c !== null);
	} catch (err) {
		console.warn(`[road] wsdot alerts: ${(err as Error).message}`);
		return null;
	}
}

// Which NWS zones a point is in never changes, so it is kept for a long time, in its own bounded map (a long
// drive has dozens of points and would otherwise crowd the main cache).
const zoneCache = new Map<string, string[]>();
const MAX_ZONE_POINTS = 20000;

async function zonesAt(lat: number, lon: number): Promise<string[]> {
	const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
	const hit = zoneCache.get(key);
	if (hit) return hit;
	// A new drive looks up a few dozen points once; this keeps a flood of made-up routes off the Weather Service.
	if (!allow('upstream:nws-points', 240)) throw new Error('weather service busy');
	const p = await getJson<{
		properties: { forecastZone?: string; county?: string; fireWeatherZone?: string };
	}>(`${NWS}/points/${key}`, { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' }, 6000);
	const zones = [p.properties.forecastZone, p.properties.county, p.properties.fireWeatherZone]
		.filter((z): z is string => Boolean(z))
		.map((z) => z.slice(z.lastIndexOf('/') + 1));
	if (zoneCache.size >= MAX_ZONE_POINTS) zoneCache.delete(zoneCache.keys().next().value!);
	zoneCache.set(key, zones);
	return zones;
}

/** Look up many points a few at a time; points that fail are left out. */
async function withZones(
	points: Omit<Sample, 'zones'>[]
): Promise<{ samples: Sample[]; failed: number }> {
	const samples: Sample[] = [];
	let failed = 0;
	let i = 0;
	const worker = async () => {
		while (i < points.length) {
			const p = points[i++];
			try {
				samples.push({ ...p, zones: await zonesAt(p.lat, p.lon) });
			} catch {
				failed++;
			}
		}
	};
	await Promise.all(Array.from({ length: 6 }, worker));
	return { samples: samples.sort((a, b) => a.along - b.along), failed };
}

/** Every active NWS alert in the states a drive can touch. */
function activeAlerts(): Promise<NwsAlert[]> {
	return cached('road:nws-alerts', 3 * 60 * 1000, async () => {
		const body = await getJson<{ features?: NwsAlert[] }>(
			`${NWS}/alerts/active?area=WA,OR,CA,ID,NV&status=actual`,
			{ 'User-Agent': USER_AGENT, Accept: 'application/geo+json' }
		);
		return body.features ?? [];
	});
}

async function weatherAlerts(
	route: LatLon[],
	cum: number[],
	minutes: number,
	departAt: number
): Promise<RouteAlert[] | null> {
	try {
		const [alerts, { samples, failed }] = await Promise.all([
			activeAlerts(),
			withZones(samplePoints(route, cum, minutes, departAt))
		]);
		// Too many gaps and a warning could be missed: say it was not checked rather than show a partial list.
		if (!samples.length || failed > samples.length / 4) return null;
		return alertsOnRoute(alerts, samples);
	} catch (err) {
		console.warn(`[road] nws alerts: ${(err as Error).message}`);
		return null;
	}
}

/** Full road closures and weather warnings on the drive, for when you will be at each point. */
export async function roadWarnings(
	route: LatLon[],
	minutes: number,
	departAt: number
): Promise<RoadWarnings> {
	const cum = cumulativeMiles(route);
	const states = new Set(
		route
			.filter((_, i) => i % 20 === 0 || i === route.length - 1)
			.map(([lat, lon]) => regionAt(lat, lon)?.abbr)
	);
	const [wa, or, ca, id, nv, checkpoints, alerts, surface, idSurface] = await Promise.all([
		states.has('WA') ? wsdotClosures() : [],
		states.has('OR')
			? odotFeeds().then((f) =>
					f ? f.incidents.map(odotClosure).filter((c): c is RoadClosure => c !== null) : null
				)
			: [],
		states.has('CA')
			? caltransClosures().then((list) =>
					list
						? list.map((c) => caltransClosure(c)).filter((c): c is RoadClosure => c !== null)
						: null
				)
			: [],
		states.has('ID')
			? idahoFeeds().then((f) =>
					f
						? f.events.map((e) => idahoClosure(e)).filter((c): c is RoadClosure => c !== null)
						: null
				)
			: [],
		states.has('NV')
			? nevadaFeeds().then((f) =>
					f
						? f.events
								.map((e) =>
									idahoClosure(e, Date.now(), {
										source: 'NDOT',
										link: 'https://www.nvroads.com/'
									})
								)
								.filter((c): c is RoadClosure => c !== null)
						: null
				)
			: [],
		states.has('CA') ? caltransCheckpoints() : [],
		weatherAlerts(route, cum, minutes, departAt),
		states.has('WA') ? wsdotSurface() : [],
		states.has('ID')
			? idahoFeeds().then((f) =>
					f
						? f.stations.map((s) => idahoSurface(s)).filter((r): r is SurfaceReading => r !== null)
						: null
				)
			: []
	]);
	const unchecked = [
		wa === null ? 'WSDOT closures' : null,
		or === null ? 'ODOT closures' : null,
		ca === null ? 'Caltrans closures' : null,
		id === null ? 'Idaho closures' : null,
		nv === null ? 'Nevada closures' : null,
		checkpoints === null ? 'Caltrans chain controls' : null,
		alerts === null ? 'National Weather Service warnings' : null,
		surface === null ? 'WSDOT road surface temperatures' : null,
		idSurface === null ? 'Idaho road surface temperatures' : null
	].filter((s): s is string => s !== null);
	return {
		closures: closuresOnRoute(
			[...(wa ?? []), ...(or ?? []), ...(ca ?? []), ...(id ?? []), ...(nv ?? [])],
			route,
			cum
		),
		chainControls: chainControlsOnRoute(checkpoints ?? [], route, cum),
		surface: surfaceOnRoute([...(surface ?? []), ...(idSurface ?? [])], route, cum),
		alerts: (alerts ?? []).map((a) => ({ ...a, near: nearestTown(a.at, 15) })),
		unchecked
	};
}
