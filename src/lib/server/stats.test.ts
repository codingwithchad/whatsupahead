import { beforeEach, describe, expect, it } from 'vitest';
import type { StatsStore } from './statsStore';
import {
	flushStats,
	isPerson,
	pageOf,
	recordEvent,
	recordSearch,
	recordView,
	resetStats,
	siteName,
	statsReport
} from './stats';

const PHONE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

beforeEach(() => resetStats());

describe('visit counter', () => {
	it('names pages and the place they are about', () => {
		const at = (p: string) => pageOf(new URL(`https://whatsupahead.com${p}`));
		expect(at('/')).toEqual({ page: 'home', place: null });
		expect(at('/search?place=stevens-pass')).toEqual({ page: 'place', place: 'stevens-pass' });
		expect(at('/search/__data.json?q=Everett')).toEqual({ page: 'search', place: null });
		expect(at('/trip?from=Seattle&to=mount-hood')).toEqual({ page: 'trip', place: null });
		expect(at('/collections/ferries')).toEqual({ page: 'collection', place: 'collection:ferries' });
		expect(at('/stats')).toBeNull();
		expect(at('/img/some-camera')).toBeNull();
	});

	it('counts each visitor once a day, and keeps nothing that identifies them', () => {
		recordView({ address: '203.0.113.9', userAgent: PHONE, page: 'home' });
		recordView({
			address: '203.0.113.9',
			userAgent: PHONE,
			page: 'place',
			place: 'x',
			from: 'home'
		});
		recordView({ address: '198.51.100.7', userAgent: PHONE, page: 'home', source: 'reddit.com' });
		const [[, day]] = statsReport().days;
		expect(day.visitors).toBe(2);
		expect(day.views).toEqual({ home: 2, place: 1 });
		expect(day.flows).toEqual({ 'home > place': 1 });
		expect(day.sources).toEqual({ 'reddit.com': 1 });
		expect(JSON.stringify(statsReport())).not.toContain('203.0.113.9');
	});

	it('counts taps and searches, and tells bots from people', () => {
		recordEvent('viewer-next');
		recordEvent('viewer-next');
		recordSearch(false);
		const [[, day]] = statsReport().days;
		expect(day.events).toEqual({ 'viewer-next': 2 });
		expect(day.searches).toEqual({ found: 0, notFound: 1 });
		expect(isPerson(PHONE)).toBe(true);
		expect(isPerson('Googlebot/2.1')).toBe(false);
		expect(isPerson('facebookexternalhit/1.1')).toBe(false);
		expect(isPerson('')).toBe(false);
	});
});

/** A store in memory that can pretend another copy of the app wrote first, or that it is down. */
function memoryStore() {
	const state = { doc: null as unknown, version: 0, raceOnce: false, down: false, writes: 0 };
	const store: StatsStore<never> = {
		name: 'memory',
		async read() {
			if (state.down) throw new Error('down');
			return {
				doc: structuredClone(state.doc) as never,
				etag: state.version ? String(state.version) : null
			};
		},
		async write(doc, etag) {
			if (state.raceOnce) {
				// Another copy adds 100 home views to what is stored, between our read and our write.
				state.raceOnce = false;
				const other = structuredClone(state.doc ?? doc) as {
					days: Record<string, { views: Record<string, number> }>;
				};
				for (const d of Object.values(other.days)) d.views.home = (d.views.home ?? 0) + 100;
				state.doc = other;
				state.version++;
				return false;
			}
			if (etag !== (state.version ? String(state.version) : null)) return false;
			state.doc = structuredClone(doc);
			state.version++;
			state.writes++;
			return true;
		}
	};
	return { store, state };
}

describe('saving counts', () => {
	const view = () => recordView({ address: '203.0.113.9', userAgent: PHONE, page: 'home' });
	const homeViews = () => statsReport().days[0][1].views.home;

	it('adds new counts to what is stored, and shows both before and after saving', async () => {
		const { store, state } = memoryStore();
		resetStats(store as never);
		view();
		await flushStats();
		view();
		expect(homeViews()).toBe(2);
		await flushStats();
		expect(state.writes).toBe(2);
		expect(homeViews()).toBe(2);
	});

	it("keeps both copies' counts when another copy writes first", async () => {
		const { store, state } = memoryStore();
		resetStats(store as never);
		view();
		await flushStats();
		state.raceOnce = true;
		view();
		await flushStats();
		// 1 + the other copy's 100 + our 1
		expect(homeViews()).toBe(102);
	});

	it('loses nothing when the store is down, and saves it later', async () => {
		const { store, state } = memoryStore();
		resetStats(store as never);
		state.down = true;
		view();
		await flushStats();
		expect(homeViews()).toBe(1);
		state.down = false;
		await flushStats();
		expect(state.writes).toBe(1);
		expect(homeViews()).toBe(1);
	});
});

describe('siteName', () => {
	it("groups a site's link addresses under one name", () => {
		expect(siteName('l.facebook.com')).toBe('facebook.com');
		expect(siteName('m.facebook.com')).toBe('facebook.com');
		expect(siteName('out.reddit.com')).toBe('reddit.com');
		expect(siteName('www.google.com')).toBe('google.com');
		expect(siteName('www.example.org')).toBe('example.org');
	});
});
