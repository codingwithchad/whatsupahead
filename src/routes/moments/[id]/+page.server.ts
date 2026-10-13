import { error } from '@sveltejs/kit';
import { APP_NAME } from '../../../lib/brand';
import { type ShareMeta } from '../../../lib/sharing';
import { getCatalog } from '../../../lib/server/catalog';
import { getMoment } from '../../../lib/server/moments';
import { momentWords } from '../../../lib/server/sharePictures';
import type { PageServerLoad } from './$types';

/** A shared before-and-after: two pictures from one camera, hours apart. */
export const load: PageServerLoad = ({ params }) => {
	const moment = getMoment(params.id);
	const camera = moment && getCatalog().cameras.find((c) => c.id === moment.camera);
	if (!moment || !camera) error(404, 'This before-and-after is no longer available');
	const words = momentWords(moment);
	const share: ShareMeta = {
		title: `${camera.name}, ${words.before} and ${words.after}`,
		description: `Before and after, ${words.apart} (${words.day}). See the camera's latest picture on ${APP_NAME}.`,
		image: `/og/moment/${moment.id}`,
		imageAlt: `${camera.name} at ${words.before} and at ${words.after}`
	};
	return {
		share,
		id: moment.id,
		words,
		credit: camera.attribution_text ?? camera.source,
		camera: { id: camera.id, name: camera.name, page_url: camera.page_url }
	};
};
