import { error } from '@sveltejs/kit';
import { getCatalog } from '../../../../lib/server/catalog';
import { collectionPreview, previewResponse } from '../../../../lib/server/sharePictures';
import type { RequestHandler } from './$types';

/** The picture a shared list (ski areas, ferries...) shows. */
export const GET: RequestHandler = ({ params, url }) => {
	const collection = getCatalog().collections.find((c) => c.id === params.id);
	if (!collection) error(404, 'Unknown collection');
	return previewResponse(`collection:${collection.id}`, () =>
		collectionPreview(collection, url.host)
	);
};
