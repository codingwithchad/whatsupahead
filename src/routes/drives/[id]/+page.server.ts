import { error } from '@sveltejs/kit';
import { APP_NAME } from '../../../lib/brand';
import { driveTripLink } from '../../../lib/seasonalDrives';
import { getCatalog } from '../../../lib/server/catalog';
import { crossingTimes } from '../../../lib/server/crossing';
import { crossingStops, driveRoute } from '../../../lib/server/drives';
import { tripLine } from '../../../lib/server/trip';
import { roadPass } from '../../../lib/server/tripLive';
import type { PageServerLoad } from './$types';

// A featured drive (Seattle to Leavenworth) at an address search engines can keep: the passes on the way with
// their reports now and the best time to cross, with a link to the live drive page. Drive pages themselves stay
// out of search results (every pair of places is a page); these few are the ones people look up by name.

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
		crossing: safe?.passes.length ? crossingTimes(crossingStops(safe)) : Promise.resolve(null),
		crumbs: [
			{ name: 'Popular drives', path: '/drives' },
			{ name: drive.name, path: `/drives/${encodeURIComponent(drive.id)}` }
		],
		canonical: `/drives/${encodeURIComponent(drive.id)}`
	};
};
