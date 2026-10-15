import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { blobStore, fileStore, type StatsStore } from './statsStore';

// Our own visit counter: counts, never people. No cookies and nothing stored on the visitor's device.
// To tell visitors apart within one day, the server mixes the visitor's address and browser name with a random
// value that changes every day and is never saved, and keeps only that scrambled result, only for that day. So
// nobody (us included) can turn it back into an address or link a visitor across days.
//
// Saving: new counts collect in memory and every few minutes are ADDED to the stored copy (Azure Blob Storage
// when STATS_BLOB_URL is set, else the STATS_FILE). A write only lands if nobody else wrote since we read, so
// two copies of the app running at once (during a deploy) both keep their counts. When the host stops the app,
// unsaved counts go to a small hand-off file next to STATS_FILE, which the next copy adds in.

export const EVENTS = [
	'viewer-open',
	'viewer-next',
	'viewer-swipe',
	'pass-way',
	'jump-to-pass',
	'watch-live',
	'follow-trip',
	'reverse-trip',
	'way-around',
	'leave-later',
	'install',
	'use-location',
	'share',
	'share-sent',
	'share-copy',
	'share-facebook',
	'share-text',
	'moment-open',
	'vehicle',
	'moment-save',
	'replay-video',
	'replay-video-share'
] as const;
export type EventName = (typeof EVENTS)[number];

export interface Day {
	visitors: number;
	views: Record<string, number>;
	/** Which places and collections were opened (by id). */
	places: Record<string, number>;
	/** "from page > to page" for moves inside the site. */
	flows: Record<string, number>;
	/** Other sites that sent visitors (host names only). */
	sources: Record<string, number>;
	events: Record<string, number>;
	searches: { found: number; notFound: number };
	/** Pages shown in each Pacific hour ("00" to "23"); days counted before 2026-10-14 have none. */
	hours?: Record<string, number>;
	/** Visitors by the hour they first came that day, to line a post up with the visits it brought. */
	arrivals?: Record<string, number>;
}

interface Saved {
	since: string;
	days: Record<string, Day>;
}

const KEEP_DAYS = 60;
const SAVE_EVERY_MS = 5 * 60 * 1000;
const FILE = process.env.STATS_FILE ?? path.resolve(process.cwd(), '.stats', 'stats.json');
const HANDOFF_DIR = path.dirname(FILE);
const HANDOFF = /^stats-handoff-.+\.json$/;

/** What the store held at the last read or write. */
let base: Saved | null = null;
/** Counts not saved yet, by day. */
let pending: Record<string, Day> = {};
let salt = { day: '', value: '' };
let seen = new Set<string>();
let store: StatsStore<Saved> | null = null;
let ready: Promise<void> = Promise.resolve();
let lastSave: { at: string | null; ok: boolean; error: string | null } = {
	at: null,
	ok: true,
	error: null
};

const emptyDay = (): Day => ({
	visitors: 0,
	views: {},
	places: {},
	flows: {},
	sources: {},
	events: {},
	searches: { found: 0, notFound: 0 },
	hours: {},
	arrivals: {}
});

/** Add one set of day counts into another. */
export function addDays(into: Record<string, Day>, from: Record<string, Day>) {
	for (const [day, d] of Object.entries(from)) {
		const t = (into[day] ??= emptyDay());
		t.visitors += d.visitors;
		for (const k of [
			'views',
			'places',
			'flows',
			'sources',
			'events',
			'hours',
			'arrivals'
		] as const) {
			const table = (t[k] ??= {});
			for (const [name, n] of Object.entries(d[k] ?? {})) table[name] = (table[name] ?? 0) + n;
		}
		t.searches.found += d.searches?.found ?? 0;
		t.searches.notFound += d.searches?.notFound ?? 0;
	}
	return into;
}

/** The day in Pacific time, so "today" matches the people using it. */
export const dayOf = (ms = Date.now()) =>
	new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

const HOUR = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/Los_Angeles',
	hour: '2-digit',
	hourCycle: 'h23'
});
/** The hour in Pacific time, "00" to "23". */
export const hourOf = (ms = Date.now()) => HOUR.format(ms).padStart(2, '0');

