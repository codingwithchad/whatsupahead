import type { Drive } from '../types';
import { getCatalog } from './catalog';
import type { CrossingStop } from './crossing';
import { allPassReports } from './passes';
import { safeRoute, type PassOnRoute, type SafeRoute } from './safeRoute';
import { resolvePlace } from './trip';

// The featured drives' routes (Seattle to Leavenworth), for their pages and the Facebook Page's "snow on the way"
// posts. Routed by the free service only, so a search engine reading every drive never spends the paid map allowance.

/** Each drive's last route, for when routing is busy (a search engine reading every drive at once). */
const lastRoute = new Map<string, SafeRoute>();

/** The drive's route and the passes on it, a drive that ends at a pass (Seattle to Snoqualmie Pass) included. */
export async function driveRoute(drive: Drive): Promise<SafeRoute | null> {
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

/** The passes on a route in road order, each with the minutes from the start to its summit. */
export function crossingStops(safe: SafeRoute): CrossingStop[] {
	return [...safe.passes]
		.sort((x, y) => x.along - y.along)
		.map((p) => ({
			pass: p.pass,
			minutesToPass: (safe.route.minutes * p.along) / Math.max(safe.route.miles, 0.1)
		}));
}
