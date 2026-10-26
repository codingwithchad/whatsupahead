import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { keepRecent, pickPosts, type PostEntry } from '../autopost';
import { postText } from '../snowing';
import { snowingNow } from './snowing';

// Every half hour, when passes, ski areas or parks are snowing, the site's own Facebook Page posts them (one a state): the spot's
// preview picture (its camera pictures, with each source's credit printed on it, the same picture a shared link shows)
// and a line about the snow with the link. Without FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN it only notes what it
// would have posted, shown on /stats, so the rules can be watched before anything goes up. The notes are saved next
// to the visit counts.

const FILE =
	process.env.AUTOPOST_FILE ||
	path.join(path.dirname(process.env.STATS_FILE || '.stats/stats.json'), 'autopost.json');
const EVERY_MS = 30 * 60 * 1000;
const GRAPH = 'https://graph.facebook.com/v24.0';
const SITE = process.env.SITE_URL || 'https://whatsupahead.com';

let started = false;

function readLog(): PostEntry[] {
	try {
		return JSON.parse(readFileSync(FILE, 'utf8')) as PostEntry[];
	} catch {
		return [];
	}
}

function saveLog(log: PostEntry[]) {
	try {
		mkdirSync(path.dirname(FILE), { recursive: true });
		writeFileSync(`${FILE}.tmp`, JSON.stringify(log));
		renameSync(`${FILE}.tmp`, FILE);
	} catch (err) {
		console.warn(`[autopost] could not save: ${(err as Error).message}`);
	}
}

/** The posts so far (and dry runs), newest first, and whether it really posts. */
export function autopostLog(): { live: boolean; entries: PostEntry[] } {
	return { live: pageKey() !== null, entries: readLog().reverse() };
}

function pageKey(): { page: string; token: string } | null {
	const page = process.env.FACEBOOK_PAGE_ID;
	const token = process.env.FACEBOOK_PAGE_TOKEN;
	return page && token ? { page, token } : null;
}

/** A photo post on the Page. Returns Facebook's id for it. Facebook's error message never holds the key. */
async function postPhoto(
	key: { page: string; token: string },
	picture: string,
	caption: string
): Promise<string> {
	const res = await fetch(`${GRAPH}/${encodeURIComponent(key.page)}/photos`, {
		method: 'POST',
		body: new URLSearchParams({ url: picture, caption, access_token: key.token }),
		signal: AbortSignal.timeout(30000)
	});
	const body = (await res.json().catch(() => ({}))) as {
		post_id?: string;
		id?: string;
		error?: { message?: string };
	};
	if (!res.ok || body.error)
		throw new Error(body.error?.message ?? `Facebook answered ${res.status}`);
	return body.post_id ?? body.id ?? '';
}

async function tick() {
	const now = Date.now();
	const log = readLog();
	let spots;
	try {
		spots = await snowingNow(now);
	} catch (err) {
		console.warn(`[autopost] snow: ${(err as Error).message}`);
		return;
	}
	const key = pageKey();
	const entries: PostEntry[] = [];
	// One a state: Washington, Oregon and Utah snowing at once all go out now.
	for (const spot of pickPosts(spots, log, now)) {
		const text = postText(spot, SITE, 'fb');
		const entry: PostEntry = {
			id: spot.id,
			name: spot.name,
			state: spot.state,
			at: Date.now(),
			text,
			post: null,
			dry: !key
		};
		if (key)
			try {
				// A fresh picture each time (the preview is otherwise kept for a while).
				entry.post = await postPhoto(key, `${SITE}${spot.preview}&v=${now}`, text);
				console.log(`[autopost] posted ${spot.id}`);
			} catch (err) {
				entry.error = (err as Error).message;
				console.warn(`[autopost] ${spot.id}: ${entry.error}`);
			}
		entries.push(entry);
	}
	if (entries.length) saveLog(keepRecent([...log, ...entries], now));
}

/** Start watching for snow. Safe to call more than once. */
export function startAutopost() {
	if (started) return;
	started = true;
	const first = setTimeout(() => void tick(), 2 * 60_000);
	const timer = setInterval(() => void tick(), EVERY_MS);
	first.unref?.();
	timer.unref?.();
}
