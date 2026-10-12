import { error } from '@sveltejs/kit';
import { getCatalog } from '../../../../lib/server/catalog';
import { cameraPreview, previewResponse } from '../../../../lib/server/sharePictures';
import type { RequestHandler } from './$types';

/** The picture a shared camera link shows. */
export const GET: RequestHandler = ({ params, url }) => {
	const camera = getCatalog().cameras.find((c) => c.id === params.id);
	if (!camera) error(404, 'Unknown camera');
	return previewResponse(`camera:${camera.id}`, () => cameraPreview(camera, url.host));
};
