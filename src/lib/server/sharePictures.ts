import { isDormant, nearby } from '../geo';
import { forPlace } from '../placeCameras';
import { forecastStory, passOutlook } from '../autopost';
import { reportSource, STATUS_LABEL } from '../passes';
import { dayName, duration, localClock, returnLabel } from '../format';
import { DEFAULT_TIME_ZONE, regionAt, timeZoneAt } from '../regions';
import { areaById, inArea, type Area } from '../areas';
import {
	creditLine,
	creditSentence,
	mayKeep,
	PREVIEW_MINUTES,
	previewCredit,
	previewSlot
} from '../sharing';
import type { Camera, Collection, FeaturedPlace, PassInfo, Place } from '../types';
import { cached } from './cache';
import { getCatalog } from './catalog';
import { nearestTown } from './gazetteer';
import { crossingTimes } from './crossing';
import { allPassReports } from './passes';
import { safeRoute } from './safeRoute';
import { momentPicture, type Moment } from './moments';
import {
	fetchPicture,
	renderCard,
	renderPair,
	renderPairTall,
	renderShape,
	tallLayers,
	tooDark,
	type Card,
	type CardPicture,
	type Layers,
	type Shape
} from './shareCard';
import { camerasAlong, DEFAULT_DESTINATION_RADIUS, parseVia, resolvePlace } from './trip';
import { skiSnow } from './skiSnow';
import { snowingNow } from './snowing';
import { snowHeadline } from '../snowing';
import { middle, names, skiAreasIn, topSnow } from '../topSnow';

// The share pictures for each kind of page. Only pictures whose owners allow it go in (see ../sharing.ts);
// a page with none still gets a card with its name.

/**
 * Serve a share picture, made at most once per 10 minutes for each page. If making it fails, the app's
 * general picture is served instead, so a shared link always shows something.
 */
export async function previewResponse(
	key: string,
	make: () => Promise<Buffer>,
	/** Save as a file with this name (the "Save picture" button) instead of showing it. */
	download?: string
): Promise<Response> {
	try {
		const body = await cached(`og:${key}:${previewSlot()}`, PREVIEW_MINUTES * 60_000, make);
		return new Response(new Uint8Array(body), {
			headers: {
				'content-type': 'image/jpeg',
				'cache-control': `public, max-age=${PREVIEW_MINUTES * 60}`,
				...(download ? { 'content-disposition': `attachment; filename="${download}"` } : {})
			}
		});
	} catch (err) {
		console.warn(`[share] ${key}: ${(err as Error).message}`);
		return new Response(null, { status: 302, headers: { location: '/og-image.png' } });
	}
}

/**
 * Instagram gives up on a picture that takes about 8 seconds to arrive and calls it not a picture ("Only photo or
 * video can be accepted as media type"), and ours can take 12 to draw the first time. Asking for it first keeps it
 * ready for the rest of its ten minutes. A failed drawing sends our PNG logo instead, which is no use either.
 */
export async function drawFirst(url: string): Promise<void> {
	const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
	await res.arrayBuffer();
	if (!res.ok || res.headers.get('content-type') !== 'image/jpeg')
		throw new Error(`the picture wasn't ready (${res.status})`);
}

/** How pictures for a post differ from a link preview's. */
interface Posted {
	/** Left out when too dark to see: it stands alone on the screen, with no page around it. */
	bright?: boolean;
	/** The post stays up, so only cameras whose past pictures we may keep. */
	keep?: boolean;
}

