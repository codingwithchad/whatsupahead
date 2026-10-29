import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sitemapPages } from './sitemap';

// IndexNow tells Bing (which also answers for DuckDuckGo, Yahoo and the chat assistants that search with it) and
// Yandex which pages changed, so they look again within hours instead of weeks. Google doesn't use it; it reads the
// sitemap's dates. Only the site's own address (CANONICAL_HOST) is ever sent, so a copy run at home sends nothing.
// The key isn't a secret: it proves the site is ours by being readable at /indexnow.txt.

const HOST = process.env.CANONICAL_HOST?.trim().toLowerCase();
const FILE = path.join(
	path.dirname(process.env.STATS_FILE || '.stats/stats.json'),
	'indexnow.json'
);
const DAY = 24 * 3600_000;
/** Every page once a week; the passes whose reports changed, and the lists that change with them, once a day. */
const ALL_EVERY = 7 * DAY;
const DAILY = ['/', '/passes', '/powder', '/collections/ski-areas'];

/** The key for an address: the same each time, so nothing needs storing or setting up. */
export const indexNowKey = (host: string) =>
	createHash('sha256').update(`indexnow:${host}`).digest('hex').slice(0, 32);

function lastSent(): { all: number; changed: number } {
	try {
		return JSON.parse(readFileSync(FILE, 'utf8'));
	} catch {
		return { all: 0, changed: 0 };
	}
}

function saveSent(sent: { all: number; changed: number }) {
	try {
		mkdirSync(path.dirname(FILE), { recursive: true });
		writeFileSync(`${FILE}.tmp`, JSON.stringify(sent));
		renameSync(`${FILE}.tmp`, FILE);
	} catch (err) {
		console.warn(`[indexnow] could not save: ${(err as Error).message}`);
	}
}

async function submit(host: string, paths: string[]) {
	const res = await fetch('https://api.indexnow.org/indexnow', {
		method: 'POST',
		headers: { 'content-type': 'application/json; charset=utf-8' },
		body: JSON.stringify({
			host,
			key: indexNowKey(host),
			keyLocation: `https://${host}/indexnow.txt`,
			urlList: paths.map((p) => `https://${host}${p}`)
		}),
		signal: AbortSignal.timeout(20000)
	});
	// 200 and 202 are both fine (202: the key is still being checked).
	if (!res.ok) throw new Error(`IndexNow answered ${res.status}`);
}

/** Send what's due: every page weekly; daily, the passes whose reports changed in the last day and the lists. */
async function tick() {
	if (!HOST) return;
	const now = Date.now();
	const sent = lastSent();
	const pages = await sitemapPages();
	const all = now - sent.all >= ALL_EVERY;
	if (!all && now - sent.changed < DAY) return;
	const paths = all
		? pages.map((p) => p.path)
		: pages
				.filter((p) => (p.modified && now - p.modified < DAY) || DAILY.includes(p.path))
				.map((p) => p.path);
	try {
		await submit(HOST, paths);
		saveSent({ all: all ? now : sent.all, changed: now });
		console.log(`[indexnow] sent ${paths.length} pages`);
	} catch (err) {
		console.warn(`[indexnow] ${(err as Error).message}`);
	}
}

let started = false;

/** Check once an hour whether anything is due (a deploy restarts the clock, so the time sent is kept on disk). */
export function startIndexNow() {
	if (started || !HOST) return;
	started = true;
	const first = setTimeout(() => void tick(), 5 * 60_000);
	const timer = setInterval(() => void tick(), 3600_000);
	first.unref?.();
	timer.unref?.();
}
