import { describe, expect, it } from 'vitest';
import {
	chainChanges,
	chainText,
	forecastText,
	keepRecent,
	pickChains,
	pickForecasts,
	pickPosts,
	postClock,
	postsToUpdate,
	ruleOf,
	updatePost,
	type ChainChange,
	type PassMemory,
	type PassOutlook,
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
	gaugeMiles: null,
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

	const LABEL = {
		chains: 'Chains required',
		required: 'Traction tires required',
		traction: 'Traction tires advised',
		open: 'Open'
	} as const;
	const change = (
		id: string,
		to: ChainChange['to'],
		state = 'WA',
		from: ChainChange['from'] = 'open'
	): ChainChange => ({
		...pass(id, state),
		from,
		to,
		report: {
			...report(
				to === 'required' ? 'chains' : to,
				to === 'chains' ? 'Chains are required on all vehicles except AWD.' : ''
			),
			label: LABEL[to]
		}
	});

	it('tells traction tires required (chains for trucks only) from chains', () => {
		expect(ruleOf({ ...report('chains'), label: 'Traction tires required' })).toBe('required');
		expect(ruleOf({ ...report('chains'), label: 'Chains required' })).toBe('chains');
		expect(ruleOf(report('closed'))).toBe(null);
	});

	it('one post a state with every pass that changed, chains first, an hour apart', () => {
		const list = [change('a', 'traction'), change('b', 'chains'), change('c', 'chains', 'OR')];
		const groups = pickChains(list, [], NOW);
		expect(groups.map((g) => g.map((c) => c.id))).toEqual([['b', 'a'], ['c']]);
		const recent = [entry('x', 0.5, { kind: 'chains' })];
		expect(pickChains(list, recent, NOW).map((g) => g.map((c) => c.id))).toEqual([['c']]);
	});

	it('says what changed, in plain words with a sign, and links the pass', () => {
		expect(chainText([change('Snoqualmie', 'chains')], 'https://x.com', 'fb')).toBe(
			'⛓️❄️ Chains required on Snoqualmie Pass (I-90). Eastbound: Chains are required on all vehicles except AWD.\n\nWhat it means for your car, the latest report and cameras: https://x.com/passes/Snoqualmie?ref=fb'
		);
		const both = change('White', 'required');
		both.report.restrictions = ['Eastbound', 'Westbound'].map((direction) => ({
			direction,
			text: 'Traction Tires Required, Chains required on Vehicles over 10,000 gross vehicle weight.  Oversize Vehicles Prohibited.'
		}));
		expect(chainText([both], 'https://x.com')).toMatch(
			/^⚠️ Traction tires required on White Pass \(I-90\)\. Both ways: Traction Tires Required, Chains required on Vehicles over 10,000 gross vehicle weight\. Oversize Vehicles Prohibited\.\n/
		);
		expect(chainText([change('Stevens', 'open', 'WA', 'traction')], 'https://x.com')).toBe(
			'✅ No more restrictions on Stevens Pass (I-90): the traction tire advisory is lifted.\n\nThe latest report and cameras: https://x.com/passes/Stevens'
		);
		expect(chainText([change('White', 'traction', 'WA', 'chains')], 'https://x.com')).toMatch(
			/^⚠️ Easing on White Pass \(I-90\): chains are off, traction tires advised now\./
		);
	});

	it('several passes in a state: a line each and the state link', () => {
		const two = chainText(
			[change('Stevens', 'chains'), change('White', 'open', 'WA', 'traction')],
			'https://x.com',
			'fb'
		);
		expect(two.split('\n')).toEqual([
			'Washington pass update:',
			'⛓️❄️ Stevens Pass (I-90): chains required',
			'✅ White Pass (I-90): no more restrictions',
			'',
			'The latest report and cameras for every pass: https://x.com/passes?in=washington&ref=fb'
		]);
	});

	it('puts an update at the top of the earlier post when its pass changes again', () => {
		const tue = entry('White', 30, {
			kind: 'chains',
			dry: false,
			post: 'p1',
			text: '⛓️❄️ Chains required on White Pass (I-90).'
		});
		const group = entry('chains:WA', 20, {
			kind: 'chains',
			dry: false,
			post: 'p2',
			passes: ['Stevens', 'White'],
			text: 'Washington pass update: ...'
		});
		const off = change('White', 'open', 'WA', 'chains');
		// The newest post about White Pass, not one a dry run or a failure made, nor one over a week old.
		expect(postsToUpdate([off], [tue, group], NOW).map((u) => u.entry.post)).toEqual(['p2']);
		expect(postsToUpdate([off], [tue], NOW).map((u) => u.entry.post)).toEqual(['p1']);
		expect(postsToUpdate([off], [{ ...tue, dry: true }], NOW)).toEqual([]);
		expect(postsToUpdate([off], [{ ...tue, at: NOW - 8 * 24 * HOUR }], NOW)).toEqual([]);

		const once = updatePost(tue, [off], NOW);
		expect(once.text).toBe(
			'🔄 Update Thu 10:00 AM: No more restrictions on White Pass (I-90): chains are off.\n\n⛓️❄️ Chains required on White Pass (I-90).'
		);
		const again = updatePost(
			{ ...tue, ...once },
			[change('White', 'traction', 'WA', 'open')],
			NOW + HOUR
		);
		expect(again.text.split('\n\n')).toEqual([
			'🔄 Update Thu 11:00 AM: Traction tires advised on White Pass (I-90).',
			'🔄 Update Thu 10:00 AM: No more restrictions on White Pass (I-90): chains are off.',
			'⛓️❄️ Chains required on White Pass (I-90).'
		]);
	});
});

