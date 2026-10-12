import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { distanceMiles } from '../geo';
import type { Camera } from '../types';
import { getCatalog } from './catalog';

// A rolling window of small pictures from the cameras near mountain passes, so a visitor can watch the
// last couple of hours and see whether snow is building up. Kept in memory only: it starts empty after a
// restart and fills in as the server runs. Only cameras whose owner publishes them for public use are
// recorded (WSDOT, WSDOT Aviation, Caltrans and the National Park Service), never Windy pictures. ODOT's
// pictures are left out: its terms cover serving one refreshed copy, not keeping past ones.

// One picture every five minutes by default; HISTORY_EVERY_SECONDS lets tests record faster.
const EVERY_MS = Math.max(5, Number(process.env.HISTORY_EVERY_SECONDS) || 300) * 1000;
const KEEP_FRAMES = 24; // two hours at one every five minutes
const NEAR_PASS_MILES = 6;
// About 24 small frames each, roughly 0.4 MB a camera.
const MAX_CAMERAS = 240;
const WIDTH = 480;
const RECORDABLE = new Set(['WSDOT', 'WSDOT Aviation', 'Caltrans', 'National Park Service']);

export interface Frame {
	t: number;
	hash: string;
	jpeg: Buffer;
}

const frames = new Map<string, Frame[]>();
let started = 0;

/** The cameras worth recording: working pictures within a few miles of any tracked pass, closest first. */
export function historyTargets(): Camera[] {
	const { cameras, passes } = getCatalog();
	return cameras
		.filter(
			(c) =>
				c.feed_url &&
				c.feed_type === 'image' &&
				!c.provider &&
				c.availability !== 'seasonal' &&
				RECORDABLE.has(c.source)
		)
		.map((c) => ({ c, d: Math.min(...passes.map((p) => distanceMiles(p, c))) }))
		.filter((x) => x.d <= NEAR_PASS_MILES)
		.sort((a, b) => a.d - b.d)
		.slice(0, MAX_CAMERAS)
		.map((x) => x.c);
}

async function grab(camera: Camera) {
	try {
		const res = await fetch(camera.feed_url as string, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return;
		const input = Buffer.from(await res.arrayBuffer());
		if (input[0] !== 0xff || input[1] !== 0xd8 || input.length < 2000) return;
		const jpeg = await sharp(input)
			.rotate()
			.resize({ width: WIDTH, withoutEnlargement: true })
			.jpeg({ quality: 55, mozjpeg: true })
			.toBuffer();
		const hash = createHash('sha1').update(jpeg).digest('hex');
		const list = frames.get(camera.id) ?? [];
		// A camera that has not changed since the last grab adds nothing to the replay.
		if (list.length && list[list.length - 1].hash === hash) return;
		list.push({ t: Date.now(), hash, jpeg });
		while (list.length > KEEP_FRAMES) list.shift();
		frames.set(camera.id, list);
	} catch {
		// a failed grab just leaves a gap
	}
}

async function captureAll() {
	const targets = historyTargets();
	for (let i = 0; i < targets.length; i += 6) await Promise.all(targets.slice(i, i + 6).map(grab));
}

/** Start recording. Safe to call more than once. */
export function startHistory() {
	if (started) return;
	started = Date.now();
	const first = setTimeout(() => void captureAll(), Math.min(10_000, EVERY_MS));
	const timer = setInterval(() => void captureAll(), EVERY_MS);
	first.unref?.();
	timer.unref?.();
}

export function recordingSince(): number | null {
	return started || null;
}

export function listFrames(id: string): { t: number }[] | null {
	const list = frames.get(id);
	return list ? list.map((f) => ({ t: f.t })) : null;
}

export function getFrame(id: string, t: number): Buffer | null {
	return frames.get(id)?.find((f) => f.t === t)?.jpeg ?? null;
}

/** For tests. */
export function _addFrameForTest(id: string, frame: Frame) {
	frames.set(id, [...(frames.get(id) ?? []), frame]);
}
