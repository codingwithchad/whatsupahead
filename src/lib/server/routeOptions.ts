import { distanceMiles, type Point } from '../geo';
import { blocksRoad } from '../passes';
import type { LatLon } from '../route';
import type { PassInfo } from '../types';
import { getCatalog } from './catalog';
import { allPassReports } from './passes';
import { drivingRoute } from './routing';
import { passesNow, type RoadPass } from './tripLive';

// Other ways over the mountains for a drive: the same start and end over each nearby pass that crosses the same
// range, so a driver can pick by conditions and not only by time ("Snoqualmie: no chains, 25 minutes longer").
// Worked out with the free routing service only, and streamed, so the page never waits for it.

export interface RouteOption {
	/** The pass this way goes over, and the point to send as a stop to drive it. */
	pass: { id: string; name: string; route: string; lat: number; lon: number };
	/** Every pass this way goes over, by name ("Snoqualmie Pass and Blewett Pass"). */
	label: string;
	miles: number;
	minutes: number;
	/** Every pass on this way, with its report. */
	passes: RoadPass[];
	/** The line, thinned to about 150 points, for the small map. */
	line: LatLon[];
}

export interface RouteOptions {
	/** The drive's own time from the same routing service as the options, so the difference is fair. */
	baseline: number | null;
	options: RouteOption[];
}

const MAX_OPTIONS = 3;
const NEAR_MILES = 120;
const MAX_POINTS = 150;

/** About `max` points along the line, keeping both ends. */
export function thinLine(line: LatLon[], max = MAX_POINTS): LatLon[] {
	if (line.length <= max) return line;
	const step = (line.length - 1) / (max - 1);
	return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
}

export async function routeOptions(
	from: Point,
	to: Point,
	current: { passes: { pass: PassInfo }[] }
): Promise<RouteOptions> {
	const none = { baseline: null, options: [] };
	const crossed = current.passes.map((p) => p.pass);
	if (!crossed.length) return none;
	const { passes } = getCatalog();
	const groups = new Set(crossed.map((p) => p.group));
	const crossedIds = new Set(crossed.map((p) => p.id));
	// Passes over the same range, near the one this drive crosses, cheapest detour first.
	const candidates = passes
		.filter(
			(p) =>
				!crossedIds.has(p.id) &&
				groups.has(p.group) &&
				crossed.some((c) => distanceMiles(c, p) <= NEAR_MILES)
		)
		.sort(
			(a, b) =>
				distanceMiles(from, a) +
				distanceMiles(a, to) -
				(distanceMiles(from, b) + distanceMiles(b, to))
		)
		.slice(0, MAX_OPTIONS + 1);
	if (!candidates.length) return none;
	const reports = await allPassReports(candidates);
	const baseline = await drivingRoute(from, to, [], { free: true })
		.then((r) => r.minutes)
		.catch(() => null);
	const now = Date.now();
	const tries = await Promise.all(
		candidates
			// A road closed for the winter (by its report, or usually by now) is not a way across this time of year.
			.filter((p) => !blocksRoad(p, reports.get(p.id), now))
			.map(async (p) => {
				try {
					const route = await drivingRoute(from, to, [p], { free: true });
					const over = await passesNow(route.coords);
					// Only a way that really goes over this pass and not over the one the drive already takes.
					if (!over.some((o) => o.id === p.id) || over.some((o) => crossedIds.has(o.id)))
						return null;
					return {
						pass: { id: p.id, name: p.name, route: p.route, lat: p.lat, lon: p.lon },
						label: crossingLabel(over, groups, p.name),
						miles: route.miles,
						minutes: route.minutes,
						passes: over,
						line: thinLine(route.coords)
					} satisfies RouteOption;
				} catch {
					return null;
				}
			})
	);
	// Two stops can give the same road (Blewett and Snoqualmie from Seattle both cross both): keep one of each.
	// A way more than an hour (or half the drive) longer isn't one anybody would take.
	const seen = new Set<string>();
	const longest = baseline === null ? Infinity : baseline + Math.max(60, baseline / 2);
	return {
		baseline,
		options: tries
			.filter((t): t is RouteOption => t !== null && t.minutes <= longest)
			.sort((a, b) => a.minutes - b.minutes)
			.filter((t) => {
				// The same passes as a faster way, or those passes plus a detour, is not another way.
				const ids = new Set(t.passes.map((p) => p.id));
				if ([...seen].some((key) => key.split('+').every((id) => ids.has(id)))) return false;
				seen.add([...ids].sort().join('+'));
				return true;
			})
			.slice(0, MAX_OPTIONS)
	};
}

/** "Cayuse Pass and Chinook Pass": the passes across the same mountains, not every summit on the way. */
export function crossingLabel(
	over: { id: string; name: string }[],
	groups: Set<string>,
	fallback: string
): string {
	const group = new Map(getCatalog().passes.map((p) => [p.id, p.group]));
	const names = over.filter((o) => groups.has(group.get(o.id) ?? '')).map((o) => o.name);
	const list = names.length ? names : [fallback];
	return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
}
