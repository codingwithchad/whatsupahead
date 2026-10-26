import { describe, expect, it } from 'vitest';
import { keepRecent, pickPosts, type PostEntry } from './autopost';
import type { SnowingSpot } from './snowing';

const HOUR = 3600_000;
// 10 AM Pacific.
const NOW = Date.parse('2026-12-10T10:00:00-08:00');

const spot = (id: string, now = true, state = 'WA'): SnowingSpot => ({
	id,
	name: id,
	kind: 'pass',
	state,
	href: `/passes/${id}`,
	pictured: true,
	preview: `/og/search?place=pass-${id}`,
	gauge: null,
	gaugeFeet: null,
	gaugeLink: null,
	last3: 2,
	sinceSix: 4,
	change24: 4,
	reported: null,
	now
});

const entry = (id: string, hoursAgo: number, over: Partial<PostEntry> = {}): PostEntry => ({
	id,
	name: id,
	state: 'WA',
	at: NOW - hoursAgo * HOUR,
	text: '',
	post: null,
	dry: true,
	...over
});

const ids = (list: SnowingSpot[]) => list.map((s) => s.id);

describe('pickPosts', () => {
	it('posts the first spot snowing now', () => {
		expect(ids(pickPosts([spot('a', false), spot('b'), spot('c')], [], NOW))).toEqual(['b']);
	});

	it('posts one spot in each state at once', () => {
		const list = [spot('a'), spot('b'), spot('c', true, 'OR'), spot('d', true, 'UT')];
		expect(ids(pickPosts(list, [], NOW))).toEqual(['a', 'c', 'd']);
	});

	it('skips a spot with no camera pictures of its own', () => {
		expect(ids(pickPosts([{ ...spot('a'), pictured: false }, spot('b')], [], NOW))).toEqual(['b']);
	});

	it('waits for 3 inches today, so the pictures show snow', () => {
		const light = { ...spot('a'), sinceSix: 2, change24: 2 };
		expect(ids(pickPosts([light, spot('b')], [], NOW))).toEqual(['b']);
	});

	it('posts from 4 AM to 8 PM Pacific', () => {
		expect(pickPosts([spot('a')], [], Date.parse('2026-12-10T03:30:00-08:00'))).toEqual([]);
		expect(ids(pickPosts([spot('a')], [], Date.parse('2026-12-10T04:00:00-08:00')))).toEqual(['a']);
		expect(pickPosts([spot('a')], [], Date.parse('2026-12-10T20:00:00-08:00'))).toEqual([]);
	});

	it('waits two hours between posts in one state, not in another', () => {
		const list = [spot('b'), spot('c', true, 'OR')];
		expect(ids(pickPosts(list, [entry('a', 1)], NOW))).toEqual(['c']);
		expect(ids(pickPosts(list, [entry('a', 2.5)], NOW))).toEqual(['b', 'c']);
	});

	it('posts at most three a day in one state, ten in all', () => {
		const wa = [entry('a', 20), entry('b', 12), entry('c', 4)];
		expect(ids(pickPosts([spot('d'), spot('e', true, 'OR')], wa, NOW))).toEqual(['e']);
		const many = Array.from({ length: 10 }, (_, i) => entry(`x${i}`, 20, { state: `S${i}` }));
		expect(pickPosts([spot('d')], many, NOW)).toEqual([]);
	});

	it('skips a spot posted in the last three days', () => {
		expect(ids(pickPosts([spot('a'), spot('b')], [entry('a', 48)], NOW))).toEqual(['b']);
		expect(ids(pickPosts([spot('a')], [entry('a', 80)], NOW))).toEqual(['a']);
	});

	it('tries a spot again after a failed post, but not straight away', () => {
		const failed = [entry('a', 1, { dry: false, error: 'bad key' })];
		expect(pickPosts([spot('a')], failed, NOW)).toEqual([]);
		expect(ids(pickPosts([spot('a')], [entry('a', 3, { error: 'bad key' })], NOW))).toEqual(['a']);
	});
});

describe('keepRecent', () => {
	it('keeps two weeks, oldest first', () => {
		const kept = keepRecent([entry('b', 1), entry('old', 15 * 24), entry('a', 5)], NOW);
		expect(kept.map((e) => e.id)).toEqual(['a', 'b']);
	});
});
