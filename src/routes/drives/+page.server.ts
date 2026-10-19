import { getCatalog } from '../../lib/server/catalog';
import { REGIONS } from '../../lib/regions';
import type { PageServerLoad } from './$types';

/** Every featured drive, by state, each with its own page. */
export const load: PageServerLoad = () => {
	const { drives } = getCatalog();
	const states = REGIONS.map((r) => ({
		name: r.name,
		drives: drives
			.filter((d) => d.state === r.abbr)
			.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
			.map((d) => ({ id: d.id, name: d.name, blurb: d.blurb ?? '' }))
	})).filter((s) => s.drives.length);
	return {
		states,
		description:
			'Road conditions for the drives people take: Seattle to Leavenworth, Portland to Bend, San Francisco to Lake Tahoe and more. Pass reports, chains for your car and when to leave to miss the snow.',
		crumbs: [{ name: 'Popular drives', path: '/drives' }],
		canonical: '/drives'
	};
};
