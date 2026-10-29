import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	chainChanges,
	chainText,
	forecastText,
	keepRecent,
	pickChains,
	pickForecasts,
	pickPosts,
	postsToUpdate,
	updatePost,
	type PassMemory,
	type PassOutlook,
	type PostEntry
} from '../autopost';
import { blocksRoad, type PassReport } from '../passes';
import { regionAt, timeZoneAt } from '../regions';
import { postText } from '../snowing';
import { getCatalog } from './catalog';
import { crossingTimes } from './crossing';
import { allPassReports } from './passes';
import { snowingNow } from './snowing';

// Every half hour, day and night, the site's own Facebook Page posts what drivers and skiers want to know: passes, ski
// areas or parks snowing now (one a state), a pass's chain rules changing, and snow on the way over the passes with
// the best time to cross each. Each post is a preview picture (camera pictures, each source's credit printed on it,
// the same picture a shared link shows) and a few lines with the link. Without FACEBOOK_PAGE_ID and
// FACEBOOK_PAGE_TOKEN it only notes what it would have posted, shown on /stats, so the rules can be watched before
// anything goes up. The notes, and each pass's last posted chain rule, are saved next to the visit counts.

const FILE =
	process.env.AUTOPOST_FILE ||
	path.join(path.dirname(process.env.STATS_FILE || '.stats/stats.json'), 'autopost.json');
const MEMORY_FILE = path.join(path.dirname(FILE), 'autopost-passes.json');
const HOUR = 3600_000;
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

function readMemory(): Record<string, PassMemory> {
	try {
		return JSON.parse(readFileSync(MEMORY_FILE, 'utf8')) as Record<string, PassMemory>;
	} catch {
		return {};
	}
}

function saveMemory(memory: Record<string, PassMemory>) {
	try {
		mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
		writeFileSync(`${MEMORY_FILE}.tmp`, JSON.stringify(memory));
		renameSync(`${MEMORY_FILE}.tmp`, MEMORY_FILE);
	} catch (err) {
		console.warn(`[autopost] could not save the passes: ${(err as Error).message}`);
	}
}

/** The posts so far, newest first, and whether it really posts. Dry runs show only until the Page's key is set. */
export function autopostLog(): { live: boolean; entries: PostEntry[] } {
	const live = pageKey() !== null;
	return {
		live,
		entries: readLog()
			.filter((e) => !live || !e.dry)
			.reverse()
	};
}

function pageKey(): { page: string; token: string } | null {
	const page = process.env.FACEBOOK_PAGE_ID;
	const token = process.env.FACEBOOK_PAGE_TOKEN;
	return page && token ? { page, token } : null;
}

/** The health check's last look at the Page key: Facebook is asked about it twice a day. */
let keyLook: { at: number; problem: string | undefined } | null = null;
/** Warn this long before the key's data access ends (Meta renews it when someone signs in to the app again). */
const KEY_WARN_DAYS = 14;

/**
 * For the daily health check (which emails the owner): null without a key; a problem when the last post failed, the
 * key no longer works, or its data access ends within two weeks. Never says the key.
 */
