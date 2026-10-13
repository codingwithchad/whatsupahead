import { isDormant, nearby } from '../geo';
import { forPlace } from '../placeCameras';
import { STATUS_LABEL } from '../passes';
import { duration, localClock, returnLabel } from '../format';
import { DEFAULT_TIME_ZONE } from '../regions';
import {
	creditLine,
	creditSentence,
	PREVIEW_MINUTES,
	previewCredit,
	previewSlot
} from '../sharing';
import type { Camera, Collection, FeaturedPlace, PassInfo, Place } from '../types';
import { cached } from './cache';
import { getCatalog } from './catalog';
import { nearestTown } from './gazetteer';
import { allPassReports } from './passes';
import { safeRoute } from './safeRoute';
import { momentPicture, type Moment } from './moments';
import {
	fetchPicture,
	renderCard,
	renderPair,
	renderPairTall,
	type CardPicture
} from './shareCard';
import { camerasAlong, DEFAULT_DESTINATION_RADIUS, parseVia, resolvePlace } from './trip';

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

/** Up to `n` pictures we may share from these cameras, in their order, with the credit for each. */
async function sharePictures(
	cameras: Camera[],
	n: number,
	caption?: (c: Camera) => string | undefined
): Promise<{ pictures: CardPicture[]; credit: string }> {
	const usable = cameras.filter((c) => !isDormant(c) && previewCredit(c)).slice(0, n * 2);
	const got = await Promise.all(usable.map((c) => fetchPicture(c.feed_url!)));
	const picked = usable
		.map((c, i) => ({ c, image: got[i] }))
		.filter((x): x is { c: Camera; image: Buffer } => x.image !== null)
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

export async function placePreview(
	place: Place,
	featured: FeaturedPlace | undefined,
	site: string
): Promise<Buffer> {
	const radius = featured?.radius_miles ?? 10;
	const pool = featured ? forPlace(getCatalog().cameras, featured) : getCatalog().cameras;
	const around = nearby(pool, place, radius).filter(
		(c) => !isDormant(c) && (c.feed_url || c.provider)
	);
	// A pass's page leads with its report, when there is one (winter).
	const pass = featured && getCatalog().passes.find((p) => p.place === featured.id);
	const [{ pictures, credit }, status] = await Promise.all([
		sharePictures(around, 3),
		pass ? passLine(pass) : null
	]);
	return renderCard({
		title: place.label,
		lines: [
			...(status ? [status] : []),
			...(featured?.blurb ? [featured.blurb] : []),
			around.length
				? `${around.length} live ${around.length === 1 ? 'camera' : 'cameras'} and the forecast`
				: 'The forecast and the nearest cameras'
		],
		credit,
		pictures,
		site
	});
}

export async function collectionPreview(collection: Collection, site: string): Promise<Buffer> {
	const { places, cameras } = getCatalog();
	const list = places.filter(
		(p) => p.collection === collection.id || collection.also?.includes(p.id)
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
		title: collection.name,
		lines: [...(collection.blurb ? [collection.blurb] : []), `${list.length} places`],
		credit,
		pictures,
		site
	});
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
