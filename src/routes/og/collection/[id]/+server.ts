import { error } from '@sveltejs/kit';
import { getCatalog } from '../../../../lib/server/catalog';
import { collectionPreview, previewResponse, siteName } from '../../../../lib/server/sharePictures';
import { areaById } from '../../../../lib/areas';
import type { RequestHandler } from './$types';

/** The picture a shared list (ski areas, ferries...) shows. */
export const GET: RequestHandler = ({ params, url }) => {
	const collection = getCatalog().collections.find((c) => c.id === params.id);
	if (!collection) error(404, 'Unknown collection');
	const area = areaById(url.searchParams.get('in'));
	return previewResponse(`collection:${collection.id}:${area?.id ?? ''}`, () =>
		collectionPreview(collection, siteName(url), area)
	);
};
