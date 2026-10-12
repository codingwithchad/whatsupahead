import { createHash } from 'node:crypto';
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { previewCredit } from '../sharing';
import { getCatalog } from './catalog';
import { getFrame } from './history';

// A shared before-and-after: two pictures from one camera's replay (say 6 AM bare, 9 AM snow). The replay
// lives in memory for a few hours, but a shared link has to keep working, so the two pictures are saved to
// disk with a small note, and kept for 30 days. Only cameras whose pictures may appear in link previews
// (see ../sharing.ts) can be shared this way.

const DIR =
	process.env.MOMENTS_DIR ||
	path.join(path.dirname(process.env.STATS_FILE || '.stats/stats.json'), 'moments');
const KEEP_DAYS = 30;
const MAX_MOMENTS = 5000;

export interface Moment {
	id: string;
	camera: string;
	before: number;
	after: number;
	created: number;
}

const ID = /^[a-f0-9]{12}$/;
const file = (id: string, part: 'json' | 'before' | 'after') =>
	path.join(DIR, part === 'json' ? `${id}.json` : `${id}-${part}.jpg`);

function writeAtomic(target: string, data: string | Buffer) {
	writeFileSync(`${target}.tmp`, data);
	renameSync(`${target}.tmp`, target);
}

/** Can this camera's replay be shared as a before-and-after? */
export function canShareMoment(cameraId: string): boolean {
	const camera = getCatalog().cameras.find((c) => c.id === cameraId);
	return Boolean(camera && previewCredit(camera));
}

/**
 * Save a before-and-after from two pictures still in the replay. The same two pictures always get the same
 * link, so tapping again doesn't save them twice. Null if the camera can't be shared or a picture is gone.
 */
export function saveMoment(cameraId: string, before: number, after: number): Moment | null {
	if (!canShareMoment(cameraId) || !(before < after)) return null;
	const id = createHash('sha1').update(`${cameraId}|${before}|${after}`).digest('hex').slice(0, 12);
	const existing = getMoment(id);
	if (existing) return existing;
	const a = getFrame(cameraId, before);
	const b = getFrame(cameraId, after);
	if (!a || !b) return null;
	const moment: Moment = { id, camera: cameraId, before, after, created: Date.now() };
	mkdirSync(DIR, { recursive: true });
	writeAtomic(file(id, 'before'), a);
	writeAtomic(file(id, 'after'), b);
	writeAtomic(file(id, 'json'), JSON.stringify(moment));
	pruneSoon();
	return moment;
}

export function getMoment(id: string): Moment | null {
	if (!ID.test(id)) return null;
	try {
		return JSON.parse(readFileSync(file(id, 'json'), 'utf8')) as Moment;
	} catch {
		return null;
	}
}

export function momentPicture(id: string, which: 'before' | 'after'): Buffer | null {
	if (!ID.test(id)) return null;
	try {
		return readFileSync(file(id, which));
	} catch {
		return null;
	}
}

let lastPrune = 0;
/** Drop moments older than 30 days, and the oldest beyond 5,000. At most once an hour. */
function pruneSoon(now = Date.now()) {
	if (now - lastPrune < 60 * 60_000) return;
	lastPrune = now;
	try {
		const notes = readdirSync(DIR)
			.filter((f) => f.endsWith('.json'))
			.map((f) => ({ id: f.slice(0, -5), at: statSync(path.join(DIR, f)).mtimeMs }))
			.sort((x, y) => y.at - x.at);
		const old = notes.filter(
			(n, i) => i >= MAX_MOMENTS || now - n.at > KEEP_DAYS * 24 * 60 * 60_000
		);
		for (const n of old)
			for (const part of ['json', 'before', 'after'] as const)
				try {
					unlinkSync(file(n.id, part));
				} catch {
					// already gone
				}
	} catch (err) {
		console.warn(`[moments] prune: ${(err as Error).message}`);
	}
}
