import { error } from '@sveltejs/kit';
import { getFrame } from '../../../../../lib/server/history';
import type { RequestHandler } from './$types';

/** One saved picture. A picture never changes once saved, so it can be cached for a long time. */
export const GET: RequestHandler = async ({ params }) => {
	const jpeg = await getFrame(params.id, Number(params.t));
	if (!jpeg) error(404, 'No such picture');
	return new Response(new Uint8Array(jpeg), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=7200, immutable' }
	});
};
