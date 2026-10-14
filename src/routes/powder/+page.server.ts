import { getCatalog } from '../../lib/server/catalog';
import { passesOnTheWay, powderDay, type PowderWay } from '../../lib/server/powder';
import { resolvePlace } from '../../lib/server/trip';
import type { PageServerLoad } from './$types';

const HOURS = [2, 3, 4, 5];

/** Powder day: the ski areas within a few hours' drive of a place, most new snow first. */
export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const fromQ = url.searchParams.get('from')?.trim().slice(0, 120) ?? '';
	const asked = Number(url.searchParams.get('hours'));
	const hours = HOURS.includes(asked) ? asked : 3;
	const base = {
		fromQ,
		hours,
		choices: HOURS,
		description:
			'Ski areas within a few hours of you, most new snow first: real drive times, independent snow gauges and the passes on the way.',
		crumbs: [{ name: 'Powder day', path: '/powder' }]
	};
	if (!fromQ) return { ...base, from: null, error: null, spots: null, ways: null };

	let from;
	try {
		from = await resolvePlace(fromQ, getCatalog().places);
	} catch {
		return {
			...base,
			from: null,
			error: 'The location search is not responding. Try again in a moment.',
			spots: null,
			ways: null
		};
	}
	if (!from)
		return { ...base, from: null, error: `Couldn't find “${fromQ}”.`, spots: null, ways: null };
	setHeaders({ 'cache-control': 'private, max-age=60' });
	// Streamed: the list (drive times and snow), then the passes on the way to the first few.
	const spots = powderDay(from, hours).catch(() => null);
	const ways: Promise<Record<string, PowderWay>> = spots
		.then((s) => (s?.length ? passesOnTheWay(from, s) : {}))
		.catch(() => ({}));
	return {
		...base,
		from: { label: from.label, lat: from.lat, lon: from.lon },
		error: null,
		spots,
		ways
	};
};
