import { isDormant, nearby } from '../../lib/geo';
import { forPlace } from '../../lib/placeCameras';
import { getCatalog } from '../../lib/server/catalog';
import { getConditions } from '../../lib/server/conditions';
import { allowedKinds } from '../../lib/kinds';
import { geocode } from '../../lib/server/geocode';
import { withForecast } from '../../lib/server/autoForecast';
import { recordView } from '../../lib/server/popularity';
import { withLiveLinks } from '../../lib/server/live';
import type { Camera, Nearby, Place } from '../../lib/types';
import { APP_NAME } from '../../lib/brand';
import { previewSlot, sentence, type ShareMeta } from '../../lib/sharing';
import type { PageServerLoad } from './$types';

const DEFAULT_RADIUS = 10;
const CAMERA_LIMIT = 24;
const MAX_RADIUS = 75;

/** Several forecasts, tide stations or buoys a few miles apart say the same thing, so keep only the nearest one of each. */
const ONE_EACH = new Set(['forecast', 'tides', 'waves']);
function oneEach<T extends { kind: string }>(sources: T[]): T[] {
	const seen = new Set<string>();
	return sources.filter((w) => {
		if (!ONE_EACH.has(w.kind)) return true;
		if (seen.has(w.kind)) return false;
		seen.add(w.kind);
		return true;
	});
}

// Buoys sit 20 to 30 miles offshore and tide stations are far apart along the coast, so look further for them.
const MARINE = new Set(['tides', 'waves']);
const MARINE_RADIUS = 35;

export const load: PageServerLoad = async ({ url, setHeaders, locals }) => {
	const { cameras, weather, places } = getCatalog();
	const placeId = url.searchParams.get('place');
	// A search that names one of our places ("Mount Hood", "stevens pass") opens that place.
	const typed = url.searchParams.get('q')?.trim().toLowerCase();
	const featured =
		places.find((p) => p.id === placeId) ??
		(typed ? places.find((p) => p.name.toLowerCase() === typed) : undefined);
	const q = featured ? featured.name : (url.searchParams.get('q')?.trim() ?? '');
	const asked = Number(url.searchParams.get('r'));
	const radius = Math.min(
		Math.max(asked || featured?.radius_miles || DEFAULT_RADIUS, 1),
		MAX_RADIUS
	);
	const showAll = url.searchParams.get('all') === '1';
	const empty = {
		note: featured?.note ?? null,
		link: featured?.link ?? null,
		q,
		placeId: featured?.id ?? null,
		radius,
		failed: false,
		cameras: [],
		totalCameras: 0,
		showingAll: true,
		fallback: false,
		offline: [],
		conditions: Promise.resolve([])
	};

	let place: Place | null = featured
		? { lat: featured.lat, lon: featured.lon, label: featured.name }
		: null;
	let failed = false;
	if (!place && q) {
		try {
			place = await geocode(q);
		} catch {
			failed = true;
		}
	}
	// For the visit counter: did a typed search find somewhere? (Only whether it did, never what was typed.)
	if (!featured && q && !url.searchParams.has('r')) locals.searchFound = Boolean(place);
	if (!place) return { ...empty, place: null, failed };

	if (featured) recordView(featured.id);
	// Ferry, airport and border reports only appear when the place itself is one of those.
	const kinds = allowedKinds(featured);
	setHeaders({ 'cache-control': 'private, max-age=60' });
	const found = await withLiveLinks(
		nearby(featured ? forPlace(cameras, featured) : cameras, place, radius)
	);
	const offline = (c: Nearby<Camera>) => isDormant(c) || !c.feed_url;
	let live = found.filter((c) => !offline(c));

	// Never leave the page empty: if nothing is close, show the nearest working cameras, labelled by distance.
	let fallback = false;
	if (!live.length) {
		const pool = featured ? forPlace(cameras, featured) : cameras;
		const near = await withLiveLinks(nearby(pool, place, MAX_RADIUS).slice(0, 12));
		live = near.filter((c) => !offline(c)).slice(0, 6);
		fallback = live.length > 0;
	}
	const preview = featured
		? `place=${encodeURIComponent(featured.id)}`
		: `q=${encodeURIComponent(q)}`;
	const share: ShareMeta = {
		title: place.label,
		description: `${featured?.blurb ? `${sentence(featured.blurb)} ` : ''}${
			fallback
				? 'The nearest live cameras'
				: `${live.length} live ${live.length === 1 ? 'camera' : 'cameras'}`
		}, the forecast and conditions, on ${APP_NAME}.`,
		image: `/og/search?${preview}&v=${previewSlot()}`,
		imageAlt: `Camera pictures from ${place.label}`
	};
	return {
		...empty,
		share,
		place,
		fallback,
		cameras: showAll || fallback ? live : live.slice(0, CAMERA_LIMIT),
		totalCameras: live.length,
		showingAll: showAll || fallback || live.length <= CAMERA_LIMIT,
		offline: found.filter(offline),
		// Streamed: the page shows cameras right away while live weather loads.
		conditions: Promise.all(
			oneEach(
				nearby(
					withForecast(
						weather.filter((w) => kinds.has(w.kind)),
						place,
						featured?.weather_radius_miles ?? radius
					),
					place,
					Math.max(featured?.weather_radius_miles ?? radius, MARINE_RADIUS)
				).filter(
					(w) => MARINE.has(w.kind) || w.distance <= (featured?.weather_radius_miles ?? radius)
				)
			).map((w) => getConditions(w))
		)
	};
};
