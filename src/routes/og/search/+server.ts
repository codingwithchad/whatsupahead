import { error } from '@sveltejs/kit';
import { getCatalog } from '../../../lib/server/catalog';
import { geocode } from '../../../lib/server/geocode';
import {
	ON_MOUNTAIN_MILES,
	placePreview,
	previewResponse,
	siteName
} from '../../../lib/server/sharePictures';
import type { RequestHandler } from './$types';

/**
 * The picture a shared place page shows: one of our places (?place=) or a searched town (?q=). `&near=1` (the
 * Facebook Page's snow posts) shows only cameras up on the mountain, or the card alone.
 */
export const GET: RequestHandler = async ({ url }) => {
	const featured = getCatalog().places.find((p) => p.id === url.searchParams.get('place'));
	const near = url.searchParams.has('near') ? ON_MOUNTAIN_MILES : undefined;
	if (featured)
		return previewResponse(`place:${featured.id}${near ? ':near' : ''}`, () =>
			placePreview(
				{ lat: featured.lat, lon: featured.lon, label: featured.name },
				featured,
				siteName(url),
				near
			)
		);
	const q = url.searchParams.get('q')?.trim().slice(0, 200);
	if (!q) error(404, 'Nothing to show');
	return previewResponse(`search:${q.toLowerCase()}`, async () => {
		const place = await geocode(q);
		if (!place) throw new Error('place not found');
		return placePreview(place, undefined, siteName(url));
	});
};
