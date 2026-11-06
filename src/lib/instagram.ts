// Instagram: what goes up and how each one did. A story lasts a day, like the snow and chain news it carries, so
// nobody sees last week's storm. Instagram gives a story's numbers only while it is up, so they are read until it
// ends and kept here. A feed post stays, so only the morning's most new snow goes there, with its date.

export type StoryKind = 'snow' | 'chains' | 'forecast' | 'top' | 'feed';

/** What people did with a story: Instagram's own counts, read while it was up. */
export interface StoryNumbers {
	views: number;
	reach: number;
	/** Replies to a story; comments on a feed post. */
	replies: number;
	/** Feed posts only. */
	likes?: number;
	shares: number;
	/** Taps forward, back, away or to the next account. */
	navigation: number;
	profileVisits: number;
	follows: number;
}

export interface StoryEntry {
	/** The Facebook post's id it goes with (a pass's id for each pass in a chain post). */
	id: string;
	name: string;
	kind: StoryKind;
	at: number;
	/** The picture, as a path on our site. */
	picture: string;
	/** Instagram's id for the story, when it went up. */
	media: string | null;
	dry: boolean;
	error?: string;
	/** It went up as a video, snow falling. */
	video?: boolean;
	/** Why the video couldn't be made or posted; the still picture went up instead. */
	videoError?: string;
	numbers?: StoryNumbers;
	numbersAt?: number;
}

const HOUR = 3600_000;
/** Instagram ends a story after a day; its numbers can be read only until then. */
export const STORY_LIFE = 24 * HOUR;
/** A feed post's numbers go on growing for a while; a week of them, every 6 hours, is plenty. */
export const FEED_LIFE = 7 * 24 * HOUR;
const FEED_EVERY = 6 * HOUR;
/** Kept two months, for a 30-day look at which kinds people watch. */
const KEEP = 60 * 24 * HOUR;
/** One chain post with many passes makes at most this many stories. */
export const CHAIN_STORIES = 3;

/**
 * Posts whose numbers should be read now: stories every half hour while they are up, feed posts every 6 hours for a
 * week (the last read is the one kept).
 */
export function storiesToRead(log: StoryEntry[], now: number): StoryEntry[] {
	return log.filter((e) => {
		if (!e.media || e.dry) return false;
		if (e.kind === 'feed') return now - e.at < FEED_LIFE && now - (e.numbersAt ?? 0) >= FEED_EVERY;
		return now - e.at < STORY_LIFE;
	});
}

export function keepStories(log: StoryEntry[], now: number): StoryEntry[] {
	return log.filter((e) => now - e.at < KEEP).sort((a, b) => a.at - b.at);
}

export interface KindSummary {
	kind: StoryKind;
	stories: number;
	/** Averages per story, over the stories with numbers. */
	views: number;
	replies: number;
	likes: number;
	shares: number;
	profileVisits: number;
	follows: number;
}

/** Each kind's stories over the last `days`: how many, and the average views, replies, shares and profile visits. */
export function summarize(log: StoryEntry[], now: number, days = 30): KindSummary[] {
	const recent = log.filter((e) => !e.dry && e.media && now - e.at < days * 24 * HOUR);
	const kinds: StoryKind[] = ['snow', 'chains', 'forecast', 'top', 'feed'];
	return kinds.map((kind) => {
		const of = recent.filter((e) => e.kind === kind);
		const counted = of.filter((e) => e.numbers);
		const avg = (pick: (n: StoryNumbers) => number) =>
			counted.length
				? Math.round((counted.reduce((a, e) => a + pick(e.numbers!), 0) / counted.length) * 10) / 10
				: 0;
		return {
			kind,
			stories: of.length,
			views: avg((n) => n.views),
			replies: avg((n) => n.replies),
			likes: avg((n) => n.likes ?? 0),
			shares: avg((n) => n.shares),
			profileVisits: avg((n) => n.profileVisits),
			follows: avg((n) => n.follows)
		};
	});
}

export const KIND_NAMES: Record<StoryKind, string> = {
	snow: 'Snowing now',
	chains: 'Chain rules',
	forecast: 'Snow on the way',
	top: 'Most new snow',
	feed: 'Morning feed post'
};
