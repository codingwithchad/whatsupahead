import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	keepStories,
	storiesToRead,
	summarize,
	type StoryEntry,
	type StoryKind,
	type StoryNumbers
} from '../instagram';
import { saveVideo } from './storyVideo';
import { drawFirst, storyLayers } from './sharePictures';

// The site's Instagram account posts a story for each snow, chain, snow-on-the-way and most-new-snow post the
// Facebook Page makes.
// A story has no caption and no link, so its picture says it all (`shape=story`, the news printed big) and our
// address is printed on it. Where snow is really falling the story is a short video (see ./storyVideo.ts). The
// morning's most new snow also goes to the feed, dated, so the profile has a history. Without INSTAGRAM_TOKEN it only notes what it would have posted, shown on /stats. The
// key lasts 60 days and is renewed by hand once a month (a reminder issue opens on the first Sunday).

const FILE = path.join(
	path.dirname(process.env.STATS_FILE || '.stats/stats.json'),
	'instagram-stories.json'
);
const GRAPH = 'https://graph.instagram.com/v24.0';
const SITE = process.env.SITE_URL || 'https://whatsupahead.com';
const siteHost = () => process.env.CANONICAL_HOST?.trim() || new URL(SITE).host;
const HOUR = 3600_000;
const PUBLISH_TRIES = 3;
const PUBLISH_PAUSE = 20_000;

function readLog(): StoryEntry[] {
	try {
		return JSON.parse(readFileSync(FILE, 'utf8')) as StoryEntry[];
	} catch {
		return [];
	}
}

function saveLog(log: StoryEntry[]) {
	try {
		mkdirSync(path.dirname(FILE), { recursive: true });
		writeFileSync(`${FILE}.tmp`, JSON.stringify(log));
		renameSync(`${FILE}.tmp`, FILE);
	} catch (err) {
		console.warn(`[instagram] could not save: ${(err as Error).message}`);
	}
}

const token = () => process.env.INSTAGRAM_TOKEN || null;

/** Instagram's answer, or its own error message (which never holds the key). */
async function call<T>(
	pathname: string,
	params: Record<string, string>,
	method: 'GET' | 'POST' = 'GET'
): Promise<T> {
	const key = token()!;
	const query = new URLSearchParams({ ...params, access_token: key });
	const res = await fetch(
		method === 'GET' ? `${GRAPH}${pathname}?${query}` : `${GRAPH}${pathname}`,
		{
			method,
			body: method === 'POST' ? query : undefined,
			signal: AbortSignal.timeout(30000)
		}
	);
	const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
	if (!res.ok || body.error)
		throw new Error(body.error?.message ?? `Instagram answered ${res.status}`);
	return body;
}

