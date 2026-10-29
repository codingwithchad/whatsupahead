import { error } from '@sveltejs/kit';
import { areaById } from '../../../../lib/areas';
import { previewResponse, siteName, topSnowPreview } from '../../../../lib/server/sharePictures';
import type { RequestHandler } from './$types';

/** The picture on the Facebook Page's most-new-snow post for one mountain area. */
export const GET: RequestHandler = ({ params, url }) => {
	const area = areaById(params.area);
	if (!area || area.kind !== 'mountains') error(404, 'Unknown area');
	return previewResponse(`top-snow:${area.id}`, () => topSnowPreview(area, siteName(url)));
};
