import { isDormant, nearby } from '../geo';
import { forPlace } from '../placeCameras';
import { getCatalog } from './catalog';
import { getConditions } from './conditions';
import { allowedKinds } from '../kinds';
import { geocode } from './geocode';
import { withForecast } from './autoForecast';
import { recordView } from './popularity';
import { withLiveLinks } from './live';
import type { Camera, FeaturedPlace, Nearby, Place } from '../types';
import { APP_NAME } from '../brand';
import { previewSlot, sentence, type ShareMeta } from '../sharing';

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

/**
 * Everything a place page shows: its cameras (nearest first), and the weather and reports around it, streamed.
 * Used by search and place pages (/search) and by pass pages (/passes/<id>), which leave out `skipKinds`.
 */
export async function placePage(
	featured: FeaturedPlace | undefined,
	{
		url,
		setHeaders,
		locals,
		skipKinds = new Set<string>()
	}: {
		url: URL;
		setHeaders: (headers: Record<string, string>) => void;
		locals: App.Locals;
		skipKinds?: Set<string>;
	}
) {
	const { cameras, weather } = getCatalog();
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
		conditions: Promise.resolve([]),
		canonical: null as string | null,
		pageTitle: null as string | null
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
				? 'The nearest cameras'
				: `${live.length} live ${live.length === 1 ? 'camera' : 'cameras'}`
		}, the forecast and conditions, on ${APP_NAME}.`,
		image: `/og/search?${preview}&v=${previewSlot()}`,
		imageAlt: `Camera pictures from ${place.label}`
	};
	return {
		...empty,
		share,
		canonical: featured ? `/search?place=${encodeURIComponent(featured.id)}` : null,
		pageTitle: featured ? `${featured.name} Cameras & Weather · ${APP_NAME}` : null,
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
						weather.filter((w) => kinds.has(w.kind) && !skipKinds.has(w.kind)),
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
}
