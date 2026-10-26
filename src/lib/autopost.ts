import type { SnowingSpot } from './snowing';

/** One post to the site's Facebook Page, or one it would have made (a dry run, before the Page's key is set). */
export interface PostEntry {
	id: string;
	name: string;
	/** The spot's state ("WA"), as each state has its own spacing and daily limit. */
	state?: string | null;
	at: number;
	text: string;
	/** Facebook's id for the post, when it went up. */
	post: string | null;
	dry: boolean;
	error?: string;
}

const HOUR = 3600_000;
/** The Page should read like people watching the mountains, not a feed: a few posts a day for each state. */
const PER_STATE_PER_DAY = 3;
export const MAX_PER_DAY = 10;
/** Posts in one state at least this far apart; different states go out together. */
const SPACING = 2 * HOUR;
/** The same spot again only after this long: a storm lasts days. */
const SAME_SPOT = 3 * 24 * HOUR;
/**
 * New snow today before a spot is posted: with an inch or two, the cameras (often lower than the gauge, or in fog)
 * show wet pavement under a line that says snowing.
 */
const POST_INCHES = 3;
/**
 * Posting hours, Pacific time: from 4 AM (5 in Idaho and Utah), for skiers up early to drive a couple of hours, and
 * nobody wants a post at 2 AM.
 */
const FIRST_HOUR = 4;
const LAST_HOUR = 20;

const pacificHour = (t: number) =>
	Number(
		new Intl.DateTimeFormat('en-US', {
			timeZone: 'America/Los_Angeles',
			hour: 'numeric',
			hourCycle: 'h23'
		}).format(t)
	);

/**
 * The spots to post about now, at most one a state: each snowing now with 3 inches or more today and its own camera
 * pictures, in posting hours, not posted about in three days. A state's posts are two hours apart and three a day,
 * and ten a day in all. Dry runs and failed tries count too, so a dry run shows what would really go up and a failing
 * post isn't retried every half hour. `spots` comes snowing now first, most snow first.
 */
export function pickPosts(spots: SnowingSpot[], log: PostEntry[], now: number): SnowingSpot[] {
	const hour = pacificHour(now);
	if (hour < FIRST_HOUR || hour >= LAST_HOUR) return [];
	const day = log.filter((e) => now - e.at < 24 * HOUR && !e.error);
	const posted = new Set(log.filter((e) => !e.error && now - e.at < SAME_SPOT).map((e) => e.id));
	const today = (s: SnowingSpot) => Math.max(s.sinceSix ?? 0, s.change24 ?? 0);
	const stateOf = (s: SnowingSpot) => s.state ?? s.id;
	const busy = (state: string) =>
		log.some((e) => e.state === state && now - e.at < SPACING) ||
		day.filter((e) => e.state === state).length >= PER_STATE_PER_DAY;
	const out: SnowingSpot[] = [];
	for (const s of spots) {
		if (day.length + out.length >= MAX_PER_DAY) break;
		const state = stateOf(s);
		if (!s.now || !s.pictured || today(s) < POST_INCHES || posted.has(s.id)) continue;
		if (busy(state) || out.some((o) => stateOf(o) === state)) continue;
		out.push(s);
	}
	return out;
}

/** The log, newest last, keeping the last two weeks. */
export function keepRecent(log: PostEntry[], now: number): PostEntry[] {
	return log.filter((e) => now - e.at < 14 * 24 * HOUR).sort((a, b) => a.at - b.at);
}
