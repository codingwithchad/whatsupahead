import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	dueToDelete,
	fitText,
	keepThreads,
	liveThread,
	MAX_REPLIES,
	STILL_SNOWING_EVERY,
	summarizeThreads,
	threadsToRead,
	type ThreadEntry,
	type ThreadItem,
	type ThreadNumbers
} from '../threads';
import { drawFirst } from './sharePictures';
import { notReadyYet, whenReady } from './metaReady';

// The site's Threads account posts what the Facebook Page posts, with a picture and a link that can be tapped
// (`?ref=th`, so visits show on /stats). News that ends is taken down a day and a half to two days on, and a pass's
// next change is a reply under its post (see ../threads.ts). Without THREADS_TOKEN it only notes what it would have
// posted, shown on /stats. The key lasts 60 days and is renewed by hand once a month, with the Instagram one.

const FILE = path.join(path.dirname(process.env.STATS_FILE || '.stats/stats.json'), 'threads.json');
const GRAPH = 'https://graph.threads.net/v1.0';
const SITE = process.env.SITE_URL || 'https://whatsupahead.com';
const HOUR = 3600_000;

function readLog(): ThreadEntry[] {
	try {
		return JSON.parse(readFileSync(FILE, 'utf8')) as ThreadEntry[];
	} catch {
		return [];
	}
}

function saveLog(log: ThreadEntry[]) {
	try {
		mkdirSync(path.dirname(FILE), { recursive: true });
		writeFileSync(`${FILE}.tmp`, JSON.stringify(log));
		renameSync(`${FILE}.tmp`, FILE);
	} catch (err) {
		console.warn(`[threads] could not save: ${(err as Error).message}`);
	}
}

const token = () => process.env.THREADS_TOKEN || null;

/** Threads' answer, or its own error message (which never holds the key). */
async function call<T>(
	pathname: string,
	params: Record<string, string>,
	method: 'GET' | 'POST' | 'DELETE' = 'GET'
): Promise<T> {
	const query = new URLSearchParams({ ...params, access_token: token()! });
	const res = await fetch(
		method === 'POST' ? `${GRAPH}${pathname}` : `${GRAPH}${pathname}?${query}`,
		{
			method,
			body: method === 'POST' ? query : undefined,
			signal: AbortSignal.timeout(30000)
		}
	);
	const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
	if (!res.ok || body.error)
		throw new Error(body.error?.message ?? `Threads answered ${res.status}`);
	return body;
}

/** One post with a picture (a reply under `replyTo` when given). Returns Threads' id for it. */
async function publish(item: ThreadItem, now: number, replyTo?: string): Promise<string> {
	const picture = `${SITE}${item.picture}${item.picture.includes('?') ? '&' : '?'}v=${now}`;
	// A first drawing can take 20 seconds or more; one that runs out of time is ready by the second try.
	await drawFirst(picture).catch(() => drawFirst(picture));
	const { id } = await call<{ id: string }>(
		'/me/threads',
		{
			media_type: 'IMAGE',
			image_url: picture,
			text: fitText(item.text),
			...(replyTo ? { reply_to_id: replyTo } : {})
		},
		'POST'
	);
	// Threads fetches the picture first and asks for a pause before publishing. Just after it is made it may say the
	// post "does not exist": not ready yet.
	for (let i = 0; i < 10; i++) {
		await new Promise((r) => setTimeout(r, 3000));
		const { status, error_message } = await call<{ status?: string; error_message?: string }>(
			`/${id}`,
			{ fields: 'status,error_message' }
		).catch((err): { status?: string; error_message?: string } => {
			if (notReadyYet(err)) return {};
			throw err;
		});
		if (status === 'FINISHED') break;
		if (status === 'ERROR' || status === 'EXPIRED')
			throw new Error(`Threads could not use the picture (${error_message || status})`);
	}
	const done = await whenReady(() =>
		call<{ id: string }>('/me/threads_publish', { creation_id: id }, 'POST')
	);
	return done.id;
}

async function readNumbers(media: string): Promise<ThreadNumbers> {
	const { data } = await call<{
		data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[];
	}>(`/${media}/insights`, { metric: 'views,likes,replies,reposts,quotes,shares' });
	const n = (name: string) => {
		const d = data.find((x) => x.name === name);
		return d?.total_value?.value ?? d?.values?.[0]?.value ?? 0;
	};
	return {
		views: n('views'),
		likes: n('likes'),
		replies: n('replies'),
		reposts: n('reposts'),
		quotes: n('quotes'),
		shares: n('shares')
	};
}

async function takeDown(e: ThreadEntry) {
	for (const id of [...e.replies].reverse()) await call(`/${id}`, {}, 'DELETE').catch(() => null);
	await call(`/${e.media}`, {}, 'DELETE');
}