/**
 * The cookie a device gets when its owner asks not to be counted (on /stats), so testing the site on our own
 * phones doesn't add to the visits. It holds no id, only "1", and visitors who never ask never get it.
 */
export const NO_COUNT_COOKIE = 'wua_nocount';

function today(): Day {
	const day = dayOf();
	if (salt.day !== day) {
		salt = { day, value: randomBytes(16).toString('hex') };
		seen = new Set();
	}
	return (pending[day] ??= emptyDay());
}

const bump = (table: Record<string, number>, key: string) => (table[key] = (table[key] ?? 0) + 1);

// Bots, link previews and monitoring are not visitors.
const NOT_A_PERSON =
	/bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget|python|go-http|node|axios|headless|monitor|uptime|lighthouse/i;

export function isPerson(userAgent: string): boolean {
	return Boolean(userAgent) && !NOT_A_PERSON.test(userAgent);
}

/** One name per site: l.facebook.com and m.facebook.com are Facebook, out.reddit.com is Reddit. */
export function siteName(host: string): string {
	const known = host.match(
		/(?:^|\.)(facebook\.com|reddit\.com|google\.[a-z.]+|bing\.com|t\.co|nextdoor\.com)$/
	);
	return known ? known[1] : host.replace(/^(www|m|mobile)\./, '');
}

/** A page was shown. `page` is a short name ("home", "trip", "place"...), `from` the page they came from on our site. */
export function recordView(opts: {
	address: string;
	userAgent: string;
	page: string;
	from?: string | null;
	source?: string | null;
	place?: string | null;
}) {
	const day = today();
	const visitor = createHash('sha256')
		.update(`${salt.value}|${opts.address}|${opts.userAgent}`)
		.digest('hex')
		.slice(0, 16);
	const hour = hourOf();
	if (!seen.has(visitor)) {
		seen.add(visitor);
		day.visitors++;
		bump((day.arrivals ??= {}), hour);
	}
	bump(day.views, opts.page);
	bump((day.hours ??= {}), hour);
	if (opts.place) bump(day.places, opts.place);
	if (opts.from && opts.from !== opts.page) bump(day.flows, `${opts.from} > ${opts.page}`);
	if (opts.source) bump(day.sources, opts.source);
}

export function recordEvent(name: EventName) {
	bump(today().events, name);
}

export function recordSearch(found: boolean) {
	today().searches[found ? 'found' : 'notFound']++;
}

/** The counts for the dashboard, newest day first: what is stored plus what isn't saved yet. */
export function statsReport() {
	today();
	const days = addDays(structuredClone(base?.days ?? {}), pending);
	return {
		since: base?.since ?? startedAt,
		days: Object.entries(days).sort(([a], [b]) => b.localeCompare(a)),
		storage: store?.name ?? 'memory only',
		lastSave
	};
}

/** Wait for the first read of the stored counts (the dashboard does, so it never shows a half picture). */
export const statsReady = () => ready;

const startedAt = new Date().toISOString();
const isEmpty = (d: Record<string, Day>) => Object.keys(d).length === 0;

function prune(doc: Saved) {
	const cutoff = dayOf(Date.now() - KEEP_DAYS * 86_400_000);
	for (const day of Object.keys(doc.days)) if (day < cutoff) delete doc.days[day];
}

/** Take in counts that a stopped copy of the app handed off. Each file is claimed by renaming it first. */
function absorbHandoffs() {
	let names: string[] = [];
	try {
		names = readdirSync(HANDOFF_DIR).filter((n) => HANDOFF.test(n));
	} catch {
		return;
	}
	for (const name of names) {
		const claimed = path.join(HANDOFF_DIR, `${name}.${process.pid}.claimed`);
		try {
			renameSync(path.join(HANDOFF_DIR, name), claimed);
		} catch {
			continue; // another copy took it
		}
		try {
			addDays(pending, JSON.parse(readFileSync(claimed, 'utf8')) as Record<string, Day>);
		} catch (err) {
			console.warn(`[stats] unreadable hand-off ${name}: ${(err as Error).message}`);
		}
		rmSync(claimed, { force: true });
	}
}

