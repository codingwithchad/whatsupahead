import type { Drive } from './types';

// The home page's "Drives this season": what people drive now (Leavenworth for Oktoberfest, the airport at
// Thanksgiving, the ski roads in winter), mixed across the states, instead of one fixed list.

/** The drive page for a featured drive (the live one, worked out when it loads). */
export const driveTripLink = (d: Drive) =>
	`/trip?from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}${d.from_label ? `&fl=${encodeURIComponent(d.from_label)}` : ''}${d.to_label ? `&tl=${encodeURIComponent(d.to_label)}` : ''}`;

/** Is "MM-DD" inside the season? A season may wrap past New Year ("11-15" to "01-05"). */
export function inSeason(season: Drive['season'], monthDay: string): boolean {
	if (!season) return true;
	return season.from <= season.to
		? monthDay >= season.from && monthDay <= season.to
		: monthDay >= season.from || monthDay <= season.to;
}

/** Up to `max` drives in season, taking turns between the states so no one state fills the list. */
export function seasonalDrives(drives: Drive[], monthDay: string, max = 6): Drive[] {
	const now = drives
		.filter((d) => inSeason(d.season, monthDay))
		.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
	const states = ['WA', 'OR', 'CA', ...new Set(now.map((d) => d.state ?? ''))].filter(
		(s, i, all) => all.indexOf(s) === i
	);
	const queues = states.map((s) => now.filter((d) => (d.state ?? '') === s));
	const out: Drive[] = [];
	while (out.length < max && queues.some((q) => q.length))
		for (const q of queues) if (q.length && out.length < max) out.push(q.shift()!);
	return out;
}
