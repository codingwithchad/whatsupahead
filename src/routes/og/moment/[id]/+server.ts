import { error } from '@sveltejs/kit';
import { getMoment } from '../../../../lib/server/moments';
import { momentPreview, previewResponse, siteName } from '../../../../lib/server/sharePictures';
import { getCatalog } from '../../../../lib/server/catalog';
import type { RequestHandler } from './$types';

/**
 * The picture a shared before-and-after shows: the two pictures side by side. `?tall` stacks them in
 * Instagram's portrait size, and `?save` sends it as a file to keep and post ("Save picture").
 */
export const GET: RequestHandler = ({ params, url }) => {
	const moment = getMoment(params.id);
	if (!moment) error(404, 'Not found');
	const tall = url.searchParams.has('tall');
	const camera = getCatalog().cameras.find((c) => c.id === moment.camera);
	const name = (camera?.name ?? 'pass')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 50);
	return previewResponse(
		`moment${tall ? '-tall' : ''}:${moment.id}`,
		() => momentPreview(moment, siteName(url), { tall }),
		url.searchParams.has('save') ? `${name}-before-and-after.jpg` : undefined
	);
};
