import { allowedKinds } from '../../lib/kinds';
import { distanceMiles, isDormant, nearby, parseLatLon } from '../../lib/geo';
import { getCatalog } from '../../lib/server/catalog';
import { getConditions } from '../../lib/server/conditions';
import { geocode } from '../../lib/server/geocode';
import { withForecast } from '../../lib/server/autoForecast';
import { withLiveLinks } from '../../lib/server/live';
import { drivingRoute } from '../../lib/server/routing';
import { snowAlong } from '../../lib/server/snow';
import { weatherOnTheWay } from '../../lib/server/routeWeather';
import { nearestTown } from '../../lib/server/gazetteer';
import { routeStops } from '../../lib/routeWeather';
import { alongRoute, cumulativeMiles, projectOnRoute, thinToTarget } from '../../lib/route';
import type { Camera, FeaturedPlace, Nearby, Place, WeatherSource } from '../../lib/types';
import type { PageServerLoad } from './$types';

const DEFAULT_DESTINATION_RADIUS = 3;
const NEAREST_FALLBACK_MILES = 15;

async function resolve(
	q: string,
	places: FeaturedPlace[]
): Promise<(Place & { featured?: FeaturedPlace }) | null> {
	const text = q.trim();
	if (!text) return null;
	const lower = text.toLowerCase();
	const featured = places.find((p) => p.id === lower || p.name.toLowerCase() === lower);
	if (featured) return { lat: featured.lat, lon: featured.lon, label: featured.name, featured };
	const point = parseLatLon(text);
	if (point) return { ...point, label: 'Your location' };
	return geocode(text);
}

