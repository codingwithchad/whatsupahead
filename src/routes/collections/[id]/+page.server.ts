import { error } from '@sveltejs/kit';
import { isDormant, nearby } from '../../../lib/geo';
import { coverPicture, forPlace } from '../../../lib/placeCameras';
import { getCatalog } from '../../../lib/server/catalog';
import { getGlance } from '../../../lib/server/conditions';
import type { Glance } from '../../../lib/transit';
import { REGIONS, regionAt } from '../../../lib/regions';
import { APP_NAME } from '../../../lib/brand';
import { previewSlot, sentence, type ShareMeta } from '../../../lib/sharing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const { collections, places, cameras, weather } = getCatalog();
	const collection = collections.find((c) => c.id === params.id);
	if (!collection) error(404, 'Unknown collection');
	// Grouped by state, in the order of data/regions.json, when the collection spans more than one.
	const stateOf = (p: (typeof places)[number]) =>
		p.state ?? regionAt(p.lat, p.lon)?.name ?? 'Other places';
	const rank = (name: string) => {
		const i = REGIONS.findIndex((r) => r.name === name);
		return i === -1 ? REGIONS.length : i;
	};
	const list = places
		.filter((p) => p.collection === collection.id || collection.also?.includes(p.id))
		.map((p) => {
			const live = nearby(forPlace(cameras, p), p, p.radius_miles ?? 2).filter(
				(c) => !isDormant(c) && (c.feed_url || c.provider) && c.feed_type === 'image'
			);
			return {
				id: p.id,
				lat: p.lat,
				lon: p.lon,
				state: stateOf(p),
				name: p.name,
				blurb: p.blurb,
				liveCameras: live.length,
				cover: coverPicture(live)
			};
		});
	const states = [...new Set(list.map((p) => p.state))].sort((a, b) => rank(a) - rank(b));
	// Ferry space and border waits on each card, so you can read them before opening a place. Streamed: the
	// list shows at once and the lines fill in.
	const live = weather.filter((w) => w.kind === 'ferry' || w.kind === 'border');
	const sources = list.map((p) => ({ id: p.id, src: nearby(live, p, 3)[0] })).filter((x) => x.src);
	const glances = sources.length
		? Promise.all(sources.map(async ({ id, src }) => [id, await getGlance(src)] as const)).then(
				(pairs) => Object.fromEntries(pairs.filter((x): x is [string, Glance] => x[1] !== null))
			)
		: null;
	const share: ShareMeta = {
		title: collection.name,
		description: `${collection.blurb ? `${sentence(collection.blurb)} ` : ''}${list.length} places, with cameras and the forecast for each, on ${APP_NAME}.`,
		image: `/og/collection/${encodeURIComponent(collection.id)}?v=${previewSlot()}`,
		imageAlt: `Camera pictures from ${collection.name}`
	};
	return {
		share,
		crumbs: [{ name: collection.name, path: `/collections/${encodeURIComponent(collection.id)}` }],
		collection,
		groups: states.map((state) => ({ state, places: list.filter((p) => p.state === state) })),
		glances
	};
};