/** Up to `n` pictures we may share from these cameras, in their order, with the credit for each. */
async function sharePictures(
	cameras: Camera[],
	n: number,
	caption?: (c: Camera) => string | undefined,
	{ bright = false, keep = false }: Posted = {}
): Promise<{ pictures: CardPicture[]; credit: string }> {
	const usable = cameras
		.filter((c) => !isDormant(c) && previewCredit(c) && (!keep || mayKeep(c)))
		// At night many may be too dark, so try more.
		.slice(0, n * (bright ? 4 : 2));
	const got = await Promise.all(usable.map((c) => fetchPicture(c.feed_url!)));
	const dark = await Promise.all(got.map((g) => (bright && g ? tooDark(g) : false)));
	const picked = usable
		.map((c, i) => ({ c, image: got[i], dark: dark[i] }))
		.filter((x): x is { c: Camera; image: Buffer; dark: false } => x.image !== null && !x.dark)
		.slice(0, n);
	return {
		pictures: picked.map((x) => ({ image: x.image, caption: caption?.(x.c) })),
		credit: creditLine(
			picked.map((x) => previewCredit(x.c)),
			picked.length
		)
	};
}

/** Where a camera is, in words: the nearest of our places within a few miles, or the nearest town. */
export function whereIs(camera: { lat: number; lon: number }): string | null {
	const place = nearby(getCatalog().places, camera, 6)[0];
	return place?.name ?? nearestTown(camera, 10);
}

/** A pass's report in a few words ("Stevens Pass: Chains required"), or null when there is none to give. */
async function passLine(pass: PassInfo): Promise<string | null> {
	const report = (await allPassReports([pass])).get(pass.id);
	if (!report || report.status === 'off-season') return null;
	return `${pass.name}: ${report.status === 'open' ? report.label || 'Open' : STATUS_LABEL[report.status]}`;
}

/**
 * The address printed on a share picture: the site's main address when it has one (CANONICAL_HOST), so a
 * request that arrives by another name (the host's own address, a stray header) never prints that name on a
 * picture that is then kept for ten minutes and copied by Facebook. Otherwise the address asked for (local runs).
 */
export const siteName = (url: URL) => process.env.CANONICAL_HOST?.trim() || url.host;

/** `?shape=tall` (Instagram's feed) or `story`; the wide link preview otherwise. */
export const shapeOf = (url: URL): Shape => {
	const s = url.searchParams.get('shape');
	return s === 'tall' || s === 'story' ? s : 'wide';
};

export async function cameraPreview(camera: Camera, site: string): Promise<Buffer> {
	const near = whereIs(camera);
	const back = isDormant(camera) ? returnLabel(camera.expected_return) : null;
	const { pictures, credit } = await sharePictures([camera], 1);
	return renderCard({
		title: camera.name,
		lines: [
			back
				? `Seasonal camera, back in ${back}`
				: camera.feed_type === 'image'
					? `Camera${near ? ` near ${near}` : ''}`
					: `Live video${near ? ` near ${near}` : ''}`,
			pictures.length
				? 'See the latest picture, with the weather and nearby cameras.'
				: creditSentence(camera)
		],
		credit,
		pictures,
		site
	});
}

/** What a story picture is about, printed big since a story has no caption. */
export type PlaceNews = 'snow' | 'chains' | 'forecast';

/** The news a picture's address asks for, from our own data: never words from the address. */
export const placeNews = (ask: string | null): PlaceNews | undefined =>
	ask === 'snow' || ask === 'chains' || ask === 'forecast' ? ask : undefined;

/** The big words for a story: the snow at its gauge, the pass's rule from its report, or the snow on its way. */
async function newsHeadline(
	news: PlaceNews,
	featured: FeaturedPlace,
	pass: PassInfo | undefined
): Promise<{
	headline: { value: string; label: string };
	line?: string | null;
	advice?: string;
	snowing: boolean;
} | null> {
	const id = pass?.id ?? featured.id;
	// Only whether snow is falling hangs on this for a chain rule: without it the rule still goes out, standing still.
	const spot = (await snowingNow().catch(() => [])).find((s) => s.id === id);
	const snowing = Boolean(spot?.now);
	if (news === 'forecast') {
		if (!pass) return null;
		const now = Date.now();
		const crossing = await crossingTimes([{ pass, minutesToPass: 0 }], now);
		const outlook = crossing && passOutlook(pass, crossing);
		return outlook ? { ...forecastStory(outlook, now), snowing } : null;
	}
	if (news === 'chains') {
		if (!pass) return null;
		const report = (await allPassReports([pass])).get(pass.id);
		if (!report || report.status === 'off-season') return null;
		// The report's own refined words ("Chains required for towing and over 10,000 lb"), as on the pass page.
		const words =
			report.status === 'closed'
				? STATUS_LABEL.closed
				: report.status === 'open'
					? report.label && report.label !== 'Open'
						? report.label
						: 'No restrictions'
					: report.label || STATUS_LABEL[report.status];
		const at = report.updated
			? `, ${localClock(report.updated, timeZoneAt(pass.lat, pass.lon))}`
			: '';
		return {
			headline: { value: words, label: `${reportSource(pass)} report${at}` },
			// The title names the pass already.
			line: null,
			snowing
		};
	}
	const headline = spot && snowHeadline(spot);
	if (!spot || !headline) return null;
	return { headline, line: spot.now ? 'Snowing now' : 'New snow today', snowing };
}