/** Weather sources from the start of the drive to the end, so the strip reads like the road. */
function inDrivingOrder<T extends { lat: number; lon: number }>(
	items: T[],
	coords: [number, number][]
): { item: T; along: number }[] {
	const cum = cumulativeMiles(coords);
	return items
		.map((item) => ({ item, along: projectOnRoute(item, coords, cum).along }))
		.sort((a, b) => a.along - b.along);
}

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const fromQ = url.searchParams.get('from')?.trim() ?? '';
	const toQ = url.searchParams.get('to')?.trim() ?? '';

	// Stops along the way, in order: "lat,lon;lat,lon" (at most 8).
	const via = (url.searchParams.get('via') ?? '')
		.split(';')
		.map((p) => parseLatLon(p))
		.filter((p): p is NonNullable<typeof p> => p !== null)
		.slice(0, 8);
	const fromLabel = url.searchParams.get('fl')?.trim().slice(0, 80) ?? '';
	const toLabel = url.searchParams.get('tl')?.trim().slice(0, 80) ?? '';
	// ?demo=winter swaps in an invented cold day so the snow section can be tried out in summer.
	const demoWinter = url.searchParams.get('demo') === 'winter';
	const showAll = url.searchParams.get('all') === '1';
	// Minutes until you leave (0 = now), so forecasts can be for the time you will actually be there.
	const leaveIn = Math.min(Math.max(Number(url.searchParams.get('in')) || 0, 0), 12 * 60);
	const base = { fromQ: fromLabel || fromQ, toQ: toLabel || toQ, error: null as string | null };
	if (!fromQ || !toQ) return { ...base, trip: null };

	const { cameras, weather, places } = getCatalog();
	let from, to;
	try {
		[from, to] = await Promise.all([resolve(fromQ, places), resolve(toQ, places)]);
	} catch {
		return {
			...base,
			error: 'The location search is not responding. Try again in a moment.',
			trip: null
		};
	}
	if (!from) return { ...base, error: `Couldn't find “${fromQ}”.`, trip: null };
	if (!to) return { ...base, error: `Couldn't find “${toQ}”.`, trip: null };
	if (fromLabel) from.label = fromLabel;
	if (toLabel) to.label = toLabel;
	base.toQ = toLabel || (to.featured?.name ?? toQ);

	let route;
	try {
		route = await drivingRoute(from, to, via);
	} catch {
		return {
			...base,
			error: "Couldn't work out a driving route between those two places.",
			trip: null
		};
	}

	setHeaders({ 'cache-control': 'private, max-age=60' });
	const total = route.miles;
	// Along the road only road cameras count; skyline, park and other views only show up near the destination.
	const destRadius = to.featured?.radius_miles ?? DEFAULT_DESTINATION_RADIUS;
	const isRoad = (c: Camera) => c.tags?.includes('road') ?? false;
	const found = [
		...alongRoute(cameras.filter(isRoad), route.coords),
		...alongRoute(
			cameras.filter((c) => !isRoad(c)),
			route.coords,
			{ corridor: 0, endBuffer: 0, destinationRadius: destRadius }
		)
	].sort((a, b) => a.along - b.along || a.off - b.off);
	// Always finish on a camera near the destination: if nothing is within reach, take the closest one.
	if (!found.some((f) => distanceMiles(f.item, to) <= destRadius)) {
		const closest = nearby(
			cameras.filter((c) => !isDormant(c) && c.feed_url),
			to,
			NEAREST_FALLBACK_MILES
		)[0];
		if (closest) found.push({ item: closest, along: total, off: closest.distance });
	}
	const withLinks = await withLiveLinks(found.map((f) => f.item));
	const stops = found.map((f, i) => ({ camera: withLinks[i], along: f.along, off: f.off }));
	const isOffline = (c: Camera) => isDormant(c) || !c.feed_url;
	const live = stops.filter((s) => !isOffline(s.camera));
	// Long drives (like I-5) have a camera every half mile. Show spaced-out key cameras by default;
	// other sources and the destination area are always kept. "Show all" lists every one.
	const MAX_SHOWN = 40;
	const candidates = live.map((s) => ({
		...s,
		keep: s.camera.source !== 'WSDOT' || Boolean(s.camera.provider)
	}));
	const shown = showAll ? live : thinToTarget(candidates, MAX_SHOWN);

	// Weather: anything along the road, plus anything that serves the destination.
	const radius = destRadius;
	const sources = new Map<string, WeatherSource>();
	// Along the road only forecasts, roadside stations and pass conditions matter; ferries, border and
	// airport reports show up when the drive ends at one of them.
	const ROADSIDE = new Set(['forecast', 'station', 'pass-conditions', 'river']);
	for (const w of alongRoute(
		weather.filter((x) => ROADSIDE.has(x.kind)),
		route.coords,
		{ corridor: 3 }
	))
		sources.set(w.item.id, w.item);
	// Near the destination, ferry/airport/border reports only count if you are going to one.
	const destinationKinds = allowedKinds(to.featured);
	for (const w of nearby(
		weather.filter((x) => destinationKinds.has(x.kind)),
		to,
		radius
	))
		sources.set(w.id, w);
	// Always a forecast for where you are going, even where we have no weather files yet.
	for (const w of withForecast([...sources.values()], to, radius)) sources.set(w.id, w);
	const wx: Nearby<WeatherSource>[] = [...sources.values()].map((w) => ({
		...w,
		distance: distanceMiles(w, to)
	}));

	return {
		...base,
		trip: {
			from: from.label,
			to: to.label,
			viaCount: via.length,
			miles: total,
			minutes: route.minutes,
			leaveIn,
			demoWinter,
			route: route.coords,
			stops: shown,
			totalCameras: live.length,
			showingAll: showAll || shown.length === live.length,
			offline: stops
				.filter((s) => isOffline(s.camera))
				.map((s) => ({ ...s.camera, distance: s.along }) as Nearby<Camera>),
			// Streamed like the conditions: where snow or freezing starts, for when you will be there.
			snow: snowAlong(route.coords, Date.now() + leaveIn * 60_000, route.minutes, demoWinter),
			// Streamed: the forecast at the start, each pass, every hour or so, and the end, for when you get there.
			onTheWay: weatherOnTheWay(
				routeStops(
					route.coords,
					route.minutes,
					leaveIn,
					{ from: { ...from, label: from.label }, to: { ...to, label: to.label } },
					getCatalog().passes,
					nearestTown
				)
			),
			// Streamed: the page shows cameras right away while live weather loads.
			conditions: Promise.all(
				thinToTarget(
					inDrivingOrder(wx, route.coords).map((x) => ({
						...x,
						keep: x.item.kind === 'forecast' || !ROADSIDE.has(x.item.kind)
					})),
					7
				).map(({ item, along }) => {
					// When you will be there: now (or when you leave) plus the driving time to that point.
					const minutesIn =
						leaveIn + (route.minutes * Math.min(along, total)) / Math.max(total, 0.1);
					return getConditions(item, { at: Date.now() + minutesIn * 60_000 });
				})
			)
		}
	};
};
