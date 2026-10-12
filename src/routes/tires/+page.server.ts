import type { ShareMeta } from '../../lib/sharing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const share: ShareMeta = {
		title: "What's a traction tire? Chains and tires for mountain passes",
		description:
			'"Traction tires required": do you have them? How to check your tires in two minutes, and what each chain sign means for a car, an AWD and a trailer in Washington, Oregon and California.'
	};
	return { share, canonical: '/tires' };
};
