// Instagram stories: what goes up and how each one did. A story lasts a day, like the snow and chain news it
// carries, so nobody sees last week's storm. Instagram gives a story's numbers only while it is up, so they are read
// until it ends and kept here.

export type StoryKind = 'snow' | 'chains' | 'top';

/** What people did with a story: Instagram's own counts, read while it was up. */
export interface StoryNumbers {
	views: number;
	reach: number;
	replies: number;
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
	numbers?: StoryNumbers;
	numbersAt?: number;
}

const HOUR = 3600_000;
/** Instagram ends a story after a day; its numbers can be read only until then. */
export const STORY_LIFE = 24 * HOUR;
/** Kept two months, for a 30-day look at which kinds people watch. */
const KEEP = 60 * 24 * HOUR;
/** One chain post with many passes makes at most this many stories. */
export const CHAIN_STORIES = 3;

/** Stories still up whose numbers should be read now (every half hour while up; the last read is the one kept). */
export function storiesToRead(log: StoryEntry[], now: number): StoryEntry[] {
	return log.filter((e) => e.media && !e.dry && now - e.at < STORY_LIFE);
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
	shares: number;
	profileVisits: number;
	follows: number;
}

/** Each kind's stories over the last `days`: how many, and the average views, replies, shares and profile visits. */
export function summarize(log: StoryEntry[], now: number, days = 30): KindSummary[] {
	const recent = log.filter((e) => !e.dry && e.media && now - e.at < days * 24 * HOUR);
	const kinds: StoryKind[] = ['snow', 'chains', 'top'];
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
			shares: avg((n) => n.shares),
			profileVisits: avg((n) => n.profileVisits),
			follows: avg((n) => n.follows)
		};
	});
}

export const KIND_NAMES: Record<StoryKind, string> = {
	snow: 'Snowing now',
	chains: 'Chain rules',
	top: 'Most new snow'
};