let saving: Promise<void> | null = null;

/** Add the unsaved counts to the stored copy. Safe to call at any time; one save runs at a time. */
export function flushStats(): Promise<void> {
	if (!store) return Promise.resolve();
	return (saving ??= (async () => {
		absorbHandoffs();
		const delta = pending;
		pending = {};
		try {
			for (let attempt = 0; attempt < 4; attempt++) {
				const { doc, etag } = await store.read();
				const next: Saved = doc ?? { since: new Date().toISOString(), days: {} };
				addDays(next.days, delta);
				prune(next);
				if (await store.write(next, etag)) {
					base = next;
					lastSave = { at: new Date().toISOString(), ok: true, error: null };
					return;
				}
			}
			throw new Error('kept losing the race with another copy');
		} catch (err) {
			// Nothing is lost: put the counts back for the next try.
			addDays(pending, delta);
			lastSave = { at: new Date().toISOString(), ok: false, error: (err as Error).message };
			console.warn(`[stats] could not save to ${store.name}: ${(err as Error).message}`);
		}
	})().finally(() => (saving = null)));
}

/** On shutdown: write unsaved counts to a hand-off file, at once and without waiting on the network. */
function handOff() {
	if (isEmpty(pending)) return;
	try {
		mkdirSync(HANDOFF_DIR, { recursive: true });
		const file = path.join(HANDOFF_DIR, `stats-handoff-${Date.now()}-${process.pid}.json`);
		writeFileSync(file, JSON.stringify(pending));
		pending = {};
	} catch (err) {
		console.warn(`[stats] could not hand off: ${(err as Error).message}`);
	}
}

let started = false;
export function startStats() {
	if (started) return;
	started = true;
	const url = process.env.STATS_BLOB_URL?.trim();
	store = url ? blobStore<Saved>(url) : fileStore<Saved>(FILE);
	ready = store
		.read()
		.then(({ doc }) => {
			base = doc;
		})
		.catch((err) => console.warn(`[stats] could not read ${store?.name}: ${err.message}`))
		.then(() => flushStats());
	setInterval(() => void flushStats(), SAVE_EVERY_MS).unref();
	for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, handOff);
	process.on('exit', handOff);
}

/** For tests: start over, optionally with a store. */
export function resetStats(testStore: StatsStore<Saved> | null = null) {
	base = null;
	pending = {};
	salt = { day: '', value: '' };
	seen = new Set();
	store = testStore;
	lastSave = { at: null, ok: true, error: null };
}

/** A short name for a page of the site, and the place or collection it is about. Null for pages we do not count. */
export function pageOf(url: URL): { page: string; place: string | null } | null {
	const p = url.pathname.replace(/\/__data\.json$/, '').replace(/\/$/, '') || '/';
	const q = url.searchParams;
	if (p === '/') return { page: 'home', place: null };
	if (p === '/search')
		return q.get('place')
			? { page: 'place', place: q.get('place') }
			: { page: q.get('q') ? 'search' : 'search-empty', place: null };
	if (p === '/trip')
		return { page: q.get('from') && q.get('to') ? 'trip' : 'trip-form', place: null };
	const collection = p.match(/^\/collections\/([a-z0-9-]+)$/);
	if (collection) return { page: 'collection', place: `collection:${collection[1]}` };
	const pass = p.match(/^\/passes\/([a-z0-9-]+)$/);
	if (pass) return { page: 'pass', place: `pass:${pass[1]}` };
	if (/^\/cameras\/[a-z0-9-]+$/.test(p)) return { page: 'camera', place: null };
	if (/^\/moments\/[a-z0-9-]+$/.test(p)) return { page: 'moment', place: null };
	const named = [
		'/passes',
		'/places',
		'/nearby',
		'/about',
		'/contribute',
		'/tires',
		'/powder'
	].find((n) => n === p);
	return named ? { page: named.slice(1), place: null } : null;
}
