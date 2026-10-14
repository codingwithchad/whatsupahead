import { redirect } from '@sveltejs/kit';
import { getCatalog } from '../../lib/server/catalog';
import { placePage } from '../../lib/server/placePage';
import { skiSnow } from '../../lib/server/skiSnow';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, setHeaders, locals }) => {
	const { places, passes } = getCatalog();
	const placeId = url.searchParams.get('place');
	// A search that names one of our places ("Mount Hood", "stevens pass") opens that place.
	const typed = url.searchParams.get('q')?.trim().toLowerCase();
	const featured =
		places.find((p) => p.id === placeId) ??
		(typed ? places.find((p) => p.name.toLowerCase() === typed) : undefined);
	// Mountain passes have their own page; old links and searches go there.
	const pass = featured && passes.find((p) => p.place === featured.id);
	if (pass) {
		const keep = new URLSearchParams();
		for (const k of ['r', 'all']) {
			const v = url.searchParams.get(k);
			if (v) keep.set(k, v);
		}
		redirect(301, `/passes/${encodeURIComponent(pass.id)}${keep.size ? `?${keep}` : ''}`);
	}
	const result = await placePage(featured, { url, setHeaders, locals });
	if (!featured) return { ...result, noindex: true };
	const collection = getCatalog().collections.find((c) => c.id === featured.collection);
	return {
		...result,
		snowReport: featured.snow_report_url ?? null,
		// Streamed: snow at a ski area (gauge and today's forecast).
		skiSnow:
			featured.collection === 'ski-areas'
				? skiSnow([featured])
						.then((all) => all[featured.id] ?? null)
						.catch(() => null)
				: null,
		crumbs: [
			collection
				? { name: collection.name, path: `/collections/${encodeURIComponent(collection.id)}` }
				: { name: 'All places', path: '/places' },
			{ name: featured.name, path: `/search?place=${encodeURIComponent(featured.id)}` }
		]
	};
};
