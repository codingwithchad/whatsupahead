import { isDormant } from '../../lib/geo';
import { getCatalog } from '../../lib/server/catalog';
import {
	camerasAlong,
	DEFAULT_DESTINATION_RADIUS,
	parseVia,
	resolvePlace,
	tripLine
} from '../../lib/server/trip';
import { previewSlot, tripShareParams, type ShareMeta } from '../../lib/sharing';
import { withLiveLinks } from '../../lib/server/live';
import { safeRoute } from '../../lib/server/safeRoute';
import { routeOptions, thinLine } from '../../lib/server/routeOptions';
import { roadWarnings } from '../../lib/server/roadAhead';
import { snowAlong } from '../../lib/server/snow';
import { weatherOnTheWay } from '../../lib/server/routeWeather';
import { nearestTown } from '../../lib/server/gazetteer';
import { routeStops } from '../../lib/routeWeather';
import { thinToTarget } from '../../lib/route';
import { conditionSources, conditionsAt, roadPass } from '../../lib/server/tripLive';
import type { Camera, Nearby } from '../../lib/types';
import type { PageServerLoad } from './$types';

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

	const { cameras, places } = getCatalog();
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

	// When the drive starts: every forecast and warning is for the time you reach that point.
	const startAt = Date.now() + leaveIn * 60_000;
	const sources = conditionSources(route.coords, to, to.featured, destRadius);

	const passNames = safe.passes.map((p) => p.pass.name);
	const share: ShareMeta = {
		title: `${from.label} to ${to.label}`,
		description: `${tripLine(total, route.minutes, passNames)} ${live.length} cameras on the way, with the weather and pass reports for when you get there.`,
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
				passes: safe.passes.map(roadPass)
			},
			// Streamed: the same drive over the other passes across the same mountains. Not for drives with stops:
			// the other ways go straight from start to finish, so they would leave a stop out.
			options:
				via.length > 0
					? Promise.resolve({ baseline: null, options: [] })
					: routeOptions(from, to, safe),
			mapLine: thinLine(route.coords),
			// Streamed: full road closures and weather warnings for when you get to each point.
			warnings: roadWarnings(route.coords, route.minutes, startAt),
			// For the page's refreshes while it stays open (/api/trip/live).
			startAt,
			fromPoint: { lat: from.lat, lon: from.lon, label: from.label },
			toPoint: { lat: to.lat, lon: to.lon, label: to.label, featuredId: to.featured?.id },
			stops: shown,
			totalCameras: live.length,
			showingAll: showAll || shown.length === live.length,
			offline: stops
				.filter((s) => isOffline(s.camera))
				.map((s) => ({ ...s.camera, distance: s.along }) as Nearby<Camera>),
			// Streamed like the conditions: where snow or freezing starts, for when you will be there.
			snow: snowAlong(route.coords, startAt, route.minutes, demoWinter),
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
			conditions: conditionsAt(sources, total, route.minutes, startAt)
		}
	};
};
