import { error } from '@sveltejs/kit';
import { distanceMiles, isDormant, nearby } from '../../../lib/geo';
import { returnLabel } from '../../../lib/format';
import { APP_NAME } from '../../../lib/brand';
import { creditSentence, previewSlot, type ShareMeta } from '../../../lib/sharing';
import { getCatalog } from '../../../lib/server/catalog';
import { nearestTown } from '../../../lib/server/gazetteer';
import { withLiveLinks } from '../../../lib/server/live';
import type { PageServerLoad } from './$types';

/** One camera on its own page, so it can be shared: its picture, where it is, and the cameras around it. */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const { cameras, places, passes } = getCatalog();
	const found = cameras.find((c) => c.id === params.id);
	if (!found) error(404, 'Unknown camera');
	const place = nearby(places, found, 6)[0] ?? null;
	const town = place ? null : nearestTown(found, 10);
	const around = nearby(
		cameras.filter((c) => c.id !== found.id && !isDormant(c) && (c.feed_url || c.provider)),
		found,
		5
	).slice(0, 6);
	const [camera, ...others] = await withLiveLinks([{ ...found, distance: 0 }, ...around]);
	setHeaders({ 'cache-control': 'private, max-age=60' });
	const near = place?.name ?? town;
	const back = isDormant(found) ? returnLabel(found.expected_return) : null;
	const share: ShareMeta = {
		title: found.name,
		description: back
			? `Seasonal camera${near ? ` near ${near}` : ''}, back in ${back}. On ${APP_NAME}.`
			: `Camera${near ? ` near ${near}` : ''}. ${creditSentence(found)} See the latest picture, with the weather and nearby cameras, on ${APP_NAME}.`,
		image: `/og/camera/${encodeURIComponent(found.id)}?v=${previewSlot()}`,
		imageAlt: `Latest picture from the ${found.name} camera`
	};
	// Home › the place it's near (its pass page when it's a pass) › this camera.
	const placePass = place && passes.find((p) => p.place === place.id);
	const crumbs = [
		...(place
			? [
					placePass
						? { name: placePass.name, path: `/passes/${encodeURIComponent(placePass.id)}` }
						: { name: place.name, path: `/search?place=${encodeURIComponent(place.id)}` }
				]
			: []),
		{ name: found.name, path: `/cameras/${encodeURIComponent(found.id)}` }
	];
	return {
		share,
		// One picture a page, 8,950 of them: search engines should spend their visits on the pass and place pages,
		// which hold these cameras with the report and forecast. Links on it are still followed.
		noindex: true,
		crumbs,
		camera,
		back,
		place: place ? { id: place.id, name: place.name } : null,
		town,
		dormant: isDormant(found),
		others: others
			.filter((c) => c.feed_url)
			.map((c) => ({ ...c, distance: distanceMiles(found, c) }))
	};
};
