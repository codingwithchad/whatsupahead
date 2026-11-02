import { error } from '@sveltejs/kit';
import { areaById } from '../../../../lib/areas';
import {
	previewResponse,
	shapeOf,
	siteName,
	topSnowPreview
} from '../../../../lib/server/sharePictures';
import type { RequestHandler } from './$types';

/** The picture on the Facebook Page's most-new-snow post for one mountain area (`?shape=tall`, `story` to post). */
export const GET: RequestHandler = ({ params, url }) => {
	const area = areaById(params.area);
	if (!area || area.kind !== 'mountains') error(404, 'Unknown area');
	const shape = shapeOf(url);
	return previewResponse(`top-snow:${area.id}:${shape}`, () =>
		topSnowPreview(area, siteName(url), shape)
	);
};
