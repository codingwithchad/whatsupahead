import { error } from '@sveltejs/kit';
import { areaById } from '../../../../lib/areas';
import {
	previewResponse,
	shapeOf,
	siteName,
	topSnowPreview
} from '../../../../lib/server/sharePictures';
import type { RequestHandler } from './$types';

/**
 * The picture on the Facebook Page's most-new-snow post for one mountain area (`?shape=tall`, `story` to post;
 * `&keep=1` for a post that stays up, which shows only cameras whose past pictures we may keep).
 */
export const GET: RequestHandler = ({ params, url }) => {
	const area = areaById(params.area);
	if (!area || area.kind !== 'mountains') error(404, 'Unknown area');
	const shape = shapeOf(url);
	const keep = url.searchParams.has('keep');
	return previewResponse(`top-snow:${area.id}:${shape}:${keep ? 'keep' : ''}`, () =>
		topSnowPreview(area, siteName(url), shape, keep)
	);
};