async function placeCard(
	place: Place,
	featured: FeaturedPlace | undefined,
	site: string,
	/** Only cameras this close (the Page's snow posts: up on the mountain, or the card alone). */
	withinMiles?: number,
	shape: Shape = 'wide',
	/** A story's news, printed big; left out when it no longer holds (the snow stopped, no report). */
	news?: PlaceNews
): Promise<Card> {
	const radius = withinMiles ?? featured?.radius_miles ?? 10;
	const pool = featured ? forPlace(getCatalog().cameras, featured) : getCatalog().cameras;
	const around = nearby(pool, place, radius).filter(
		(c) => !isDormant(c) && (c.feed_url || c.provider)
	);
	// A pass's page leads with its report, when there is one (winter).
	const pass = featured && getCatalog().passes.find((p) => p.place === featured.id);
	// The news first: reading the gauges can take seconds, and the cameras' pictures are given only five.
	const story =
		news && featured && shape !== 'wide'
			? await newsHeadline(news, featured, pass).catch(() => null)
			: null;
	const [{ pictures, credit }, status] = await Promise.all([
		sharePictures(around, 3, undefined, { bright: shape !== 'wide' }),
		pass ? passLine(pass) : null
	]);
	return {
		title: place.label,
		headline: story?.headline,
		advice: story?.advice,
		snowing: story?.snowing,
		lines: [
			...(story?.line ? [story.line] : []),
			// A chain story's headline is the report already; a forecast story has its advice to fit.
			...(status && !(story && news !== 'snow') ? [status] : []),
			...(featured?.blurb && !story ? [featured.blurb] : []),
			// Said only with a picture beside it; a story's drawn mountains need no invitation.
			...(story && !pictures.length
				? []
				: [
						around.length
							? `${around.length} ${around.length === 1 ? 'camera' : 'cameras'} and the forecast`
							: 'The forecast and the nearest cameras'
					])
		],
		credit,
		pictures,
		site
	};
}

export async function placePreview(
	place: Place,
	featured: FeaturedPlace | undefined,
	site: string,
	withinMiles?: number,
	shape: Shape = 'wide',
	news?: PlaceNews
): Promise<Buffer> {
	return renderShape(await placeCard(place, featured, site, withinMiles, shape, news), shape);
}

export async function collectionPreview(
	collection: Collection,
	site: string,
	/** Only this state or mountain area (`?in=sierra`) */
	area: Area | null = null
): Promise<Buffer> {
	const { places, cameras } = getCatalog();
	const list = places.filter(
		(p) =>
			(p.collection === collection.id || collection.also?.includes(p.id)) &&
			(!area ||
				inArea(area, p, [p.state ?? regionAt(p.lat, p.lon)?.name ?? '', ...(p.also_states ?? [])]))
	);
	// One picture from each of the first places that have one.
	const covers: Camera[] = [];
	const placeOf = new Map<string, string>();
	for (const p of list) {
		const c = nearby(forPlace(cameras, p), p, p.radius_miles ?? 2).find(
			(x) => !isDormant(x) && previewCredit(x)
		);
		if (c && !placeOf.has(c.id)) {
			covers.push(c);
			placeOf.set(c.id, p.name);
		}
		if (covers.length >= 8) break;
	}
	const { pictures, credit } = await sharePictures(covers, 4, (c) => placeOf.get(c.id));
	return renderCard({
		// An area's name is the title (long ones don't fit after the list's name), the list's name under it.
		title: area ? area.name : collection.name,
		lines: area
			? [collection.name, `${list.length} places`]
			: [...(collection.blurb ? [collection.blurb] : []), `${list.length} places`],
		credit,
		pictures,
		site
	});
}

