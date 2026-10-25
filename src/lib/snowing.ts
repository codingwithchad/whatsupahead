import { snowBetween, snowSinceSix, type SnowReading } from './mountain';

/** A pass, ski area or park with new snow, for the "Where it's snowing" page. */
export interface SnowingSpot {
	id: string;
	name: string;
	kind: 'pass' | 'ski' | 'park';
	state: string | null;
	href: string;
	/** The USDA gauge the numbers come from, and its height: the road's for a pass, the mountain's otherwise. */
	gauge: string | null;
	gaugeFeet: number | null;
	gaugeLink: string | null;
	/** New snow at the gauge, in inches. */
	last3: number | null;
	sinceSix: number | null;
	change24: number | null;
	/** The state's own pass report says it is snowing ("Snowing", "Light snow"), with who says so. */
	reported: { text: string; by: string } | null;
	/** Snowing now: the gauge has risen in the last three hours, or the state's report says snow. */
	now: boolean;
}

const HOUR = 3600_000;
// A gauge's depth wobbles by an inch from hour to hour, so one inch alone is not snow: it must also be up over the day.
const NOW_INCHES = 1;
const DAY_INCHES = 2;
const SAYS_SNOW = /snow/i;
const SAYS_NONE = /\bno snow\b/i;

/** The snow numbers for one spot from its gauge's readings and the state's report. */
export function snowFacts(
	reading: SnowReading | null,
	reported: { text: string; by: string } | null,
	timeZone: string,
	now = Date.now()
): Pick<SnowingSpot, 'last3' | 'sinceSix' | 'change24' | 'reported' | 'now'> {
	// A reading more than a few hours old says nothing about now.
	const fresh = reading && now - reading.at < 6 * HOUR ? reading : null;
	const last3 = fresh ? snowBetween(fresh.hourly, now - 3 * HOUR, now) : null;
	const sinceSix = fresh ? snowSinceSix(fresh.hourly, timeZone, now) : null;
	const change24 = fresh?.change24 ?? null;
	const says = reported && SAYS_SNOW.test(reported.text) && !SAYS_NONE.test(reported.text);
	const rising = (last3 ?? 0) >= NOW_INCHES && Math.max(change24 ?? 0, sinceSix ?? 0) >= DAY_INCHES;
	return {
		last3,
		sinceSix,
		change24,
		reported: says ? reported : null,
		now: Boolean(says || rising)
	};
}

/** Worth listing: snowing now, or a few inches already today. */
export function hasNewSnow(s: Pick<SnowingSpot, 'now' | 'sinceSix' | 'change24'>): boolean {
	return s.now || (s.sinceSix ?? 0) >= DAY_INCHES || (s.change24 ?? 0) >= 3;
}

/** Snowing now first, then the most new snow. */
export function bySnow(a: SnowingSpot, b: SnowingSpot): number {
	const most = (s: SnowingSpot) => Math.max(s.sinceSix ?? 0, s.change24 ?? 0, s.last3 ?? 0);
	return Number(b.now) - Number(a.now) || most(b) - most(a) || a.name.localeCompare(b.name);
}

const feet = (n: number) => `${n.toLocaleString('en-US')} ft`;

/** The snow in a few words, with the gauge's height: "3 in in the last 3 hours, 7 in since 6 AM". */
export function snowWords(s: SnowingSpot): string {
	const parts = [
		(s.last3 ?? 0) >= NOW_INCHES ? `${s.last3} in in the last 3 hours` : null,
		(s.sinceSix ?? 0) >= 1 ? `${s.sinceSix} in since 6 AM` : null,
		(s.change24 ?? 0) >= 1 && !((s.sinceSix ?? 0) >= 1) ? `${s.change24} in in 24 hours` : null
	].filter(Boolean);
	if (!parts.length || !s.gaugeFeet) return '';
	return `${parts.join(', ')} at the USDA snow gauge at ${feet(s.gaugeFeet)}`;
}

/** A comment ready to paste under someone's snow post, ending with the link to the spot's cameras. */
export function postText(s: SnowingSpot, origin: string): string {
	const snow = snowWords(s);
	const first = snow
		? `${s.now ? 'Snowing' : 'New snow'} at ${s.name}: ${snow}.`
		: s.reported
			? `${s.reported.by} reports ${s.reported.text.toLowerCase()} at ${s.name}.`
			: `New snow at ${s.name}.`;
	const what =
		s.kind === 'pass'
			? 'Every camera and the pass report in one place'
			: 'Every camera and the forecast in one place';
	return `${first} ${what}: ${origin}${s.href}`;
}
