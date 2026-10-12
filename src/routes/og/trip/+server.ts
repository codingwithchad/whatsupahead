import { error } from '@sveltejs/kit';
import { previewResponse, tripPreview } from '../../../lib/server/sharePictures';
import { tripShareParams } from '../../../lib/sharing';
import type { RequestHandler } from './$types';

/** The picture a shared drive shows: the route on a map with cameras from the way. */
export const GET: RequestHandler = ({ url }) => {
	const params = tripShareParams(url.searchParams);
	if (!params.get('from') || !params.get('to')) error(404, 'Nothing to show');
	return previewResponse(`trip:${params}`, () => tripPreview(params, url.host));
};
