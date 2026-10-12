import { redirect } from '@sveltejs/kit';
import { getCatalog } from '../../lib/server/catalog';
import { placePage } from '../../lib/server/placePage';
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
	return placePage(featured, { url, setHeaders, locals });
};