let account: string | null = null;
async function accountId(): Promise<string> {
	account ??= (await call<{ user_id?: string; id: string }>('/me', { fields: 'user_id' })).user_id!;
	return account;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Instagram fetches what it is given, then says when it is ready; a video takes a while. */
async function prepare(me: string, params: Record<string, string>, tries: number): Promise<string> {
	if (params.image_url) await drawFirst(params.image_url);
	const { id } = await call<{ id: string }>(`/${me}/media`, params, 'POST');
	for (let i = 0; i < tries; i++) {
		const { status_code } = await call<{ status_code?: string }>(`/${id}`, {
			fields: 'status_code'
		});
		if (status_code === 'FINISHED') break;
		if (status_code === 'ERROR' || status_code === 'EXPIRED')
			throw new Error(`Instagram could not use it (${status_code})`);
		await wait(3000);
	}
	return id;
}

/**
 * Two more tries before giving up: nothing tries a story again later, because its Facebook post has gone up. Only
 * the getting ready is repeated, never the last step, so a story can't go up twice.
 */
async function publish(params: Record<string, string>, tries: number): Promise<string> {
	const me = await accountId();
	for (let attempt = 1; ; attempt++) {
		let id: string;
		try {
			id = await prepare(me, params, tries);
		} catch (err) {
			if (attempt >= PUBLISH_TRIES) throw err;
			console.warn(`[instagram] try ${attempt}: ${(err as Error).message}`);
			await wait(PUBLISH_PAUSE);
			continue;
		}
		const done = await call<{ id: string }>(`/${me}/media_publish`, { creation_id: id }, 'POST');
		return done.id;
	}
}

/** A fresh picture each time (the preview is otherwise kept for a while). */
const fresh = (picture: string, now: number) =>
	`${SITE}${picture}${picture.includes('?') ? '&' : '?'}v=${now}`;

/**
 * Where snow is really falling, the story as a video; anything else, or a video that doesn't work out, the picture.
 * The picture always remains: a story about chains matters more than how it looks.
 */
async function postStory(entry: StoryEntry, picture: string, now: number): Promise<string> {
	try {
		const layers = await storyLayers(picture, siteHost());
		if (layers?.snowing) {
			const name = await saveVideo(layers);
			const media = await publish(
				{ video_url: `${SITE}/og/video/${name}`, media_type: 'STORIES' },
				40
			);
			entry.video = true;
			return media;
		}
	} catch (err) {
		entry.videoError = (err as Error).message.slice(0, 200);
		console.warn(`[instagram] video for ${entry.id}: ${entry.videoError}`);
	}
	return publish({ image_url: fresh(picture, now), media_type: 'STORIES' }, 10);
}

const STORY_METRICS = 'views,reach,replies,shares,navigation,profile_visits,follows';
const FEED_METRICS = 'views,reach,likes,comments,shares,profile_visits,follows';

async function readNumbers(e: StoryEntry): Promise<StoryNumbers> {
	const feed = e.kind === 'feed';
	const { data } = await call<{ data: { name: string; values?: { value: number }[] }[] }>(
		`/${e.media}/insights`,
		{ metric: feed ? FEED_METRICS : STORY_METRICS }
	);
	const n = (name: string) => data.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
	return {
		views: n('views'),
		reach: n('reach'),
		replies: n(feed ? 'comments' : 'replies'),
		...(feed ? { likes: n('likes') } : {}),
		shares: n('shares'),
		navigation: n('navigation'),
		profileVisits: n('profile_visits'),
		follows: n('follows')
	};
}

/**
 * Posts a story for each of these (or only notes it, without the key), and reads the numbers of the stories still
 * up. Called from the Facebook poster's half-hourly run with what it just posted.
 */
export async function storyRun(
	stories: { id: string; name: string; kind: StoryKind; picture: string }[],
	now = Date.now(),
	/** The morning's most new snow, for the feed, with the words under it. */
	feed: { id: string; name: string; picture: string; caption: string }[] = []
) {
	const log = readLog();
	const live = token() !== null;
	for (const s of stories) {
		const entry: StoryEntry = { ...s, at: Date.now(), media: null, dry: !live };
		if (live)
			try {
				entry.media = await postStory(entry, s.picture, now);
				console.log(`[instagram] story ${s.id}`);
			} catch (err) {
				entry.error = (err as Error).message;
				console.warn(`[instagram] ${s.id}: ${entry.error}`);
			}
		log.push(entry);
	}
	for (const f of feed) {
		const entry: StoryEntry = {
			id: f.id,
			name: f.name,
			kind: 'feed',
			picture: f.picture,
			at: Date.now(),
			media: null,
			dry: !live
		};
		if (live)
			try {
				entry.media = await publish({ image_url: fresh(f.picture, now), caption: f.caption }, 10);
				console.log(`[instagram] feed post ${f.id}`);
			} catch (err) {
				entry.error = (err as Error).message;
				console.warn(`[instagram] ${f.id}: ${entry.error}`);
			}
		log.push(entry);
	}
	let read = false;
	if (live)
		for (const e of storiesToRead(log, now))
			try {
				e.numbers = await readNumbers(e);
				e.numbersAt = now;
				read = true;
			} catch (err) {
				console.warn(`[instagram] numbers for ${e.id}: ${(err as Error).message}`);
			}
	if (stories.length || feed.length || read) saveLog(keepStories(log, now));
}

/** For /stats: the stories so far, newest first, and the last 30 days by kind. */
export function storyLog(now = Date.now()) {
	const live = token() !== null;
	const log = readLog().filter((e) => !live || !e.dry);
	return { live, entries: log.slice().reverse().slice(0, 40), kinds: summarize(log, now) };
}

let keyLook: { at: number; problem: string | undefined } | null = null;

/**
 * For the daily health check: null without a key; a problem when the last story failed or the key stopped
 * working (it lasts 60 days unless renewed). Never says the key.
 */
export async function instagramProblem(now = Date.now()): Promise<string | null | undefined> {
	if (!token()) return null;
	const last = readLog()
		.filter((e) => !e.dry)
		.at(-1);
	if (last?.error)
		return `the last story failed: ${last.error.replace(/https?:\S+/g, '').slice(0, 100)}`;
	if (!keyLook || now - keyLook.at > 12 * HOUR) {
		let problem: string | undefined;
		try {
			await call('/me', { fields: 'user_id' });
		} catch {
			problem = 'the Instagram key no longer works (renew it)';
		}
		keyLook = { at: now, problem };
	}
	return keyLook.problem;
}
