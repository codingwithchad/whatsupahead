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

// The site's Instagram account posts a story for each snow, chain and most-new-snow post the Facebook Page makes.
// A story has no caption and no link, so its picture says it all (`shape=story`, the news printed big) and our
// address is printed on it. Without INSTAGRAM_TOKEN it only notes what it would have posted, shown on /stats. The
// key lasts 60 days and is renewed by hand once a month (a reminder issue opens on the first Sunday).

const FILE = path.join(
	path.dirname(process.env.STATS_FILE || '.stats/stats.json'),
	'instagram-stories.json'
);
const GRAPH = 'https://graph.instagram.com/v24.0';
const SITE = process.env.SITE_URL || 'https://whatsupahead.com';
const HOUR = 3600_000;

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

/** Puts one picture up as a story and returns Instagram's id for it. */
async function postStory(picture: string): Promise<string> {
	const me = await accountId();
	const { id } = await call<{ id: string }>(
		`/${me}/media`,
		{ image_url: picture, media_type: 'STORIES' },
		'POST'
	);
	// Instagram fetches the picture first; it is usually ready at once.
	for (let i = 0; i < 10; i++) {
		const { status_code } = await call<{ status_code?: string }>(`/${id}`, {
			fields: 'status_code'
		});
		if (status_code === 'FINISHED') break;
		if (status_code === 'ERROR' || status_code === 'EXPIRED')
			throw new Error(`Instagram could not use the picture (${status_code})`);
		await new Promise((r) => setTimeout(r, 3000));
	}
	const done = await call<{ id: string }>(`/${me}/media_publish`, { creation_id: id }, 'POST');
	return done.id;
}

const METRICS = 'views,reach,replies,shares,navigation,profile_visits,follows';

async function readNumbers(media: string): Promise<StoryNumbers> {
	const { data } = await call<{ data: { name: string; values?: { value: number }[] }[] }>(
		`/${media}/insights`,
		{ metric: METRICS }
	);
	const n = (name: string) => data.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
	return {
		views: n('views'),
		reach: n('reach'),
		replies: n('replies'),
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
	now = Date.now()
) {
	const log = readLog();
	const live = token() !== null;
	for (const s of stories) {
		const entry: StoryEntry = { ...s, at: Date.now(), media: null, dry: !live };
		if (live)
			try {
				// A fresh picture each time (the preview is otherwise kept for a while).
				entry.media = await postStory(
					`${SITE}${s.picture}${s.picture.includes('?') ? '&' : '?'}v=${now}`
				);
				console.log(`[instagram] story ${s.id}`);
			} catch (err) {
				entry.error = (err as Error).message;
				console.warn(`[instagram] ${s.id}: ${entry.error}`);
			}
		log.push(entry);
	}
	let read = false;
	if (live)
		for (const e of storiesToRead(log, now))
			try {
				e.numbers = await readNumbers(e.media!);
				e.numbersAt = now;
				read = true;
			} catch (err) {
				console.warn(`[instagram] numbers for ${e.id}: ${(err as Error).message}`);
			}
	if (stories.length || read) saveLog(keepStories(log, now));
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
