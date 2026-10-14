import { regionAt } from '../../lib/regions';
import { getCatalog } from '../../lib/server/catalog';
import type { PageServerLoad } from './$types';

/**
 * Every place we cover as a tree: region (state) at the top, then the kinds of place (mountain passes,
 * ferries, airfields...), then the places themselves.
 */
export const load: PageServerLoad = () => {
	const { places, collections } = getCatalog();
	const row = (p: (typeof places)[number]) => ({ id: p.id, name: p.name, blurb: p.blurb ?? '' });

	const groups = [
		{ id: 'places', name: 'Featured places', match: (p: (typeof places)[number]) => !p.collection },
		...collections.map((c) => ({
			id: c.id,
			name: c.name,
			match: (p: (typeof places)[number]) =>
				p.collection === c.id || Boolean(c.also?.includes(p.id))
		}))
	];

	// Group by the state a place is in: its own "state" field, or the region its coordinates fall in.
	const stateOf = (p: (typeof places)[number]) =>
		p.state ?? regionAt(p.lat, p.lon)?.name ?? 'Other places';
	// A place on a state line (Heavenly) is listed under each of its states.
	const inState = (p: (typeof places)[number], name: string) =>
		stateOf(p) === name || Boolean(p.also_states?.includes(name));
	const regionNames = [...new Set(places.map(stateOf))].sort((a, b) => a.localeCompare(b));
	const regions = regionNames.map((name) => {
		const inRegion = places.filter((p) => inState(p, name));
		return {
			name,
			total: inRegion.length,
			groups: groups
				.map((g) => ({ id: g.id, name: g.name, places: inRegion.filter(g.match).map(row) }))
				.filter((g) => g.places.length)
		};
	});
	return { regions, total: places.length };
};
