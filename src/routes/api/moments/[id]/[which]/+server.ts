import { error } from '@sveltejs/kit';
import { momentPicture } from '../../../../../lib/server/moments';
import type { RequestHandler } from './$types';

/** One of the two saved pictures of a before-and-after. They never change. */
export const GET: RequestHandler = ({ params }) => {
	if (params.which !== 'before' && params.which !== 'after') error(404, 'Not found');
	const jpeg = momentPicture(params.id, params.which);
	if (!jpeg) error(404, 'Not found');
	return new Response(new Uint8Array(jpeg), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400, immutable' }
	});
};