export async function facebookProblem(now = Date.now()): Promise<string | null | undefined> {
	const key = pageKey();
	if (!key) return null;
	const last = readLog()
		.filter((e) => !e.dry)
		.at(-1);
	if (last?.error)
		return `the last post failed: ${last.error.replace(/https?:\S+/g, '').slice(0, 100)}`;
	if (!keyLook || now - keyLook.at > 12 * HOUR) {
		const res = await fetch(
			`${GRAPH}/debug_token?${new URLSearchParams({ input_token: key.token, access_token: key.token })}`,
			{ signal: AbortSignal.timeout(10000) }
		);
		const body = (await res.json().catch(() => ({}))) as {
			data?: { is_valid?: boolean; data_access_expires_at?: number };
		};
		const ends = body.data?.data_access_expires_at;
		const days = ends ? Math.floor((ends * 1000 - now) / 86_400_000) : null;
		keyLook = {
			at: now,
			problem:
				!res.ok || body.data?.is_valid === false
					? 'the Page key no longer works'
					: days !== null && days <= KEY_WARN_DAYS
						? `the Page key's data access ends in ${days} days`
						: undefined
		};
	}
	return keyLook.problem;
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

/** New words for one of the Page's own posts (an update at the top of an old chain post). */
async function editPost(key: { page: string; token: string }, post: string, message: string) {
	const res = await fetch(`${GRAPH}/${encodeURIComponent(post)}`, {
		method: 'POST',
		body: new URLSearchParams({ message, access_token: key.token }),
		signal: AbortSignal.timeout(30000)
	});
	const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
	if (!res.ok || body.error)
		throw new Error(body.error?.message ?? `Facebook answered ${res.status}`);
}

/** Posts each entry's picture with its text (or only notes it, without the Page's key), and returns the entries. */
async function send(
	key: { page: string; token: string } | null,
	posts: { entry: Omit<PostEntry, 'at' | 'post' | 'dry'>; picture: string }[],
	now: number
): Promise<PostEntry[]> {
	const out: PostEntry[] = [];
	for (const { entry: e, picture } of posts) {
		const entry: PostEntry = { ...e, at: Date.now(), post: null, dry: !key };
		if (key)
			try {
				// A fresh picture each time (the preview is otherwise kept for a while).
				entry.post = await postPhoto(key, `${SITE}${picture}&v=${now}`, entry.text);
				console.log(`[autopost] posted ${entry.id}`);
			} catch (err) {
				entry.error = (err as Error).message;
				console.warn(`[autopost] ${entry.id}: ${entry.error}`);
			}
		out.push(entry);
	}
	return out;
}

/** Snowing now, one spot a state. */
async function snowPosts(log: PostEntry[], now: number) {
	const spots = await snowingNow(now);
	return pickPosts(spots, log, now).map((spot) => ({
		entry: {
			id: spot.id,
			name: spot.name,
			kind: 'snow' as const,
			state: spot.state,
			text: `❄️ ${postText(spot, SITE, 'fb')}`
		},
		picture: spot.preview
	}));
}

/** Chain rules that changed on a pass, one post a state. Updates `memory`. */
async function chainPosts(log: PostEntry[], memory: Record<string, PassMemory>, now: number) {
	const { passes } = getCatalog();
	const reports = await allPassReports(passes);
	const changes = chainChanges(
		passes.map((p) => ({
			id: p.id,
			name: p.name,
			route: p.route,
			place: p.place,
			state: regionAt(p.lat, p.lon)?.abbr ?? null,
			timeZone: timeZoneAt(p.lat, p.lon)
		})),
		reports,
		memory,
		now
	);
	return pickChains(changes, log, now).map((group) => ({
		group,
		entry: {
			id: group.length === 1 ? group[0].id : `chains:${group[0].state}`,
			name: group.map((c) => c.name).join(', '),
			kind: 'chains' as const,
			state: group[0].state,
			passes: group.map((c) => c.id),
			text: chainText(group, SITE, 'fb')
		},
		picture: `/og/search?place=${encodeURIComponent(group[0].place)}`
	}));
}

/** Summit forecasts for every pass every three hours (Open-Meteo, one call a pass, kept for the pass pages too). */
const FORECAST_EVERY = 3 * HOUR;
let forecastAt = 0;

/** Snow on the way over the passes, with when to cross each: one post a day in each state. */
async function forecastPosts(log: PostEntry[], now: number) {
	if (now - forecastAt < FORECAST_EVERY) return [];
	forecastAt = now;
	const { passes } = getCatalog();
	const reports = await allPassReports(passes).catch(() => new Map<string, PassReport>());
	const outlooks: PassOutlook[] = [];
	// One at a time, gently; a road shut for the winter or closed now is left out.
	for (const p of passes) {
		if (reports.get(p.id)?.status === 'closed' || blocksRoad(p, reports.get(p.id), now)) continue;
		const crossing = await crossingTimes([{ pass: p, minutesToPass: 0 }], now);
		const snow = crossing?.advice.snow[0];
		if (!crossing || !snow) continue;
		outlooks.push({
			id: p.id,
			name: p.name,
			state: regionAt(p.lat, p.lon)?.abbr ?? null,
			href: `/passes/${encodeURIComponent(p.id)}`,
			preview: `/og/search?place=${encodeURIComponent(p.place)}`,
			feet: p.elevation_ft ?? null,
			deadEnd: p.dead_end,
			inches: snow.inches,
			from: snow.from,
			crossBefore: crossing.advice.leaveBefore,
			crossAfter: crossing.advice.leaveAfter,
			timeZone: crossing.timeZone
		});
	}
	return pickForecasts(outlooks, log, now).map((group) => ({
		entry: {
			id: group.length === 1 ? group[0].id : `forecast:${group[0].state}`,
			name: group.map((o) => o.name).join(', '),
			kind: 'forecast' as const,
			state: group[0].state,
			text: forecastText(group, SITE, 'fb', now)
		},
		picture: group[0].preview
	}));
}

/** One part of a run; a source that fails only skips that part. */
async function part<T>(name: string, run: () => Promise<T[]>): Promise<T[]> {
	try {
		return await run();
	} catch (err) {
		console.warn(`[autopost] ${name}: ${(err as Error).message}`);
		return [];
	}
}

async function tick() {
	const now = Date.now();
	const log = readLog();
	const memory = readMemory();
	const key = pageKey();
	const chains = await part('chains', () => chainPosts(log, memory, now));
	const entries = [
		...(await send(key, await part('snow', () => snowPosts(log, now)), now)),
		...(await send(key, chains, now)),
		...(await send(key, await part('forecast', () => forecastPosts(log, now)), now))
	];
	// A chain change is posted once it went up (or would have, in a dry run); a failed one is tried again.
	for (const { group, entry } of chains)
		if (!entries.find((e) => e.kind === 'chains' && e.id === entry.id)?.error)
			for (const c of group) memory[c.id].posted = c.to;
	// Someone may see Tuesday's "chains required" on Friday: once the new post is up, the earlier post about each pass
	// gets the change at its top. A failed update is noted on /stats; the new post still stands.
	for (const { group, entry } of chains) {
		const sent = entries.find((e) => e.kind === 'chains' && e.id === entry.id);
		if (!key || !sent?.post) continue;
		for (const { entry: old, changes } of postsToUpdate(group, log, now)) {
			const next = updatePost(old, changes, now);
			try {
				await editPost(key, old.post!, next.text);
				Object.assign(old, next, { updateError: undefined });
				console.log(`[autopost] updated ${old.id}`);
			} catch (err) {
				old.updateError = (err as Error).message;
				console.warn(`[autopost] update ${old.id}: ${old.updateError}`);
			}
		}
	}
	saveMemory(memory);
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
