import { describe, expect, it } from 'vitest';
import {
	dueToDelete,
	fitText,
	keepThreads,
	liveThread,
	threadsToRead,
	type ThreadEntry
} from './threads';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-12-10T14:00:00-08:00');
const post = (over: Partial<ThreadEntry>): ThreadEntry => ({
	key: 'snoqualmie',
	kind: 'chains',
	name: 'Snoqualmie Pass',
	at: NOW - HOUR,
	last: NOW - HOUR,
	text: 'Chains required on Snoqualmie Pass (I-90).',
	media: '1',
	replies: [],
	rule: 'chains',
	dry: false,
	...over
});
const never = () => false;
const always = () => true;

describe('dueToDelete', () => {
	it('takes a chain post down two days after its last update, once no longer true', () => {
		const old = post({ at: NOW - 3 * DAY, last: NOW - 49 * HOUR });
		const updated = post({ at: NOW - 3 * DAY, last: NOW - 10 * HOUR });
		expect(dueToDelete([old, updated], NOW, never)).toEqual([old]);
	});

	it('keeps a post that is still true, but not past a week', () => {
		const holding = post({ at: NOW - 3 * DAY, last: NOW - 3 * DAY });
		const week = post({ at: NOW - 8 * DAY, last: NOW - 8 * DAY });
		expect(dueToDelete([holding, week], NOW, always)).toEqual([week]);
	});

	it('takes snow on the way down after 36 hours, and never the morning list', () => {
		const forecast = post({ kind: 'forecast', at: NOW - 37 * HOUR, last: NOW - 37 * HOUR });
		const top = post({ kind: 'top', at: NOW - 30 * DAY, last: NOW - 30 * DAY });
		expect(dueToDelete([forecast, top], NOW, never)).toEqual([forecast]);
	});

	it('leaves dry runs, failures and posts already down alone', () => {
		const log = [
			post({ at: NOW - 3 * DAY, last: NOW - 3 * DAY, dry: true, media: null }),
			post({ at: NOW - 3 * DAY, last: NOW - 3 * DAY, media: null, error: 'no' }),
			post({ at: NOW - 3 * DAY, last: NOW - 3 * DAY, deletedAt: NOW - DAY })
		];
		expect(dueToDelete(log, NOW, never)).toEqual([]);
	});
});

describe('liveThread', () => {
	it('finds the post a new change about the pass replies under', () => {
		const up = post({});
		expect(liveThread([up], 'snoqualmie')).toBe(up);
		expect(liveThread([post({ deletedAt: NOW })], 'snoqualmie')).toBeUndefined();
		expect(liveThread([post({ kind: 'forecast' })], 'snoqualmie')).toBeUndefined();
		expect(liveThread([post({ kind: 'top' })], 'snoqualmie')).toBeUndefined();
	});
});

describe('threadsToRead', () => {
	it('reads every 6 hours for a week', () => {
		const fresh = post({ numbersAt: NOW - 7 * HOUR });
		const justRead = post({ numbersAt: NOW - HOUR });
		const old = post({ at: NOW - 8 * DAY, kind: 'top' });
		expect(threadsToRead([fresh, justRead, old], NOW)).toEqual([fresh]);
	});
});

describe('keepThreads', () => {
	it('forgets news after two months but keeps the morning lists that are up', () => {
		const oldNews = post({ at: NOW - 70 * DAY, deletedAt: NOW - 68 * DAY });
		const oldTop = post({ kind: 'top', at: NOW - 70 * DAY });
		expect(keepThreads([oldNews, oldTop], NOW)).toEqual([oldTop]);
	});
});

describe('fitText', () => {
	it('leaves short posts alone', () => {
		expect(fitText('Snow.\n\nhttps://whatsupahead.com')).toBe('Snow.\n\nhttps://whatsupahead.com');
	});

	it('drops lines from the end of the body, keeping the link', () => {
		const lines = Array.from(
			{ length: 20 },
			(_, i) => `${i + 1}. A ski area with a long name: 4 in`
		);
		const text = [...lines, '', 'Cameras: https://whatsupahead.com/collections/ski-areas'].join(
			'\n'
		);
		const out = fitText(text);
		expect([...out].length).toBeLessThanOrEqual(500);
		expect(out.startsWith('1. ')).toBe(true);
		expect(out.endsWith('Cameras: https://whatsupahead.com/collections/ski-areas')).toBe(true);
	});

	it('shortens one long line', () => {
		const out = fitText(`${'snow '.repeat(150)}\nhttps://whatsupahead.com`);
		expect([...out].length).toBeLessThanOrEqual(500);
		expect(out.endsWith('…\n\nhttps://whatsupahead.com')).toBe(true);
	});
});
