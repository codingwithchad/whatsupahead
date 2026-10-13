import { error, json } from '@sveltejs/kit';
import { distanceMiles } from '../../../../lib/geo';
import { timeZoneAt } from '../../../../lib/regions';
import { getCatalog } from '../../../../lib/server/catalog';
import { listFrames, recordingSince } from '../../../../lib/server/history';
import { canShareMoment } from '../../../../lib/server/moments';
import { snowAtPass } from '../../../../lib/server/mountain';
import type { RequestHandler } from './$types';

/**
 * The timestamps of the saved pictures for one camera, oldest first, and the snow gauge at the nearest pass
 * (hourly depth), so the replay can say how much snow fell while it plays.
 */
export const GET: RequestHandler = async ({ params }) => {
	const frames = listFrames(params.id);
	if (!frames) error(404, 'No history for this camera');
	const { cameras, passes } = getCatalog();
	const camera = cameras.find((c) => c.id === params.id);
	const pass = camera
		? passes
				.map((p) => ({ p, d: distanceMiles(p, camera) }))
				.filter((x) => x.d <= 6)
				.sort((a, b) => a.d - b.d)[0]?.p
		: undefined;
	const snow = pass ? await snowAtPass(pass) : null;
	return json(
		{
			frames,
			since: recordingSince(),
			moments: canShareMoment(params.id),
			credit: camera?.attribution_text ?? camera?.source ?? '',
			place: pass?.name ?? null,
			timeZone: camera ? timeZoneAt(camera.lat, camera.lon) : null,
			snow: snow
				? { station: snow.station, depthIn: snow.depthIn, hourly: snow.hourly, link: snow.link }
				: null
		},
		{ headers: { 'cache-control': 'public, max-age=60' } }
	);
};
