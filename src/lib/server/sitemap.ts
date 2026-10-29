import { getCatalog } from './catalog';
import { allPassReports } from './passes';

/**
 * The pages search engines should know about: the main pages, every pass, every place and every list. Drive pages
 * are left out (robots.txt keeps search engines off them), except the featured drives' own pages, and so are single
 * cameras. A pass page's `modified` is when its state last updated the report, so a search engine knows to look again.
 */
export async function sitemapPages(): Promise<{ path: string; modified?: number }[]> {
	const { passes, places, collections, drives } = getCatalog();
	const reports = await allPassReports(passes).catch(() => new Map());
	const passPlaces = new Set(passes.map((p) => p.place));
	return [
		...['/', '/passes', '/tires', '/powder', '/drives', '/places', '/about'].map((path) => ({
			path
		})),
		...passes.map((p) => ({
			path: `/passes/${encodeURIComponent(p.id)}`,
			modified: reports.get(p.id)?.updated ?? undefined
		})),
		...places
			.filter((p) => !passPlaces.has(p.id))
			.map((p) => ({ path: `/search?place=${encodeURIComponent(p.id)}` })),
		...drives.map((d) => ({ path: `/drives/${encodeURIComponent(d.id)}` })),
		...collections.map((c) => ({ path: `/collections/${encodeURIComponent(c.id)}` }))
	];
}
