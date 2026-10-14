import { getCatalog } from '../../lib/server/catalog';
import { azureMapsKey } from '../../lib/server/azureMaps';
import { mapsUsage } from '../../lib/server/mapsBudget';
import { dayOf, NO_COUNT_COOKIE, statsReady, statsReport, type Day } from '../../lib/server/stats';
import type { Actions, PageServerLoad } from './$types';

/** Sum the tables of several days and list them biggest first. */
function total(days: Day[], pick: (d: Day) => Record<string, number>, limit = 15) {
	const sum: Record<string, number> = {};
	for (const d of days) for (const [k, v] of Object.entries(pick(d))) sum[k] = (sum[k] ?? 0) + v;
	return Object.entries(sum)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit);
}

const DAY_MS = 86_400_000;
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

/**
 * The site's own visit counts. Not linked from anywhere and hidden from search engines.
 * `?day=2026-10-13` shows one day (to line a post up with the visits it brought), `?range=30` the last 30 days;
 * the last 7 days otherwise.
 */
export const load: PageServerLoad = async ({ url, cookies, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
	await statsReady();
	const { since, days, storage, lastSave } = statsReport();
	const { places, collections, passes } = getCatalog();
	const names = new Map<string, string>([
		...places.map((p) => [p.id, p.name] as [string, string]),
		...passes.map((p) => [`pass:${p.id}`, `${p.name} (pass page)`] as [string, string]),
		...collections.map((c) => [`collection:${c.id}`, `${c.name} (list)`] as [string, string])
	]);

	const today = dayOf();
	const asked = url.searchParams.get('day') ?? '';
	const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : null;
	const range = url.searchParams.get('range') === '30' ? 30 : 7;
	const from = day ?? dayOf(Date.now() - (range - 1) * DAY_MS);
	const picked = days.filter(([d]) => d >= from && d <= (day ?? today)).map(([, d]) => d);

	const sum = (pick: (d: Day) => Record<string, number> | undefined) => {
		const out: Record<string, number> = {};
		for (const d of picked)
			for (const [k, v] of Object.entries(pick(d) ?? {})) out[k] = (out[k] ?? 0) + v;
		return out;
	};
	const hours = sum((d) => d.hours);
	const arrivals = sum((d) => d.arrivals);

	return {
		since,
		storage: storage.startsWith('blob') ? 'cloud storage' : 'a file on the server',
		lastSave,
		// Paid map requests this month (counted only when a key is set), against the free amounts.
		maps: azureMapsKey() ? mapsUsage() : null,
		today,
		yesterday: dayOf(Date.now() - DAY_MS),
		oldest: days[days.length - 1]?.[0] ?? today,
		day,
		range: day ? null : range,
		counted: !cookies.get(NO_COUNT_COOKIE),
		daily: days.slice(0, 30).map(([day, d]) => ({
			day,
			visitors: d.visitors,
			views: Object.values(d.views).reduce((a, b) => a + b, 0)
		})),
		picked: {
			visitors: picked.reduce((a, d) => a + d.visitors, 0),
			views: picked.reduce((a, d) => a + Object.values(d.views).reduce((x, y) => x + y, 0), 0),
			// Counted by the hour only from 2026-10-14.
			hourly: picked.some((d) => d.hours)
				? HOURS.map((hour) => ({ hour, people: arrivals[hour] ?? 0, pages: hours[hour] ?? 0 }))
				: null,
			pages: total(picked, (d) => d.views),
			places: total(picked, (d) => d.places).map(([id, n]) => [names.get(id) ?? id, n]),
			fromHome: total(picked, (d) =>
				Object.fromEntries(Object.entries(d.flows).filter(([k]) => k.startsWith('home > ')))
			),
			flows: total(picked, (d) => d.flows),
			sources: total(picked, (d) => d.sources),
			events: total(picked, (d) => d.events),
			searches: picked.reduce(
				(a, d) => ({
					found: a.found + d.searches.found,
					notFound: a.notFound + d.searches.notFound
				}),
				{ found: 0, notFound: 0 }
			)
		}
	};
};

export const actions: Actions = {
	/** Stop counting this phone or browser (for testing the site ourselves); `count` undoes it. */
	nocount: ({ cookies }) => {
		cookies.set(NO_COUNT_COOKIE, '1', {
			path: '/',
			maxAge: 400 * 24 * 3600,
			httpOnly: true,
			sameSite: 'lax'
		});
		return { counted: false };
	},
	count: ({ cookies }) => {
		cookies.delete(NO_COUNT_COOKIE, { path: '/' });
		return { counted: true };
	}
};
