import { isDormant, nearby } from '../lib/geo';
import { coverPicture, forPlace } from '../lib/placeCameras';
import { getCatalog } from '../lib/server/catalog';
import { allPassReports } from '../lib/server/passes';
import { rightNow } from '../lib/rightNow';
import { viewCount } from '../lib/server/popularity';
import { seasonalDrives } from '../lib/seasonalDrives';
import { localDay } from '../lib/passHistory';
import type { PageServerLoad } from './$types';

const DEFAULT_RADIUS = 25;

const TEN_MINUTES = 10 * 60 * 1000;
let memo: { at: number; value: ReturnType<typeof compute> } | null = null;

/** The per-place camera counts and cover photos only change when the data files do (or a seasonal camera wakes up), so work them out once in a while, not on every visit. */
function compute() {
	const { places, cameras, collections, drives } = getCatalog();
	const cards = places.map((p) => {
		const live = nearby(forPlace(cameras, p), p, p.radius_miles ?? DEFAULT_RADIUS).filter(
			(c) => !isDormant(c) && (c.feed_url || c.provider) && c.feed_type === 'image'
		);
		return {
			id: p.id,
			name: p.name,
			region: p.region,
			blurb: p.blurb,
			collection: p.collection ?? null,
			liveCameras: live.length,
			// The nearest working camera's picture becomes the place's cover photo.
			cover: coverPicture(live)
		};
	});
	return {
		collections: collections.map((c) => ({
			...c,
			places: places.filter((p) => p.collection === c.id || c.also?.includes(p.id)).length
		})),
		drives,
		places: cards
	};
}

export const load: PageServerLoad = () => {
	if (!memo || Date.now() - memo.at > TEN_MINUTES) memo = { at: Date.now(), value: compute() };
	const { collections, drives: allDrives, places: cards } = memo.value;
	// The drives people take at this time of year, by the calendar where the drives are.
	const drives = seasonalDrives(allDrives, localDay(Date.now(), 'America/Los_Angeles').slice(5));
	// Most viewed across everyone first; ties keep the order set in the data files.
	const popular = cards
		.filter((c) => !c.collection)
		.map((c, i) => ({ c, i }))
		.sort((a, b) => viewCount(b.c.id) - viewCount(a.c.id) || a.i - b.i)
		.map((x) => x.c.id);
	// Streamed: the page shows at once, and the passes that are closed or need chains join it a moment later.
	const { passes } = getCatalog();
	const storm = allPassReports(passes)
		.then((reports) => rightNow(passes, reports))
		.catch(() => []);
	return { collections, drives, places: cards, popular, storm };
};
