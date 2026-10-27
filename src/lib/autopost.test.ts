import { describe, expect, it } from 'vitest';
import {
	chainChanges,
	chainText,
	forecastText,
	keepRecent,
	pickChains,
	pickForecasts,
	pickPosts,
	type DriveOutlook,
	type PassMemory,
	type PostEntry
} from './autopost';
import type { PassReport, PassStatus } from './passes';
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

	it('posts day and night', () => {
		expect(ids(pickPosts([spot('a')], [], Date.parse('2026-12-10T02:30:00-08:00')))).toEqual(['a']);
		expect(ids(pickPosts([spot('a')], [], Date.parse('2026-12-10T22:00:00-08:00')))).toEqual(['a']);
	});

	it('counts only snow posts', () => {
		const others = [
			entry('a', 1, { kind: 'chains' }),
			entry('b', 1, { kind: 'forecast' }),
			entry('c', 1, { kind: 'forecast' })
		];
		expect(ids(pickPosts([spot('a')], others, NOW))).toEqual(['a']);
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

describe('chain changes', () => {
	const report = (status: PassStatus, text = ''): PassReport => ({
		id: 1,
		status,
		label: status,
		restrictions: text ? [{ direction: 'Eastbound', text }] : [],
		road: '',
		weather: '',
		tempF: null,
		advisory: false,
		updated: null
	});
	const pass = (id: string, state = 'WA') => ({
		id,
		name: `${id} Pass`,
		route: 'I-90',
		place: `pass-${id}`,
		state
	});
	const MIN = 60_000;

	it('only remembers a pass the first time, so a deploy posts nothing', () => {
		const memory: Record<string, PassMemory> = {};
		const reports = new Map([['snoq', report('chains')]]);
		expect(chainChanges([pass('snoq')], reports, memory, NOW)).toEqual([]);
		expect(memory.snoq).toMatchObject({ posted: 'chains', seen: 'chains' });
	});

	it('posts a change once it has held for half an hour', () => {
		const memory: Record<string, PassMemory> = {
			snoq: { posted: 'open', seen: 'open', since: NOW - 5 * HOUR }
		};
		const reports = new Map([['snoq', report('traction')]]);
		expect(chainChanges([pass('snoq')], reports, memory, NOW)).toEqual([]);
		const later = chainChanges([pass('snoq')], reports, memory, NOW + 30 * MIN);
		expect(later.map((c) => [c.from, c.to])).toEqual([['open', 'traction']]);
	});

	it('a report fixed before then is never posted', () => {
		const memory: Record<string, PassMemory> = {
			snoq: { posted: 'open', seen: 'open', since: NOW - 5 * HOUR }
		};
		chainChanges([pass('snoq')], new Map([['snoq', report('chains')]]), memory, NOW);
		const back = new Map([['snoq', report('open')]]);
		expect(chainChanges([pass('snoq')], back, memory, NOW + 30 * MIN)).toEqual([]);
	});

	it('leaves closures and missing reports alone', () => {
		const memory: Record<string, PassMemory> = {
			snoq: { posted: 'chains', seen: 'chains', since: NOW - 5 * HOUR }
		};
		const closed = new Map([['snoq', report('closed')]]);
		expect(chainChanges([pass('snoq')], closed, memory, NOW)).toEqual([]);
		expect(memory.snoq.seen).toBe('chains');
		const off = new Map([['snoq', report('off-season')]]);
		expect(chainChanges([pass('snoq')], off, memory, NOW + HOUR)).toEqual([]);
	});

	it('starts again after days without a report, not posting last spring as a change', () => {
		const memory: Record<string, PassMemory> = {
			snoq: { posted: 'chains', seen: 'chains', since: NOW - 90 * 24 * HOUR }
		};
		const reports = new Map([['snoq', report('open')]]);
		expect(chainChanges([pass('snoq')], reports, memory, NOW)).toEqual([]);
		expect(chainChanges([pass('snoq')], reports, memory, NOW + HOUR)).toEqual([]);
		expect(memory.snoq.posted).toBe('open');
	});

	const change = (id: string, to: 'chains' | 'traction' | 'open', state = 'WA') => ({
		...pass(id, state),
		from: 'open' as const,
		to,
		report: report(to, to === 'chains' ? 'Chains are required on all vehicles except AWD.' : '')
	});

	it('one post a state with every pass that changed, chains first, an hour apart', () => {
		const list = [change('a', 'traction'), change('b', 'chains'), change('c', 'chains', 'OR')];
		const groups = pickChains(list, [], NOW);
		expect(groups.map((g) => g.map((c) => c.id))).toEqual([['b', 'a'], ['c']]);
		const recent = [entry('x', 0.5, { kind: 'chains' })];
		expect(pickChains(list, recent, NOW).map((g) => g.map((c) => c.id))).toEqual([['c']]);
	});

	it('says what changed and links the pass, or the state when several changed', () => {
		const one = chainText([change('Snoqualmie', 'chains')], 'https://x.com', 'fb');
		expect(one).toBe(
			'Snoqualmie Pass (I-90): chains required now, was no restrictions. Eastbound: Chains are required on all vehicles except AWD. Cameras, chains for your car and the pass report: https://x.com/passes/Snoqualmie?ref=fb'
		);
		const two = chainText(
			[change('Stevens', 'chains'), change('White', 'traction')],
			'https://x.com',
			'fb'
		);
		expect(two).toContain(
			'Washington passes now: Stevens Pass, chains required (was no restrictions);'
		);
		expect(two).toContain('https://x.com/passes?in=washington&ref=fb');
	});
});

describe('snow on the way for a drive', () => {
	const outlook = (id: string, over: Partial<DriveOutlook> = {}): DriveOutlook => ({
		id,
		name: 'Seattle to Spokane',
		state: 'WA',
		href: `/drives/${id}`,
		pass: 'Snoqualmie Pass',
		preview: '/og/search?place=pass-snoqualmie',
		feet: 3022,
		inches: 4,
		from: NOW + 11 * HOUR,
		leaveBefore: NOW + 9 * HOUR,
		leaveAfter: NOW + 20 * HOUR,
		timeZone: 'America/Los_Angeles',
		...over
	});
	const picked = (list: DriveOutlook[], log: PostEntry[] = []) =>
		pickForecasts(list, log, NOW).map((o) => o.id);

	it('posts one drive a state, the first in the drives order', () => {
		expect(picked([outlook('a'), outlook('b'), outlook('c', { state: 'OR' })])).toEqual(['a', 'c']);
	});

	it('needs 2 inches, and time to leave before it or a time after it', () => {
		expect(picked([outlook('a', { inches: 1 })])).toEqual([]);
		expect(picked([outlook('a', { leaveBefore: NOW + HOUR, leaveAfter: null })])).toEqual([]);
		expect(picked([outlook('a', { leaveBefore: null })])).toEqual(['a']);
	});

	it('once a day in a state, the same drive every three days', () => {
		const today = [entry('a', 10, { kind: 'forecast' })];
		expect(picked([outlook('b')], today)).toEqual([]);
		const before = [entry('a', 30, { kind: 'forecast' })];
		expect(picked([outlook('a'), outlook('b')], before)).toEqual(['b']);
	});

	it('says when it snows, how much at what height, and when to leave', () => {
		// 10 AM: snow from 9 PM, leave before 7 PM or after 6 AM tomorrow.
		expect(forecastText(outlook('seattle-spokane'), 'https://x.com', 'fb', NOW)).toBe(
			'Snow forecast at Snoqualmie Pass from about 9:00 PM: about 4 in at the summit (3,022 ft). Seattle to Spokane: leave before 7:00 PM to cross ahead of it, or after 6:00 AM tomorrow once it has passed. Best time to cross, hour by hour: https://x.com/drives/seattle-spokane?ref=fb'
		);
	});
});
