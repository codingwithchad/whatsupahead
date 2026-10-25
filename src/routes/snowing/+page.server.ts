import { snowingNow } from '../../lib/server/snowing';
import type { PageServerLoad } from './$types';

/** Where it's snowing: passes, ski areas and parks with new snow, each with a comment ready to paste. */
export const load: PageServerLoad = async ({ setHeaders, url }) => {
	setHeaders({ 'cache-control': 'public, max-age=300' });
	return {
		origin: url.origin,
		spots: snowingNow().catch((err) => {
			console.warn(`[snowing] ${(err as Error).message}`);
			return null;
		}),
		description:
			'Mountain passes, ski areas and parks where it is snowing now, from USDA snow gauges and each state’s pass reports.',
		crumbs: [{ name: 'Where it’s snowing', path: '/snowing' }],
		canonical: '/snowing'
	};
};
