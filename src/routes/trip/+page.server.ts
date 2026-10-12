import { allowedKinds } from '../../lib/kinds';
import { distanceMiles, isDormant, nearby } from '../../lib/geo';
import { getCatalog } from '../../lib/server/catalog';
import { getConditions } from '../../lib/server/conditions';
import {
	camerasAlong,
	DEFAULT_DESTINATION_RADIUS,
	parseVia,
	resolvePlace,
	tripLine
} from '../../lib/server/trip';
import { previewSlot, tripShareParams, type ShareMeta } from '../../lib/sharing';
import { withForecast } from '../../lib/server/autoForecast';
import { withLiveLinks } from '../../lib/server/live';
import { safeRoute } from '../../lib/server/safeRoute';
import { roadWarnings } from '../../lib/server/roadAhead';
import { snowAlong } from '../../lib/server/snow';
import { weatherOnTheWay } from '../../lib/server/routeWeather';
import { nearestTown } from '../../lib/server/gazetteer';
import { routeStops } from '../../lib/routeWeather';
import { alongRoute, cumulativeMiles, projectOnRoute, thinToTarget } from '../../lib/route';
import type { Camera, Nearby, WeatherSource } from '../../lib/types';
import type { PageServerLoad } from './$types';

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

	const via = parseVia(url.searchParams.get('via'));
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
		[from, to] = await Promise.all([resolvePlace(fromQ, places), resolvePlace(toQ, places)]);
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

	let safe;
	try {
		safe = await safeRoute(from, to, via);
	} catch {
		return {
			...base,
			error: "Couldn't work out a driving route between those two places.",
			trip: null
		};
	}

	const { route } = safe;
	setHeaders({ 'cache-control': 'private, max-age=60' });
	const total = route.miles;
	// Along the road only road cameras count; skyline, park and other views only show up near the destination.
	const destRadius = to.featured?.radius_miles ?? DEFAULT_DESTINATION_RADIUS;
	const found = camerasAlong(cameras, route.coords, to, destRadius, total);
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
	// Along the road only forecasts, roadside stations and rivers matter (passes have their own section);
	// ferries, border and airport reports show up when the drive ends at one of them.
	const ROADSIDE = new Set(['forecast', 'station', 'river']);
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

	const passNames = safe.passes.map((p) => p.pass.name);
	const share: ShareMeta = {
		title: `${from.label} to ${to.label}`,
		description: `${tripLine(total, route.minutes, passNames)} ${live.length} live cameras on the way, with the weather and pass reports for when you get there.`,
		image: `/og/trip?${tripShareParams(url.searchParams)}&v=${previewSlot()}`,
		imageAlt: `Map of the drive from ${from.label} to ${to.label}, with camera pictures from the way`
	};
	return {
		...base,
		share,
		trip: {
			from: from.label,
			to: to.label,
			viaCount: via.length,
			miles: total,
			minutes: route.minutes,
			leaveIn,
			demoWinter,
			route: route.coords,
			// Closed passes gone around or still in the way, each pass's report, and slow back roads.
			road: {
				avoided: safe.avoided,
				blocked: safe.blocked,
				roughMiles: Math.round(route.roughMiles ?? 0),
				passes: safe.passes.map(({ pass, along, heading, report }) => ({
					id: pass.id,
					name: pass.name,
					route: pass.route,
					place: pass.place,
					link: pass.link ?? null,
					source:
						pass.pass_id !== undefined
							? 'WSDOT'
							: pass.report?.source === 'odot'
								? 'ODOT'
								: 'Caltrans',
					along,
					heading,
					report
				}))
			},
			// Streamed: full road closures and weather warnings for when you get to each point.
			warnings: roadWarnings(route.coords, route.minutes, Date.now() + leaveIn * 60_000),
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
