import { getCatalog } from '../../lib/server/catalog';
import { allPassReports } from '../../lib/server/passes';
import { REGIONS, regionAt } from '../../lib/regions';
import type { PageServerLoad } from './$types';

// Washington, then Oregon, then California, north to south; a group not listed here goes at the end.
const GROUP_ORDER = [
	'Cross-Cascades',
	'Foothills and ski roads',
	'Eastern Washington',
	'Oregon Cascades',
	'Southern Oregon',
	'Eastern Oregon',
	'Lake Tahoe and I-80',
	'Sierra crossings',
	'Eastern Sierra (US 395)',
	'Northern California',
	'Southern California'
];

export const load: PageServerLoad = async ({ setHeaders }) => {
	const { passes, places } = getCatalog();
	const live = await allPassReports(passes);
	setHeaders({ 'cache-control': 'public, max-age=60' });
	const rows = passes.map((p) => ({
		...p,
		href: `/passes/${encodeURIComponent(p.id)}`,
		report: live.get(p.id) ?? null
	}));
	const names = [...GROUP_ORDER, ...new Set(passes.map((p) => p.group))].filter(
		(g, i, all) => all.indexOf(g) === i
	);
	const groups = names
		.map((name) => ({
			name,
			passes: rows.filter((r) => r.group === name)
		}))
		.filter((g) => g.passes.length);
	// Passes in other states have a place (cameras and forecast) but no live report source yet; list them by state.
	const reported = new Set(passes.map((p) => p.place));
	const others = places.filter(
		(p) =>
			(p.collection === 'passes' || p.id === 'mount-hood') &&
			!reported.has(p.id) &&
			regionAt(p.lat, p.lon)?.abbr !== 'WA'
	);
	for (const state of [...new Set(others.map((p) => p.state ?? regionAt(p.lat, p.lon)?.name))])
		groups.push({
			name: state ?? 'Other passes',
			passes: others
				.filter((p) => (p.state ?? regionAt(p.lat, p.lon)?.name) === state)
				.map((p) => ({
					id: p.id,
					name: p.name,
					lat: p.lat,
					lon: p.lon,
					place: p.id,
					href: `/search?place=${encodeURIComponent(p.id)}`,
					connects: p.blurb ?? '',
					report: null
				})) as unknown as (typeof rows)[number][]
		});
	// Each state folds on the page (most people want one state), worst news first in its summary line.
	const stateOf = (g: (typeof groups)[number]) => {
		const p = g.passes[0];
		return regionAt(p.lat, p.lon)?.name ?? g.name;
	};
	const states = REGIONS.map((r) => r.name)
		.concat(groups.map(stateOf))
		.filter((n, i, all) => all.indexOf(n) === i)
		.map((name) => {
			const mine = groups.filter((g) => stateOf(g) === name);
			const all = mine.flatMap((g) => g.passes);
			const closed = all.filter((p) => p.report?.status === 'closed').length;
			const chains = all.filter((p) => p.report?.status === 'chains').length;
			return { name, groups: mine, count: all.length, closed, chains };
		})
		.filter((s) => s.count);
	const counts: Record<string, number> = {};
	for (const r of rows)
		counts[r.report?.status ?? 'unknown'] = (counts[r.report?.status ?? 'unknown'] ?? 0) + 1;
	return { states, counts, reachable: live.size > 0 };
};
