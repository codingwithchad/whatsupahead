import { error } from '@sveltejs/kit';
import { distanceMiles, isDormant, nearby } from '../../../lib/geo';
import { returnLabel } from '../../../lib/format';
import { APP_NAME } from '../../../lib/brand';
import { previewSlot, type ShareMeta } from '../../../lib/sharing';
import { getCatalog } from '../../../lib/server/catalog';
import { nearestTown } from '../../../lib/server/gazetteer';
import { withLiveLinks } from '../../../lib/server/live';
import type { PageServerLoad } from './$types';

/** One camera on its own page, so it can be shared: its picture, where it is, and the cameras around it. */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const { cameras, places } = getCatalog();
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
			: `Live camera${near ? ` near ${near}` : ''}, from ${found.attribution_text ?? found.source}. See it now, with the weather and nearby cameras, on ${APP_NAME}.`,
		image: `/og/camera/${encodeURIComponent(found.id)}?v=${previewSlot()}`,
		imageAlt: `Latest picture from the ${found.name} camera`
	};
	return {
		share,
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
