import { distanceMiles, type Point } from '../geo';
import { blocksRoad, type PassReport } from '../passes';
import { cumulativeMiles, headingAt, projectOnRoute } from '../route';
import type { PassInfo } from '../types';
import { getCatalog } from './catalog';
import { allPassReports } from './passes';
import { drivingRoute, type DrivingRoute } from './routing';
import { passesOnRoute } from './trip';

// Neither routing service knows that a pass is closed (Azure Maps sees some closures in its traffic data,
// OSRM sees none), so every drive is checked against the states' own pass reports. A drive over a closed pass
// goes over an open one instead when there is one, and says so; when there is none, the page says that plainly.

export interface PassOnRoute {
	pass: PassInfo;
	along: number;
	/** Which way the road heads at the pass, so the report for your direction can be picked. */
	heading: number | null;
	report: PassReport | null;
}

export interface SafeRoute {
	route: DrivingRoute;
	passes: PassOnRoute[];
	/** Closed passes the drive now goes around, with the pass it takes instead. */
	avoided: { closed: string; instead: string; extraMinutes: number }[];
	/** Closed passes still on the drive: there was no open way around. */
	blocked: string[];
}

const MAX_TRIES = 4;
const SEARCH_MILES = 150;

function onRoute(route: DrivingRoute, passes: PassInfo[]) {
	const cum = cumulativeMiles(route.coords);
	return passesOnRoute(passes, route.coords, route.miles).map((pass) => {
		const along = projectOnRoute(pass, route.coords, cum).along;
		return { pass, along, heading: headingAt(route.coords, cum, along) };
	});
}

/** The stops with `extra` put in where the closed pass was, so the drive keeps its order. */
function withStop(route: DrivingRoute, via: Point[], at: number, extra: Point): Point[] {
	const cum = cumulativeMiles(route.coords);
	const before = via.filter((v) => projectOnRoute(v, route.coords, cum).along < at);
	return [...before, extra, ...via.slice(before.length)];
}

export async function safeRoute(from: Point, to: Point, via: Point[] = []): Promise<SafeRoute> {
	const all = getCatalog().passes;
	const first = await drivingRoute(from, to, via);
	const crossed = onRoute(first, all);
	if (!crossed.length) return { route: first, passes: [], avoided: [], blocked: [] };

	const reports = await allPassReports(crossed.map((c) => c.pass));
	const now = Date.now();
	const closed = crossed.filter((c) => blocksRoad(c.pass, reports.get(c.pass.id), now));
	if (!closed.length)
		return {
			route: first,
			passes: crossed.map((c) => ({ ...c, report: reports.get(c.pass.id) ?? null })),
			avoided: [],
			blocked: []
		};

	// Some pass is closed: try the open passes nearest it, shortest detour first.
	const allReports = await allPassReports(all);
	const isBlocked = (p: PassInfo) => blocksRoad(p, allReports.get(p.id), now);
	const target = closed[0];
	const crossedIds = new Set(crossed.map((c) => c.pass.id));
	const candidates = all
		.filter(
			(p) => !crossedIds.has(p.id) && !isBlocked(p) && distanceMiles(p, target.pass) <= SEARCH_MILES
		)
		.sort(
			(a, b) =>
				distanceMiles(from, a) +
				distanceMiles(a, to) -
				(distanceMiles(from, b) + distanceMiles(b, to))
		)
		.slice(0, MAX_TRIES);
	const tries = await Promise.all(
		candidates.map(async (p) => {
			try {
				const route = await drivingRoute(from, to, withStop(first, via, target.along, p));
				const over = onRoute(route, all);
				if (over.some((o) => isBlocked(o.pass))) return null;
				if (route.miles > Math.max(first.miles * 3, first.miles + 300)) return null;
				return { pass: p, route, over };
			} catch {
				return null;
			}
		})
	);
	const best = tries
		.filter((t): t is NonNullable<typeof t> => t !== null)
		.sort((a, b) => a.route.minutes - b.route.minutes)[0];

	if (!best)
		return {
			route: first,
			passes: crossed.map((c) => ({ ...c, report: allReports.get(c.pass.id) ?? null })),
			avoided: [],
			blocked: closed.map((c) => c.pass.name)
		};
	return {
		route: best.route,
		passes: best.over.map((c) => ({ ...c, report: allReports.get(c.pass.id) ?? null })),
		avoided: closed.map((c) => ({
			closed: c.pass.name,
			instead: best.pass.name,
			extraMinutes: Math.max(0, best.route.minutes - first.minutes)
		})),
		blocked: []
	};
}
