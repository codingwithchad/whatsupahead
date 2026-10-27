import { getCatalog } from '../../lib/server/catalog';
import { allPassReports } from '../../lib/server/passes';
import { REGIONS, regionAt } from '../../lib/regions';
import { AREAS, areaById, inArea } from '../../lib/areas';
import { previewSlot } from '../../lib/sharing';
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

export const load: PageServerLoad = async ({ setHeaders, url }) => {
	// `?in=utah` or `?in=sierra`: one state or mountain area, so a storm can be shared on its own.
	const area = areaById(url.searchParams.get('in'));
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
	// Each state folds on the page (most people want one state), worst news first in its summary line. A group
	// can cross a state line (Lake Tahoe's passes are in California and Nevada), so each pass goes under its own state.
	const stateOf = (p: (typeof rows)[number], g: (typeof groups)[number]) =>
		regionAt(p.lat, p.lon)?.name ?? g.name;
	const stateNames = REGIONS.map((r) => r.name)
		.concat(groups.flatMap((g) => g.passes.map((p) => stateOf(p, g))))
		.filter((n, i, all) => all.indexOf(n) === i);
	const byState = (name: string, only: typeof area) =>
		groups
			.map((g) => ({
				...g,
				passes: g.passes.filter((p) => stateOf(p, g) === name && (!only || inArea(only, p, [name])))
			}))
			.filter((g) => g.passes.length);
	// The picker offers only areas that have a pass.
	const areas = AREAS.filter((a) => stateNames.some((n) => byState(n, a).length));
	const states = stateNames
		.map((name) => {
			const mine = byState(name, area);
			const all = mine.flatMap((g) => g.passes);
			// A road shut for the winter is closed all season: not counted, as on the home page.
			const closed = all.filter((p) => p.report?.status === 'closed' && !p.winter_closure).length;
			const chains = all.filter((p) => p.report?.status === 'chains').length;
			return { name, groups: mine, count: all.length, closed, chains };
		})
		.filter((s) => s.count);
	// The summary counts passes with a report source (as before), in the area shown.
	const ids = new Set(passes.map((p) => p.id));
	const counts: Record<string, number> = {};
	for (const r of states.flatMap((s) => s.groups.flatMap((g) => g.passes)))
		if (ids.has(r.id))
			counts[r.report?.status ?? 'unknown'] = (counts[r.report?.status ?? 'unknown'] ?? 0) + 1;
	const shown = states.reduce((n, s) => n + s.count, 0);
	const title = area ? `Mountain passes: ${area.name}` : 'Mountain passes';
	const path = area ? `/passes?in=${area.id}` : '/passes';
	return {
		states,
		counts,
		area,
		areas,
		title,
		path,
		reachable: live.size > 0,
		description: area
			? `Is the pass open? Chains, closures and cameras for ${shown} mountain passes in ${area.kind === 'state' ? '' : 'the '}${area.name}, from each state's own reports.`
			: `Is the pass open? Chains, closures and cameras for ${passes.length} mountain passes in Washington, Oregon, California, Idaho, Nevada and Utah, from each state's own reports. Free, no app needed.`,
		// An area's link gets its own preview picture: camera pictures from there.
		share: area
			? {
					title,
					description: `Open or closed, chains and cameras for ${shown} passes, from each state's own reports.`,
					image: `/og/collection/passes?in=${area.id}&v=${previewSlot()}`,
					imageAlt: `Camera pictures from mountain passes in ${area.name}`
				}
			: undefined,
		crumbs: [{ name: 'Mountain passes', path: '/passes' }],
		canonical: path
	};
};
