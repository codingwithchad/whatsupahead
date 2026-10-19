import { error } from '@sveltejs/kit';
import { APP_NAME } from '../../../lib/brand';
import { driveTripLink } from '../../../lib/seasonalDrives';
import type { Drive } from '../../../lib/types';
import { getCatalog } from '../../../lib/server/catalog';
import { crossingTimes } from '../../../lib/server/crossing';
import { allPassReports } from '../../../lib/server/passes';
import { safeRoute, type PassOnRoute, type SafeRoute } from '../../../lib/server/safeRoute';
import { resolvePlace, tripLine } from '../../../lib/server/trip';
import { roadPass } from '../../../lib/server/tripLive';
import type { PageServerLoad } from './$types';

// A featured drive (Seattle to Leavenworth) at an address search engines can keep: the passes on the way with
// their reports now and the best time to cross, with a link to the live drive page. Drive pages themselves stay
// out of search results (every pair of places is a page); these few are the ones people look up by name.
// Routed by the free service only, so a search engine reading them never spends the paid map allowance.

/** Each drive's last route, for when routing is busy (a search engine reading every drive at once). */
const lastRoute = new Map<string, SafeRoute>();

/** The drive's route and the passes on it, a drive that ends at a pass (Seattle to Snoqualmie Pass) included. */
async function driveRoute(drive: Drive): Promise<SafeRoute | null> {
	const { places, passes } = getCatalog();
	try {
		const [from, to] = await Promise.all([
			resolvePlace(drive.from, places),
			resolvePlace(drive.to, places)
		]);
		if (!from || !to) return null;
		const safe = await safeRoute(from, to, [], { free: true });
		const end = passes.find((p) => p.place === to.featured?.id);
		if (end && !safe.passes.some((p) => p.pass.id === end.id)) {
			const report = (await allPassReports([end])).get(end.id) ?? null;
			safe.passes.push({ pass: end, along: safe.route.miles, heading: null, report });
		}
		lastRoute.set(drive.id, safe);
		return safe;
	} catch (err) {
		console.warn(`[drives] ${drive.id}: ${(err as Error).message}`);
	}
	// The last route with today's pass reports; whether a closed pass was gone around is not known now.
	const last = lastRoute.get(drive.id);
	if (!last) return null;
	const reports = await allPassReports(last.passes.map((p) => p.pass));
	const withReports: PassOnRoute[] = last.passes.map((p) => ({
		...p,
		report: reports.get(p.pass.id) ?? null
	}));
	return { route: last.route, passes: withReports, avoided: [], blocked: [] };
}

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const { drives } = getCatalog();
	const drive = drives.find((d) => d.id === params.id);
	if (!drive) error(404, 'No such drive');

	const others = drives
		.filter((d) => d.id !== drive.id && d.state === drive.state)
		.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
		.map((d) => ({ id: d.id, name: d.name, blurb: d.blurb ?? '' }));
	const safe = await driveRoute(drive);
	setHeaders({ 'cache-control': 'public, max-age=60' });

	const passes = safe?.passes.map(roadPass) ?? [];
	const names = passes.map((p) => p.name);
	// A drive that ends at a pass is named for it already.
	const crossed = passes.filter((p) => safe && p.along < safe.route.miles).map((p) => p.name);
	const over = crossed.length ? `${crossed.slice(0, 2).join(' and ')} ` : '';
	const pageTitle = names.length
		? `${drive.name} Road Conditions: ${over}Cameras, Chains & When to Leave · ${APP_NAME}`
		: `${drive.name}: Road Cameras & Weather on the Way · ${APP_NAME}`;
	const now = passes
		.filter((p) => p.report && p.report.status !== 'off-season')
		.map((p) => `${p.name} ${p.report!.label.toLowerCase()}`)
		.join(', ');
	const description = [
		now ? `${drive.name} right now: ${now}.` : `${drive.name}.`,
		safe ? tripLine(safe.route.miles, safe.route.minutes, crossed) : '',
		names.length
			? 'Cameras in the order you pass them, chains for your car, and when to leave to miss the snow at the summit.'
			: 'Cameras in the order you pass them and the weather for when you get there.',
		'Free, no app needed.'
	]
		.filter(Boolean)
		.join(' ');

	// The highest pass on the way, as the drive page picks it, with the drive there from the start.
	const top = safe
		? [...safe.passes].sort((a, b) => (b.pass.elevation_ft ?? 0) - (a.pass.elevation_ft ?? 0))[0]
		: undefined;
	return {
		drive: { id: drive.id, name: drive.name, blurb: drive.blurb ?? '' },
		tripLink: driveTripLink(drive),
		others,
		pageTitle,
		description,
		route: safe ? { miles: safe.route.miles, minutes: safe.route.minutes } : null,
		passes,
		avoided: safe?.avoided ?? [],
		blocked: safe?.blocked ?? [],
		crossing:
			safe && top
				? crossingTimes(
						top.pass,
						(safe.route.minutes * top.along) / Math.max(safe.route.miles, 0.1)
					).catch(() => null)
				: Promise.resolve(null),
		crumbs: [
			{ name: 'Popular drives', path: '/drives' },
			{ name: drive.name, path: `/drives/${encodeURIComponent(drive.id)}` }
		],
		canonical: `/drives/${encodeURIComponent(drive.id)}`
	};
};
