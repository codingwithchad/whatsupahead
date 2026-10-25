import type { SnowingSpot } from './snowing';

/** One post to the site's Facebook Page, or one it would have made (a dry run, before the Page's key is set). */
export interface PostEntry {
	id: string;
	name: string;
	at: number;
	text: string;
	/** Facebook's id for the post, when it went up. */
	post: string | null;
	dry: boolean;
	error?: string;
}

const HOUR = 3600_000;
/** A few posts a day at most: the Page should read like a person watching the mountains, not a feed. */
export const MAX_PER_DAY = 3;
/** Posts at least this far apart, so one storm doesn't fill the Page in an hour. */
const SPACING = 2 * HOUR;
/** The same spot again only after this long: a storm lasts days. */
const SAME_SPOT = 3 * 24 * HOUR;
/** Posting hours, Pacific time: people read about the morning's snow, and nobody wants a post at 3 AM. */
const FIRST_HOUR = 6;
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
 * The next spot to post about, or null: one snowing now with its own camera pictures, in posting hours, not posted
 * about in three days, at most three posts a day and two hours apart. Dry runs and failed tries count too, so a dry
 * run shows what would really go up and a failing post isn't retried every half hour. `spots` comes snowing now
 * first, most snow first.
 */
export function pickNext(spots: SnowingSpot[], log: PostEntry[], now: number): SnowingSpot | null {
	const hour = pacificHour(now);
	if (hour < FIRST_HOUR || hour >= LAST_HOUR) return null;
	const recent = log.filter((e) => now - e.at < 24 * HOUR);
	if (recent.filter((e) => !e.error).length >= MAX_PER_DAY) return null;
	if (log.some((e) => now - e.at < SPACING)) return null;
	const posted = new Set(log.filter((e) => !e.error && now - e.at < SAME_SPOT).map((e) => e.id));
	return spots.find((s) => s.now && s.pictured && !posted.has(s.id)) ?? null;
}

/** The log, newest last, keeping the last two weeks. */
export function keepRecent(log: PostEntry[], now: number): PostEntry[] {
	return log.filter((e) => now - e.at < 14 * 24 * HOUR).sort((a, b) => a.at - b.at);
}