describe('snow on the way over the passes', () => {
	const outlook = (id: string, over: Partial<PassOutlook> = {}): PassOutlook => ({
		id,
		name: `${id} Pass`,
		state: 'WA',
		href: `/passes/${id}`,
		preview: `/og/search?place=pass-${id}`,
		feet: 4061,
		inches: 4,
		from: NOW + 11 * HOUR,
		crossBefore: NOW + 11 * HOUR,
		crossAfter: NOW + 24 * HOUR,
		timeZone: 'America/Los_Angeles',
		...over
	});
	const picked = (list: PassOutlook[], log: PostEntry[] = []) =>
		pickForecasts(list, log, NOW).map((g) => g.map((o) => o.id));

	it('one post a state, its snowiest passes first, four at most', () => {
		const list = [
			outlook('a', { inches: 2 }),
			outlook('b', { inches: 6 }),
			outlook('c', { state: 'OR' }),
			outlook('d', { inches: 1 }),
			outlook('e'),
			outlook('f'),
			outlook('g')
		];
		expect(picked(list)).toEqual([['b', 'e', 'f', 'g'], ['c']]);
	});

	it('once a day in a state; a failed try again after two hours', () => {
		expect(picked([outlook('a')], [entry('x', 10, { kind: 'forecast' })])).toEqual([]);
		expect(picked([outlook('a')], [entry('x', 25, { kind: 'forecast' })])).toEqual([['a']]);
		const failed = [entry('x', 3, { kind: 'forecast', error: 'down' })];
		expect(picked([outlook('a')], failed)).toEqual([['a']]);
	});

	it('one pass: when it snows, how much at what height, when to cross', () => {
		// 10 AM: snow from 9 PM.
		expect(forecastText([outlook('Stevens')], 'https://x.com', 'fb', NOW)).toBe(
			'🌨️ Snow on the way at Stevens Pass: about 4 in at the summit (4,061 ft) from about 9 PM tonight. Cross before 9 PM tonight to get ahead of it, or after 10 AM tomorrow once it has passed.\n\nThe best time to cross, hour by hour, and cameras: https://x.com/passes/Stevens?ref=fb'
		);
	});

	it('a road that ends at a ski area: drive up, at the top of the road', () => {
		const baker = outlook('mt-baker', { name: 'Mt. Baker Highway', feet: 4250, deadEnd: true });
		expect(forecastText([baker], 'https://x.com', 'fb', NOW)).toBe(
			'🌨️ Snow on the way at Mt. Baker Highway: about 4 in at the top of the road (4,250 ft) from about 9 PM tonight. Drive up before 9 PM tonight to get ahead of it, or after 10 AM tomorrow once it has passed.\n\nThe best time to drive up, hour by hour, and cameras: https://x.com/passes/mt-baker?ref=fb'
		);
	});

	it('several passes: a line and a link each; too soon to beat it, or no end in sight', () => {
		const text = forecastText(
			[
				outlook('Stevens', { crossBefore: NOW + HOUR }),
				outlook('Snoqualmie', { crossBefore: null, crossAfter: null })
			],
			'https://x.com',
			'fb',
			NOW
		);
		expect(text.split('\n\n')).toEqual([
			'🌨️ Snow on the way in the Washington mountains. When to go, hour by hour:',
			'Stevens Pass: about 4 in at the summit (4,061 ft) from about 9 PM tonight. Cross after 10 AM tomorrow, once it has passed (plows need time too). https://x.com/passes/Stevens?ref=fb',
			'Snoqualmie Pass: about 4 in at the summit (4,061 ft) from about 9 PM tonight. It keeps on through the next day: go prepared. https://x.com/passes/Snoqualmie?ref=fb'
		]);
	});
});

describe('postClock', () => {
	const tz = 'America/Los_Angeles';
	const at = (iso: string) => Date.parse(`${iso}-08:00`);
	it('says times the way people do', () => {
		expect(postClock(at('2026-12-11T00:00:00'), NOW, tz)).toBe('midnight tonight');
		expect(postClock(at('2026-12-10T21:00:00'), NOW, tz)).toBe('9 PM tonight');
		expect(postClock(at('2026-12-10T21:45:00'), NOW, tz)).toBe('9:45 PM tonight');
		expect(postClock(at('2026-12-10T15:00:00'), NOW, tz)).toBe('3 PM');
		expect(postClock(at('2026-12-10T12:00:00'), NOW, tz)).toBe('noon');
		expect(postClock(at('2026-12-11T09:00:00'), NOW, tz)).toBe('9 AM tomorrow');
		expect(postClock(at('2026-12-12T00:00:00'), NOW, tz)).toBe('Sat midnight');
	});
});
