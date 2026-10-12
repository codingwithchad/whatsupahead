import type { PassStatus } from './passes';

// How often a pass needed chains or closed. The states publish today's report but keep no history we can
// read, so the server writes down each pass's worst report of every day, from the day it started keeping track.

/** The worst report of a day; `none` when there was no live report (out of season, or the feed was down). */
export type DayStatus = 'closed' | 'chains' | 'traction' | 'open' | 'none';
const ORDER: DayStatus[] = ['closed', 'chains', 'traction', 'open', 'none'];

/** Pass id, then local date ("2026-12-03"), then that day's worst report. */
export type PassHistory = Record<string, Record<string, DayStatus>>;

export const worstDay = (a: DayStatus | undefined, b: DayStatus): DayStatus =>
	a === undefined || ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a;

export function toDayStatus(status: PassStatus): DayStatus {
	return status === 'off-season' ? 'none' : status;
}

/** The calendar date at `ms` in the time zone, as "YYYY-MM-DD". */
export function localDay(ms: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone }).format(ms);
}

/** Note a report: the day keeps its worst. Returns true when that changed what is stored. */
export function recordReport(
	h: PassHistory,
	passId: string,
	day: string,
	status: DayStatus
): boolean {
	const days = (h[passId] ??= {});
	const next = worstDay(days[day], status);
	if (days[day] === next) return false;
	days[day] = next;
	return true;
}

/** Two copies of the history (two servers during a deploy) combined: each day keeps the worst of both. */
export function mergeHistory(a: PassHistory, b: PassHistory): PassHistory {
	const out: PassHistory = structuredClone(a);
	for (const [id, days] of Object.entries(b))
		for (const [day, status] of Object.entries(days)) recordReport(out, id, day, status);
	return out;
}

/** Drop days older than `keepDays` before `today`. */
export function pruneHistory(h: PassHistory, today: string, keepDays = 400): PassHistory {
	const cutoff = addDays(today, -keepDays);
	const out: PassHistory = {};
	for (const [id, days] of Object.entries(h)) {
		const kept = Object.entries(days).filter(([day]) => day >= cutoff);
		if (kept.length) out[id] = Object.fromEntries(kept);
	}
	return out;
}

export function addDays(day: string, n: number): string {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

export interface SeasonSummary {
	/** The first day we have, this season. */
	since: string;
	/** Days with a live report this season. */
	reported: number;
	chains: number;
	closed: number;
	traction: number;
	lastChains: string | null;
	lastClosed: string | null;
	/** The last `recentDays` days, oldest first, for a strip of coloured squares (null = not tracked yet). */
	recent: { day: string; status: DayStatus | null }[];
}

/** A winter season runs from July to June, named by the year it starts in. */
export const seasonStart = (day: string) => {
	const [y, m] = day.split('-').map(Number);
	return `${m >= 7 ? y : y - 1}-07-01`;
};

export function seasonSummary(
	days: Record<string, DayStatus> | undefined,
	today: string,
	recentDays = 30
): SeasonSummary | null {
	const start = seasonStart(today);
	const season = Object.entries(days ?? {})
		.filter(([day]) => day >= start && day <= today)
		.sort(([a], [b]) => a.localeCompare(b));
	if (!season.length) return null;
	const count = (s: DayStatus) => season.filter(([, v]) => v === s).length;
	const last = (s: DayStatus) => season.filter(([, v]) => v === s).at(-1)?.[0] ?? null;
	const recent = Array.from({ length: recentDays }, (_, i) => {
		const day = addDays(today, i - recentDays + 1);
		return { day, status: days?.[day] ?? null };
	});
	return {
		since: season[0][0],
		reported: season.filter(([, v]) => v !== 'none').length,
		chains: count('chains'),
		closed: count('closed'),
		traction: count('traction'),
		lastChains: last('chains'),
		lastClosed: last('closed'),
		recent
	};
}