/**
 * A camera this close to a ski area or pass is up on the mountain; farther (Schweitzer's are down in Sandpoint, 15
 * miles of radius) it shows a valley road in fall colours under "+7 in". Not 3: Cherry Peak's nearest, 2.99 miles
 * off, is a street corner in Richmond, and Snowbasin's, 2.63, is down Ogden Canyon.
 */
export const ON_MOUNTAIN_MILES = 2.5;

/**
 * The most new snow in a mountain area (the Facebook Page's morning post): a camera on the mountain at each of the
 * snowiest ski areas, labelled with its new snow, and the list beside them. When the snowiest has no camera up there,
 * the card with the name and list alone.
 */
async function topSnowCard(
	area: Area,
	site: string,
	shape: Shape,
	/** The post stays up: only cameras whose past pictures we may keep. */
	keep: boolean
): Promise<Card> {
	const { places, cameras, collections } = getCatalog();
	const also = collections.find((c) => c.id === 'ski-areas')?.also ?? [];
	const list = skiAreasIn(area, places, also);
	const lines = topSnow(list, await skiSnow(list));
	const covers: Camera[] = [];
	const caption = new Map<string, string>();
	for (const [i, line] of lines.entries()) {
		const p = list.find((x) => x.id === line.ids[0])!;
		const c = nearby(forPlace(cameras, p), p, ON_MOUNTAIN_MILES).find(
			(x) => !isDormant(x) && previewCredit(x)
		);
		if (!c && i === 0) break;
		if (c && !caption.has(c.id)) {
			covers.push(c);
			caption.set(c.id, `${p.name} +${line.inches} in`);
		}
	}
	const { pictures, credit } = await sharePictures(
		covers,
		shape === 'wide' ? 4 : 2,
		(c) => caption.get(c.id),
		{ bright: shape !== 'wide', keep }
	);
	if (shape !== 'wide' && lines.length)
		// Posted as a picture: the list made big, dated, each number with its gauge's height.
		return {
			title: area.name,
			lines: [],
			ranking: {
				heading: 'MOST NEW SNOW',
				day: `${dayName(Date.now(), timeZoneAt(middle(area).lat, middle(area).lon))}, last 24 hours`,
				rows: lines.map((l) => ({
					value: `+${l.inches} in`,
					name: names(l.names),
					note: `USDA gauge at ${l.gaugeFeet.toLocaleString('en-US')} ft`
				}))
			},
			snowing: true,
			credit,
			pictures,
			site
		};
	return {
		title: area.name,
		lines: [
			'Most new snow, last 24 hours',
			...lines.slice(0, 4).map((l) => `${l.inches} in: ${names(l.names)}`)
		],
		credit,
		pictures,
		site
	};
}

export async function topSnowPreview(
	area: Area,
	site: string,
	shape: Shape = 'wide',
	keep = false
): Promise<Buffer> {
	return renderShape(await topSnowCard(area, site, shape, keep), shape);
}

/**
 * A story picture's sheets, from its address: the same card the address shows, made here so a video can be drawn
 * from it. Null when the address isn't a story's.
 */
export async function storyLayers(picture: string, site: string): Promise<Layers | null> {
	const url = new URL(picture, 'https://whatsupahead.com');
	const shape = shapeOf(url);
	if (shape === 'wide') return null;
	const top = url.pathname.match(/^\/og\/top-snow\/([^/]+)$/);
	if (top) {
		const area = areaById(decodeURIComponent(top[1]));
		return area ? tallLayers(await topSnowCard(area, site, shape, false), shape) : null;
	}
	const featured = getCatalog().places.find((p) => p.id === url.searchParams.get('place'));
	if (url.pathname !== '/og/search' || !featured) return null;
	const card = await placeCard(
		{ lat: featured.lat, lon: featured.lon, label: featured.name },
		featured,
		site,
		url.searchParams.has('near') ? ON_MOUNTAIN_MILES : undefined,
		shape,
		placeNews(url.searchParams.get('news'))
	);
	return tallLayers(card, shape);
}

