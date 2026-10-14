import { distanceMiles, type Point } from '../geo';
import { getCatalog } from './catalog';
import { driveTimes } from './routing';
import { safeRoute } from './safeRoute';
import { skiSnow, type SkiSnow } from './skiSnow';
import { passesNow, roadPass, type RoadPass } from './tripLive';

// Powder day: the ski areas within a few hours' drive of you, most new snow first. Drive times are real driving
// routes (one request for all of them); straight-line distance only rules out what no drive could reach in time.

/** A drive this long covers at most this many straight-line miles (60 mph on a straight road, plus room). */
const MAX_MPH = 65;

export interface PowderSpot {
	id: string;
	name: string;
	state: string;
	minutes: number;
	snow: SkiSnow | null;
}

/** New snow for ranking: the last 24 hours, then since 6 AM, then what's still to fall today (gauge wobble aside). */
export function powderScore(s: SkiSnow | null): number {
	if (!s) return -1;
	const day = (s.change24 ?? 0) >= 2 ? s.change24! : 0;
	const morning = (s.sinceSix ?? 0) >= 1 && (s.depthIn ?? 0) >= 2 ? s.sinceSix! : 0;
	return day * 1000 + morning * 10 + (s.forecastIn ?? 0);
}

/** Ski areas you can drive to within `hours`, most new snow first, then the shortest drive. */
export async function powderDay(from: Point, hours: number): Promise<PowderSpot[]> {
	const { places, collections } = getCatalog();
	// The ski areas list also takes in pass places with a ski area at the top (Snoqualmie, Stevens, Mount Hood).
	const also = new Set(collections.find((c) => c.id === 'ski-areas')?.also ?? []);
	const near = places.filter(
		(p) =>
			(p.collection === 'ski-areas' || also.has(p.id)) && distanceMiles(from, p) <= hours * MAX_MPH
	);
	const minutes = await driveTimes(from, near);
	const reachable = near
		.map((p, i) => ({ p, minutes: minutes[i] }))
		.filter((x): x is { p: (typeof near)[number]; minutes: number } => x.minutes !== null)
		.filter((x) => x.minutes <= hours * 60);
	const snow = reachable.length ? await skiSnow(reachable.map((x) => x.p)).catch(() => null) : null;
	return reachable
		.map(({ p, minutes }) => ({
			id: p.id,
			name: p.name,
			state: p.state ?? '',
			minutes,
			snow: snow?.[p.id] ?? null
		}))
		.sort((a, b) => powderScore(b.snow) - powderScore(a.snow) || a.minutes - b.minutes);
}

/** The drive to one of the first few, the way the drive page plans it: around closed passes. */
export interface PowderWay {
	minutes: number;
	passes: RoadPass[];
	/** Passes closed on the direct road, gone around ("Chinook Pass"). */
	avoided: string[];
	/** Closed with no open way around. */
	blocked: string[];
}

/**
 * The drive to each of the first few, by ski area id: around closed passes (as the drive page plans it, so a road
 * shut for the winter is not the way), its time and the passes on it with their reports. Free routing only.
 */
export async function passesOnTheWay(
	from: Point,
	spots: PowderSpot[],
	count = 5
): Promise<Record<string, PowderWay>> {
	const { places } = getCatalog();
	const pairs = await Promise.all(
		spots.slice(0, count).map(async (s): Promise<[string, PowderWay] | null> => {
			const place = places.find((p) => p.id === s.id);
			if (!place) return null;
			try {
				const safe = await safeRoute(from, place, [], { free: true });
				return [
					s.id,
					{
						minutes: Math.round(safe.route.minutes),
						passes: safe.passes.map(roadPass),
						avoided: safe.avoided.map((a) => a.closed),
						blocked: safe.blocked
					}
				];
			} catch {
				return null;
			}
		})
	);
	return Object.fromEntries(pairs.filter((x): x is [string, PowderWay] => x !== null));
}
