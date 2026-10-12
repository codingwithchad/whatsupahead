import { error, json } from '@sveltejs/kit';
import { saveMoment } from '../../../lib/server/moments';
import type { RequestHandler } from './$types';

/**
 * Save a before-and-after from a camera's replay and return its link. Sent as JSON, which other sites can't
 * send to us without our permission.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Send JSON');
	let body: { camera?: unknown; before?: unknown; after?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Not JSON');
	}
	const { camera, before, after } = body;
	if (typeof camera !== 'string' || typeof before !== 'number' || typeof after !== 'number')
		error(400, 'Needs camera, before and after');
	const moment = saveMoment(camera, before, after);
	if (!moment) error(404, 'Those pictures are no longer available');
	return json({ id: moment.id, path: `/moments/${moment.id}` });
};