/** The drive: its line on a map, a camera at the first pass and one at the destination. */
export async function tripPreview(params: URLSearchParams, site: string): Promise<Buffer> {
	const { places, cameras } = getCatalog();
	const [from, to] = await Promise.all([
		resolvePlace(params.get('from') ?? '', places),
		resolvePlace(params.get('to') ?? '', places)
	]);
	if (!from || !to) throw new Error('unknown place');
	const label = (key: string, fallback: string) => params.get(key)?.trim().slice(0, 60) || fallback;
	const fromName = label('fl', from.label);
	const toName = label('tl', to.label);
	const { route, passes: over } = await safeRoute(from, to, parseVia(params.get('via')));
	const total = route.miles;
	const along = camerasAlong(
		cameras,
		route.coords,
		to,
		to.featured?.radius_miles ?? DEFAULT_DESTINATION_RADIUS,
		total
	).filter((f) => !isDormant(f.item) && (f.item.feed_url || f.item.provider));
	// A camera at the first pass (the nearest we may share, within 3 miles), then one at the destination.
	const chosen: Camera[] = [];
	const caption = new Map<string, string>();
	const pass = over[0]?.pass;
	if (pass) {
		const c = nearby(
			along.map((f) => f.item).filter((x) => previewCredit(x)),
			pass,
			3
		)[0];
		if (c) {
			chosen.push(c);
			caption.set(c.id, pass.name);
		}
	}
	const atEnd = [...along].reverse().find((f) => previewCredit(f.item) && !caption.has(f.item.id));
	if (atEnd) {
		chosen.push(atEnd.item);
		caption.set(atEnd.item.id, toName);
	}
	const { pictures, credit } = await sharePictures(chosen, 2, (c) => caption.get(c.id));

	// The first pass's report, when there is one worth saying ("Stevens Pass: Chains required").
	const status = pass ? await passLine(pass) : null;
	return renderCard({
		title: `${fromName} to ${toName}`,
		lines: [
			// The passes are on the map, so just the distance and time here.
			`${Math.round(total)} mi · about ${duration(route.minutes)}`,
			...(status ? [status] : []),
			`${along.length} cameras on the way`
		],
		credit,
		pictures,
		map: {
			route: route.coords,
			from: fromName,
			to: toName,
			marks: over.slice(0, 4).map(({ pass: p }) => ({ lat: p.lat, lon: p.lon, label: p.name }))
		},
		site
	});
}

/** The words for a before-and-after: "6:05 AM", "9:10 AM", "3 h 5 min apart", "Mon, Oct 12". */
export function momentWords(m: Moment) {
	return {
		before: localClock(m.before),
		after: localClock(m.after),
		apart: `${duration(Math.round((m.after - m.before) / 60_000))} apart`,
		day: new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			timeZone: DEFAULT_TIME_ZONE
		}).format(new Date(m.after))
	};
}

export async function momentPreview(
	m: Moment,
	site: string,
	{ tall = false }: { tall?: boolean } = {}
): Promise<Buffer> {
	const camera = getCatalog().cameras.find((c) => c.id === m.camera);
	const before = momentPicture(m.id, 'before');
	const after = momentPicture(m.id, 'after');
	if (!camera || !before || !after) throw new Error('moment pictures missing');
	const words = momentWords(m);
	return (tall ? renderPairTall : renderPair)({
		title: camera.name,
		line: `${words.apart} · ${words.day} · ${creditLine([previewCredit(camera) ?? camera.source], 2)}`,
		before: { image: before, label: `Before · ${words.before}` },
		after: { image: after, label: `After · ${words.after}` },
		site
	});
}
