import { json } from '@sveltejs/kit';
import { regionAt } from '../../../lib/regions';
import { getCatalog } from '../../../lib/server/catalog';
import { suggestTowns } from '../../../lib/server/gazetteer';
import { photonSearch, type Suggestion } from '../../../lib/server/photon';
import { azureMapsKey, azureSearch } from '../../../lib/server/azureMaps';
import { allow, visitorAddress } from '../../../lib/server/rateLimit';
import type { RequestHandler } from './$types';

// What our own places are called in the list ("Ski area · UT").
const KIND: Record<string, string> = { 'ski-areas': 'Ski area', passes: 'Mountain pass' };

/**
 * Our own places (ski areas, passes, parks...) whose name, or a word in it, starts with what was typed. Picking one
 * puts its exact name in the box, which the drive and place pages know without looking anything up.
 */
function suggestOurs(q: string, limit = 3) {
	// "Mt Hood", "Mt. Hood" and "Mount Hood" are the same name.
	const plain = (s: string) =>
		s
			.toLowerCase()
			.replace(/\bmount\b|\bmt\b\.?/g, 'mt')
			.trim();
	const key = plain(q);
	const { places, collections, passes } = getCatalog();
	const words = (name: string) => name.toLowerCase().split(/[\s(),.-]+/);
	// A place belongs to a list by its own `collection`, a list's `also` (Stevens Pass), or a pass's report.
	const kindOf = (id: string, own?: string) =>
		own ??
		collections.find((c) => c.also?.includes(id))?.id ??
		(passes.some((x) => x.place === id) ? 'passes' : undefined);
	return places
		.map((p) => ({ ...p, collection: kindOf(p.id, p.collection) }))
		.filter((p) => p.collection)
		.map((p) => {
			const name = plain(p.name);
			const rank = name.startsWith(key)
				? 0
				: key.length >= 3 && words(name).some((w) => w.startsWith(key))
					? 1
					: 2;
			return { p, rank };
		})
		.filter((x) => x.rank < 2)
		.sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name))
		.slice(0, limit)
		.map(({ p }) => {
			const kind =
				KIND[p.collection!] ?? collections.find((c) => c.id === p.collection)?.name ?? '';
			const state = regionAt(p.lat, p.lon)?.abbr;
			return {
				label: p.name,
				sub: [kind, state].filter(Boolean).join(' · '),
				lat: p.lat,
				lon: p.lon,
				value: p.name
			};
		});
}

/**
 * Places that match what has been typed so far: our own places first, then towns in the covered regions (both
 * instant), then other places.
 */
export const GET: RequestHandler = async ({ url, request, getClientAddress }) => {
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const who = visitorAddress(request, getClientAddress);
	if (!allow(`suggest:${who}`, 60)) return json({ suggestions: [] }, { status: 429 });
	if (q.length < 2) return json({ suggestions: [] });

	const ours = suggestOurs(q);
	const towns = suggestTowns(q);
	let others: Suggestion[] = [];
	try {
		// Photon first: it is free, and this runs as people type. Azure Maps (paid past a daily allowance) only
		// steps in when Photon is down.
		others = await photonSearch(q, 5);
	} catch {
		try {
			if (azureMapsKey()) others = await azureSearch(q, 5, true);
		} catch {
			// the as-you-type list is a nicety: towns still show if the outside services are down
		}
	}
	const seen = new Set(ours.map((o) => o.label.toLowerCase()));
	const unseen = <T extends { label: string }>(list: T[]) =>
		list.filter((o) => {
			const key = o.label.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	// A few letters ("sea") are most often the start of a town (Seattle); more ("stev", "alta") of a place we know.
	const first = q.length < 4 ? [...unseen(towns), ...ours] : [...ours, ...unseen(towns)];
	const merged = [...first, ...unseen(others)].slice(0, 6);
	return json({ suggestions: merged }, { headers: { 'cache-control': 'private, max-age=300' } });
};
