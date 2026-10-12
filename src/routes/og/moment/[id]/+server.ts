import { error } from '@sveltejs/kit';
import { getMoment } from '../../../../lib/server/moments';
import { momentPreview, previewResponse } from '../../../../lib/server/sharePictures';
import type { RequestHandler } from './$types';

/** The picture a shared before-and-after shows: the two pictures side by side. */
export const GET: RequestHandler = ({ params, url }) => {
	const moment = getMoment(params.id);
	if (!moment) error(404, 'Not found');
	return previewResponse(`moment:${moment.id}`, () => momentPreview(moment, url.host));
};
