import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// How many Azure Maps requests of each kind this calendar month, so the app stays inside Azure's free monthly
// amounts. The count is saved to a small file (next to the visit counts), so restarts and deploys don't start
// it again from zero. Past the month's amount, or a day's share of it, callers use the free services instead.

export type MapsKind = 'route' | 'search' | 'weather';

/** Free requests a month (Azure Maps pricing, checked 2026-10-12), less a margin for anything we miss. */
const FREE: Record<MapsKind, number> = { route: 1000, search: 5000, weather: 1000 };
const MARGIN = 0.9;
/** One busy day may use up to three days' share, so a burst can't spend the whole month. */
const DAY_SHARE = 3 / 30;

const FILE =
	process.env.AZURE_MAPS_USAGE_FILE ||
	path.join(path.dirname(process.env.STATS_FILE || '.stats/stats.json'), 'azure-maps-usage.json');

export interface MapsUsage {
	month: string;
	day: string;
	monthly: Record<MapsKind, number>;
	daily: Record<MapsKind, number>;
}

const zero = (): Record<MapsKind, number> => ({ route: 0, search: 0, weather: 0 });
const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

let usage: MapsUsage | null = null;

function load(now: number): MapsUsage {
	if (!usage) {
		try {
			usage = JSON.parse(readFileSync(FILE, 'utf8')) as MapsUsage;
		} catch {
			usage = { month: monthOf(now), day: dayOf(now), monthly: zero(), daily: zero() };
		}
	}
	// A new month or day starts its count again (Azure bills by calendar month, UTC).
	if (usage.month !== monthOf(now)) usage = { ...usage, month: monthOf(now), monthly: zero() };
	if (usage.day !== dayOf(now)) usage = { ...usage, day: dayOf(now), daily: zero() };
	return usage;
}

function save(u: MapsUsage) {
	try {
		mkdirSync(path.dirname(FILE), { recursive: true });
		writeFileSync(`${FILE}.tmp`, JSON.stringify(u));
		renameSync(`${FILE}.tmp`, FILE);
	} catch (err) {
		console.warn(`[azure-maps] could not save the usage count: ${(err as Error).message}`);
	}
}

/** The most this month and this day, from the free amount (or AZURE_MAPS_MONTHLY_<KIND> if set). */
export function limits(kind: MapsKind): { month: number; day: number } {
	const set = Number(process.env[`AZURE_MAPS_MONTHLY_${kind.toUpperCase()}`]);
	const month = set > 0 ? set : Math.floor(FREE[kind] * MARGIN);
	return { month, day: Math.max(1, Math.ceil(month * DAY_SHARE)) };
}

/** Count one request if there is room this month and today; false means use the free service. */
export function takeMapsRequest(kind: MapsKind, now = Date.now()): boolean {
	const u = load(now);
	const max = limits(kind);
	if (u.monthly[kind] >= max.month || u.daily[kind] >= max.day) return false;
	u.monthly[kind]++;
	u.daily[kind]++;
	save(u);
	return true;
}

/** This month's counts and limits, for the stats page. */
export function mapsUsage(now = Date.now()) {
	const u = load(now);
	return (['route', 'search', 'weather'] as const).map((kind) => {
		const max = limits(kind);
		return {
			kind,
			month: u.monthly[kind],
			today: u.daily[kind],
			monthLimit: max.month,
			dayLimit: max.day
		};
	});
}

/** For tests. */
export function _resetMapsUsage() {
	usage = null;
}