/**
 * One run, after the Facebook posts: each item goes up (a reply under its live thread when it has one), threads
 * where it is still snowing get the new numbers, news that is over comes down, and the numbers are read.
 * `holds` says whether a post's news is still true; `stillSnowing` gives the reply for a spot still snowing.
 */
export async function threadRun(
	items: ThreadItem[],
	{
		holds,
		stillSnowing
	}: {
		holds: (e: ThreadEntry) => boolean;
		stillSnowing: (e: ThreadEntry) => ThreadItem | null;
	},
	now = Date.now()
) {
	const log = readLog();
	const live = token() !== null;
	let changed = false;
	const reply = async (thread: ThreadEntry, item: ThreadItem) => {
		try {
			thread.replies.push(await publish(item, now, thread.media!));
			thread.last = now;
			if (item.rule) thread.rule = item.rule;
			console.log(`[threads] reply ${item.key}`);
		} catch (err) {
			console.warn(`[threads] reply ${item.key}: ${(err as Error).message}`);
		}
		changed = true;
	};
	for (const item of items) {
		const thread = live ? liveThread(log, item.key) : undefined;
		if (thread) {
			await reply(thread, { ...item, text: `🔄 ${item.text}` });
			continue;
		}
		// "No more restrictions" only matters under the post that said there were some.
		if (item.rule === 'open') continue;
		const entry: ThreadEntry = {
			key: item.key,
			kind: item.kind,
			name: item.name,
			at: now,
			last: now,
			text: fitText(item.text),
			media: null,
			replies: [],
			...(item.rule ? { rule: item.rule } : {}),
			dry: !live
		};
		if (live)
			try {
				entry.media = await publish(item, now);
				console.log(`[threads] posted ${item.key}`);
			} catch (err) {
				entry.error = (err as Error).message;
				console.warn(`[threads] ${item.key}: ${entry.error}`);
			}
		log.push(entry);
		changed = true;
	}
	if (live) {
		// Snow still falling where a snow thread is up: the new numbers under it now and then.
		for (const e of log.filter(
			(x) =>
				x.kind === 'snow' &&
				x.media &&
				!x.deletedAt &&
				!x.dry &&
				x.replies.length < MAX_REPLIES &&
				now - x.last >= STILL_SNOWING_EVERY
		)) {
			const more = stillSnowing(e);
			if (more) await reply(e, more);
		}
		for (const e of dueToDelete(log, now, holds))
			try {
				e.numbers = await readNumbers(e.media!).catch(() => e.numbers);
				e.numbersAt = now;
				await takeDown(e);
				e.deletedAt = now;
				delete e.takeDownError;
				console.log(`[threads] took down ${e.key}`);
				changed = true;
			} catch (err) {
				// Tried again next run. Noted so the health check says so: some pictures may not stay up.
				e.takeDownError = (err as Error).message;
				changed = true;
				console.warn(`[threads] take down ${e.key}: ${e.takeDownError}`);
			}
		for (const e of threadsToRead(log, now))
			try {
				e.numbers = await readNumbers(e.media!);
				e.numbersAt = now;
				changed = true;
			} catch (err) {
				console.warn(`[threads] numbers for ${e.key}: ${(err as Error).message}`);
			}
	}
	if (changed) saveLog(keepThreads(log, now));
}

/** For /stats: the posts so far, newest first, and the last 30 days by kind. */
export function threadLog(now = Date.now()) {
	const live = token() !== null;
	const log = readLog().filter((e) => !live || !e.dry);
	return { live, entries: log.slice().reverse().slice(0, 40), kinds: summarizeThreads(log, now) };
}

let keyLook: { at: number; problem: string | undefined } | null = null;

/**
 * For the daily health check: null without a key; a problem when the last post failed, a post that should have come
 * down hasn't, or the key stopped working.
 */
export async function threadsProblem(now = Date.now()): Promise<string | null | undefined> {
	if (!token()) return null;
	const log = readLog().filter((e) => !e.dry);
	const last = log.at(-1);
	if (last?.error)
		return `the last post failed: ${last.error.replace(/https?:\S+/g, '').slice(0, 100)}`;
	const stuck = log.find((e) => e.takeDownError && !e.deletedAt);
	if (stuck)
		return `a post won't come down: ${stuck.takeDownError!.replace(/https?:\S+/g, '').slice(0, 100)}`;
	if (!keyLook || now - keyLook.at > 12 * HOUR) {
		let problem: string | undefined;
		try {
			await call('/me', { fields: 'id' });
		} catch {
			problem = 'the Threads key no longer works (renew it)';
		}
		keyLook = { at: now, problem };
	}
	return keyLook.problem;
}
