import { getCatalog } from '../../lib/server/catalog';
import { azureMapsKey } from '../../lib/server/azureMaps';
import { mapsUsage } from '../../lib/server/mapsBudget';
import { statsReady, statsReport, type Day } from '../../lib/server/stats';
import type { PageServerLoad } from './$types';

/** Sum the tables of several days and list them biggest first. */
function total(days: Day[], pick: (d: Day) => Record<string, number>, limit = 15) {
	const sum: Record<string, number> = {};
	for (const d of days) for (const [k, v] of Object.entries(pick(d))) sum[k] = (sum[k] ?? 0) + v;
	return Object.entries(sum)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit);
}

/** The site's own visit counts. Not linked from anywhere and hidden from search engines. */
export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
	await statsReady();
	const { since, days, storage, lastSave } = statsReport();
	const { places, collections } = getCatalog();
	const names = new Map<string, string>([
		...places.map((p) => [p.id, p.name] as [string, string]),
		...collections.map((c) => [`collection:${c.id}`, `${c.name} (list)`] as [string, string])
	]);
	const week = days.slice(0, 7).map(([, d]) => d);
	return {
		since,
		storage: storage.startsWith('blob') ? 'cloud storage' : 'a file on the server',
		lastSave,
		// Paid map requests this month (counted only when a key is set), against the free amounts.
		maps: azureMapsKey() ? mapsUsage() : null,
		daily: days.slice(0, 14).map(([day, d]) => ({
			day,
			visitors: d.visitors,
			views: Object.values(d.views).reduce((a, b) => a + b, 0)
		})),
		week: {
			visitors: week.reduce((a, d) => a + d.visitors, 0),
			pages: total(week, (d) => d.views),
			places: total(week, (d) => d.places).map(([id, n]) => [names.get(id) ?? id, n]),
			fromHome: total(week, (d) =>
				Object.fromEntries(Object.entries(d.flows).filter(([k]) => k.startsWith('home > ')))
			),
			flows: total(week, (d) => d.flows),
			sources: total(week, (d) => d.sources),
			events: total(week, (d) => d.events),
			searches: week.reduce(
				(a, d) => ({
					found: a.found + d.searches.found,
					notFound: a.notFound + d.searches.notFound
				}),
				{ found: 0, notFound: 0 }
			)
		}
	};
};
