import { inArea, type Area } from './areas';
import type { PostEntry } from './autopost';
import { todayAt } from './mountain';
import type { SkiSnow } from './server/skiSnow';
import { DAY_WATER } from './snowing';

// The morning's most new snow in one mountain area (the Washington Cascades, Spokane and North Idaho...), the way
// weather people post "top snowfall by resort": people care about their own mountains, and we cover only these
// six states, so a post never says "most in the West". Skiers' snow: the highest gauge near each ski area.

/** One line of the list: a ski area, or several that share a gauge ("Alta and Snowbird"). */
export interface TopSnowLine {
	ids: string[];
	names: string[];
	/** New snow in the last 24 hours at the gauge, in inches. */
	inches: number;
	/** Snow on the ground there. */
	depthIn: number | null;
	gaugeFeet: number;
}

/** The ski areas list's places (and the passes it also holds, like Snoqualmie) inside a mountain area. */
export function skiAreasIn<P extends { id: string; lat: number; lon: number; collection?: string }>(
	area: Area,
	places: P[],
	also: string[] = []
): P[] {
	return places.filter(
		(p) => (p.collection === 'ski-areas' || also.includes(p.id)) && inArea(area, p, [])
	);
}

/** The middle of a mountain area, for its time zone. */
export const middle = (area: Area) => ({
	lat: (area.bbox![1] + area.bbox![3]) / 2,
	lon: (area.bbox![0] + area.bbox![2]) / 2
});

/** A list line needs this much; the post, its top line this much (so the cameras show it). */
const LINE_INCHES = 1;
const POST_INCHES = 3;
const LINES = 5;

/**
 * The area's ski areas with the most new snow in the last 24 hours, most first, five at most. A gauge counts only
 * when the water in its snow rose too (a depth sensor wobbles, or reads grass in the fall); ski areas sharing a
 * gauge share a line rather than repeat its number.
 */
export function topSnow(
	places: { id: string; name: string }[],
	snow: Record<string, SkiSnow | undefined>
): TopSnowLine[] {
	const byGauge = new Map<string, TopSnowLine>();
	for (const p of places) {
		const s = snow[p.id];
		if (!s?.station || !s.stationFeet || (s.water24 ?? 0) < DAY_WATER) continue;
		if ((s.change24 ?? 0) < LINE_INCHES) continue;
		const line = byGauge.get(s.station);
		if (line) {
			line.ids.push(p.id);
			line.names.push(p.name);
		} else
			byGauge.set(s.station, {
				ids: [p.id],
				names: [p.name],
				inches: s.change24!,
				depthIn: s.depthIn,
				gaugeFeet: s.stationFeet
			});
	}
	return [...byGauge.values()]
		.sort((a, b) => b.inches - a.inches || a.names[0].localeCompare(b.names[0]))
		.slice(0, LINES);
}

/** "Alta and Snowbird", "Alta, Snowbird and Brighton". */
export const names = (list: string[]) =>
	list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;

const feet = (n: number) => `${n.toLocaleString('en-US')} ft`;

/** The post: the list, where the numbers come from, and the link to the area's ski areas, most snow first. */
export function topSnowText(
	area: Area,
	lines: TopSnowLine[],
	origin: string,
	ref?: string
): string {
	const link = `${origin}/collections/ski-areas?in=${area.id}&sort=snow${ref ? `&ref=${ref}` : ''}`;
	const list = lines.map(
		(l, i) =>
			`${i + 1}. ${names(l.names)}: ${l.inches} in${l.depthIn ? `, ${l.depthIn} in on the ground` : ''} (gauge at ${feet(l.gaugeFeet)})`
	);
	return [
		`❄️ Most new snow in the last 24 hours, ${area.name}:`,
		...list,
		'',
		"From the USDA snow gauge on each mountain. Resorts' own reports may differ.",
		'',
		`Cameras and snow at every ski area: ${link}`
	].join('\n');
}

const HOUR = 3600_000;
/** The morning list goes up from 6 AM to noon where the mountains are, once a day. */
const FROM_HOUR = 6;
const TO_HOUR = 12;
const ONCE = 20 * HOUR;
/** A failed try waits this long, like the other posts. */
const RETRY = 2 * HOUR;

/** Is it morning there, and the area not posted today? */
export function topSnowDue(area: Area, timeZone: string, log: PostEntry[], now: number): boolean {
	if (now < todayAt(FROM_HOUR, timeZone, now) || now >= todayAt(TO_HOUR, timeZone, now))
		return false;
	return !log.some(
		(e) => e.kind === 'top' && e.id === `top:${area.id}` && now - e.at < (e.error ? RETRY : ONCE)
	);
}

/** Worth a post: the top line has 3 inches or more. */
export const worthPosting = (lines: TopSnowLine[]) => (lines[0]?.inches ?? 0) >= POST_INCHES;
