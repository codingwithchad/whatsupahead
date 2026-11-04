import { describe, expect, it } from 'vitest';
import { keepStories, storiesToRead, summarize, type StoryEntry } from './instagram';

const HOUR = 3600_000;
const NOW = Date.parse('2026-12-10T14:00:00-08:00');
const numbers = {
	views: 10,
	reach: 8,
	replies: 1,
	shares: 2,
	navigation: 5,
	profileVisits: 3,
	follows: 0
};
const story = (over: Partial<StoryEntry>): StoryEntry => ({
	id: 'stevens',
	name: 'Stevens Pass',
	kind: 'snow',
	at: NOW - HOUR,
	picture: '/og/search?place=stevens-pass&shape=story&news=snow',
	media: '1',
	dry: false,
	...over
});

describe('storiesToRead', () => {
	it('reads only stories still up that went up', () => {
		const log = [
			story({ media: 'a' }),
			story({ media: 'b', at: NOW - 25 * HOUR }),
			story({ media: null, error: 'no' }),
			story({ media: null, dry: true })
		];
		expect(storiesToRead(log, NOW).map((e) => e.media)).toEqual(['a']);
	});
});

describe('storiesToRead, feed posts', () => {
	const feed = (over: Partial<StoryEntry>) => story({ kind: 'feed', ...over });
	it('reads a feed post every 6 hours for a week', () => {
		expect(storiesToRead([feed({ at: NOW - 2 * 24 * HOUR })], NOW)).toHaveLength(1);
		expect(
			storiesToRead([feed({ at: NOW - 2 * 24 * HOUR, numbersAt: NOW - HOUR })], NOW)
		).toHaveLength(0);
		expect(
			storiesToRead([feed({ at: NOW - 2 * 24 * HOUR, numbersAt: NOW - 7 * HOUR })], NOW)
		).toHaveLength(1);
		expect(storiesToRead([feed({ at: NOW - 8 * 24 * HOUR })], NOW)).toHaveLength(0);
	});
});

describe('summarize', () => {
	it('averages each kind over the stories with numbers', () => {
		const log = [
			story({ numbers }),
			story({ numbers: { ...numbers, views: 30, replies: 0 } }),
			story({}),
			story({ kind: 'top', numbers }),
			story({ kind: 'chains', at: NOW - 40 * 24 * HOUR, numbers }),
			story({ kind: 'chains', dry: true, media: null })
		];
		const [snow, chains, top] = summarize(log, NOW);
		expect(snow).toMatchObject({ stories: 3, views: 20, replies: 0.5 });
		expect(chains.stories).toBe(0);
		expect(top).toMatchObject({ stories: 1, views: 10, profileVisits: 3 });
	});
});

describe('keepStories', () => {
	it('keeps two months, oldest first', () => {
		const log = [
			story({ at: NOW - HOUR }),
			story({ at: NOW - 70 * 24 * HOUR }),
			story({ at: NOW - 2 * HOUR })
		];
		expect(keepStories(log, NOW).map((e) => e.at)).toEqual([NOW - 2 * HOUR, NOW - HOUR]);
	});
});
