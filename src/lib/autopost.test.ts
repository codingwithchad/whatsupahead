import { describe, expect, it } from 'vitest';
import { keepRecent, pickNext, type PostEntry } from './autopost';
import type { SnowingSpot } from './snowing';

const HOUR = 3600_000;
// 10 AM Pacific.
const NOW = Date.parse('2026-12-10T10:00:00-08:00');

const spot = (id: string, now = true): SnowingSpot => ({
	id,
	name: id,
	kind: 'pass',
	state: 'WA',
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
	at: NOW - hoursAgo * HOUR,
	text: '',
	post: null,
	dry: true,
	...over
});

describe('pickNext', () => {
	it('posts the first spot snowing now', () => {
		expect(pickNext([spot('a', false), spot('b'), spot('c')], [], NOW)?.id).toBe('b');
	});

	it('skips a spot with no camera pictures of its own', () => {
		expect(pickNext([{ ...spot('a'), pictured: false }, spot('b')], [], NOW)?.id).toBe('b');
	});

	it('keeps quiet at night, Pacific time', () => {
		expect(pickNext([spot('a')], [], Date.parse('2026-12-10T05:30:00-08:00'))).toBe(null);
		expect(pickNext([spot('a')], [], Date.parse('2026-12-10T20:00:00-08:00'))).toBe(null);
	});

	it('waits two hours between posts', () => {
		expect(pickNext([spot('b')], [entry('a', 1)], NOW)).toBe(null);
		expect(pickNext([spot('b')], [entry('a', 2.5)], NOW)?.id).toBe('b');
	});

	it('posts at most three a day', () => {
		const log = [entry('a', 20), entry('b', 12), entry('c', 4)];
		expect(pickNext([spot('d')], log, NOW)).toBe(null);
	});

	it('skips a spot posted in the last three days', () => {
		expect(pickNext([spot('a'), spot('b')], [entry('a', 48)], NOW)?.id).toBe('b');
		expect(pickNext([spot('a')], [entry('a', 80)], NOW)?.id).toBe('a');
	});

	it('tries a spot again after a failed post, but not straight away', () => {
		const failed = [entry('a', 1, { dry: false, error: 'bad key' })];
		expect(pickNext([spot('a')], failed, NOW)).toBe(null);
		expect(pickNext([spot('a')], [entry('a', 3, { error: 'bad key' })], NOW)?.id).toBe('a');
	});
});

describe('keepRecent', () => {
	it('keeps two weeks, oldest first', () => {
		const kept = keepRecent([entry('b', 1), entry('old', 15 * 24), entry('a', 5)], NOW);
		expect(kept.map((e) => e.id)).toEqual(['a', 'b']);
	});
});
