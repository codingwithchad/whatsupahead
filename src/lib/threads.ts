// Threads posts: which stay and which go, and how each one did. Threads posts stay up unless deleted, and news
// that is over can mislead, so chain alerts, snowing now and snow on the way go after a day and a half to two days.
// The morning's most new snow stays, dated, so the profile has a history and nobody lands on an empty page. A
// pass's next chain change, or snow still falling, is a reply under the earlier post: one thread a storm.

import type { PostKind } from './autopost';

export type ThreadKind = PostKind;

/** What people did with a post, from Threads' own counts. */
export interface ThreadNumbers {
	views: number;
	likes: number;
	replies: number;
	reposts: number;
	quotes: number;
	shares: number;
}

/** A post to make this run: a new thread, or a reply under the live one with the same key. */
export interface ThreadItem {
	/** The spot or pass (`forecast:WA` for a state's snow on the way, `top:cascades:2026-11-03` for a morning list). */
	key: string;
	kind: ThreadKind;
	name: string;
	text: string;
	/** The picture, as a path on our site. */
	picture: string;
	/** A chain post's rule, to tell when it no longer holds. */
	rule?: string;
}

export interface ThreadEntry {
	key: string;
	kind: ThreadKind;
	name: string;
	/** When the first post went up, and the last reply. */
	at: number;
	last: number;
	text: string;
	/** Threads' id for the first post, and for each reply. */
	media: string | null;
	replies: string[];
	rule?: string;
	dry: boolean;
	error?: string;
	numbers?: ThreadNumbers;
	numbersAt?: number;
	/** When it was taken down (its news was over). */
	deletedAt?: number;
	/** Why the last try to take it down failed. */
	takeDownError?: string;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Threads allows 500 characters a post. */
export const MAX_TEXT = 500;
/** Snow on the way is over once its times have passed. */
const FORECAST_LIFE = 36 * HOUR;
/** Chain alerts and snowing now: two days after the last update, unless still true (then at most a week). */
const NEWS_LIFE = 48 * HOUR;
const LONGEST = 7 * DAY;
/** Still snowing: a reply with the new numbers at most every 6 hours, four to a thread. */
export const STILL_SNOWING_EVERY = 6 * HOUR;
export const MAX_REPLIES = 4;
/** A thread this long starts again with a new post. */
const MAX_THREAD = 8;
/** Numbers are read every 6 hours for a week, and once more before a post goes. */
const READ_EVERY = 6 * HOUR;
const KEEP = 60 * DAY;

/** The morning's most new snow stays up; everything else is news that ends. */
export const stays = (kind: ThreadKind) => kind === 'top';

/** The thread a new post about the same spot or pass goes under: up, not deleted, and its kind ends. */
export function liveThread(log: ThreadEntry[], key: string): ThreadEntry | undefined {
	return log.findLast(
		(e) =>
			e.key === key &&
			e.media &&
			!e.dry &&
			!e.deletedAt &&
			!stays(e.kind) &&
			e.kind !== 'forecast' &&
			e.replies.length < MAX_THREAD
	);
}

/**
 * Posts to take down now. `holds` says whether a post's news is still true (the pass's rule unchanged, still
 * snowing there).
 */
export function dueToDelete(
	log: ThreadEntry[],
	now: number,
	holds: (e: ThreadEntry) => boolean
): ThreadEntry[] {
	return log.filter((e) => {
		if (!e.media || e.dry || e.deletedAt || stays(e.kind)) return false;
		if (e.kind === 'forecast') return now - e.at >= FORECAST_LIFE;
		return now - e.last >= NEWS_LIFE && (now - e.at >= LONGEST || !holds(e));
	});
}

/** Posts whose numbers to read now: up, under a week old, not read in 6 hours. */
export function threadsToRead(log: ThreadEntry[], now: number): ThreadEntry[] {
	return log.filter(
		(e) =>
			e.media &&
			!e.dry &&
			!e.deletedAt &&
			now - e.at < LONGEST &&
			(!e.numbersAt || now - e.numbersAt >= READ_EVERY)
	);
}

export function keepThreads(log: ThreadEntry[], now: number): ThreadEntry[] {
	return log
		.filter((e) => now - e.at < KEEP || (stays(e.kind) && e.media && !e.dry))
		.sort((a, b) => a.at - b.at);
}

/**
 * Fit Threads' 500 characters: lines come off the end of the body (never the last line, the link) until it fits,
 * and a single long line is shortened with "…".
 */
export function fitText(text: string, max = MAX_TEXT): string {
	if ([...text].length <= max) return text;
	const lines = text.split('\n');
	const link = lines.pop()!;
	while (lines.length && [...[...lines, link].join('\n')].length > max) lines.pop();
	while (lines.length && !lines.at(-1)!.trim()) lines.pop();
	const out = [...lines, '', link].join('\n');
	if ([...out].length <= max && lines.length) return out;
	const room = max - [...link].length - 3;
	return `${[...text].slice(0, Math.max(0, room)).join('').trimEnd()}…\n\n${link}`;
}

export interface ThreadKindSummary {
	kind: ThreadKind;
	posts: number;
	/** Averages per post, over the posts with numbers. */
	views: number;
	likes: number;
	replies: number;
	reposts: number;
	shares: number;
}

/** Each kind's posts over the last `days`, with the average views, likes, replies, reposts and shares. */
export function summarizeThreads(log: ThreadEntry[], now: number, days = 30): ThreadKindSummary[] {
	const recent = log.filter((e) => !e.dry && e.media && now - e.at < days * DAY);
	const kinds: ThreadKind[] = ['snow', 'chains', 'forecast', 'top'];
	return kinds.map((kind) => {
		const of = recent.filter((e) => e.kind === kind);
		const counted = of.filter((e) => e.numbers);
		const avg = (pick: (n: ThreadNumbers) => number) =>
			counted.length
				? Math.round((counted.reduce((a, e) => a + pick(e.numbers!), 0) / counted.length) * 10) / 10
				: 0;
		return {
			kind,
			posts: of.length,
			views: avg((n) => n.views),
			likes: avg((n) => n.likes),
			replies: avg((n) => n.replies),
			reposts: avg((n) => n.reposts),
			shares: avg((n) => n.shares)
		};
	});
}

export const THREAD_KIND_NAMES: Record<ThreadKind, string> = {
	snow: 'Snowing now',
	chains: 'Chain rules',
	forecast: 'Snow on the way',
	top: 'Most new snow'
};
