import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { distanceMiles } from '../geo';
import type { Camera } from '../types';
import { getCatalog } from './catalog';

// A rolling window of pictures from the cameras near mountain passes, so a visitor can watch the last couple
// of hours and see whether snow is building up, and share a before-and-after or a short video from up to six
// hours back. On a server with a lasting disk (HISTORY_DIR, by default a "replay" folder next to STATS_FILE)
// each picture is written there as it is taken and read back after a restart or deploy, so the replay survives
// them; two copies of the app running side by side during a deploy write to the same folder, and the new one
// reads it again a few minutes after it starts. Without a disk (local runs) the pictures stay in memory.
// Only cameras whose owner publishes them for public use are recorded (WSDOT, WSDOT Aviation, Caltrans and the
// National Park Service), never Windy pictures. ODOT's pictures are left out: its terms cover serving one
// refreshed copy, not keeping past ones; Idaho 511's and Nevada 511's too, as they publish no terms.

// One picture every five minutes by default; HISTORY_EVERY_SECONDS lets tests record faster.
const EVERY_MS = Math.max(5, Number(process.env.HISTORY_EVERY_SECONDS) || 300) * 1000;
/** Every picture from the last two hours (the replay), then one every half hour back to six hours. */
export const REPLAY_MS = 2 * 60 * 60_000;
const KEEP_MS = 6 * 60 * 60_000;
const SPARSE_MS = 30 * 60_000;
const NEAR_PASS_MILES = 6;
// About 32 frames each (24 recent, 8 older): roughly 1 MB a camera on disk, or 0.3 MB in memory at the smaller size.
const MAX_CAMERAS = 240;
const DIR =
	process.env.HISTORY_DIR ||
	(process.env.STATS_FILE ? path.join(path.dirname(process.env.STATS_FILE), 'replay') : null);
// Sharper on disk (good enough for a phone-sized video); smaller when it all has to fit in memory.
const WIDTH = DIR ? 720 : 480;
const RECORDABLE = new Set(['WSDOT', 'WSDOT Aviation', 'Caltrans', 'National Park Service']);

export interface Frame {
	t: number;
	hash: string;
	/** In memory when there is no disk; on disk, read when asked for. */
	jpeg?: Buffer;
}

// One file per picture: <camera id>/<time>-<hash>.jpg. Camera ids are already safe file names.
const frameFile = (id: string, f: { t: number; hash: string }) =>
	path.join(DIR!, id, `${f.t}-${f.hash}.jpg`);
const FRAME_NAME = /^(\d+)-([a-f0-9]{40})\.jpg$/;

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
		const frame: Frame = { t: Date.now(), hash };
		if (DIR) {
			await mkdir(path.join(DIR, camera.id), { recursive: true });
			await writeFile(frameFile(camera.id, frame), jpeg);
		} else frame.jpeg = jpeg;
		list.push(frame);
		const kept = thin(list);
		frames.set(camera.id, kept);
		if (DIR)
			for (const f of list)
				if (!kept.includes(f)) void unlink(frameFile(camera.id, f)).catch(() => {});
	} catch {
		// a failed grab just leaves a gap
	}
}

/** Keep every frame of the last two hours, and older ones at least half an hour apart, up to six hours. */
export function thin<T extends { t: number }>(list: T[], now = Date.now()): T[] {
	const out: T[] = [];
	let last = -Infinity;
	for (const f of list) {
		const age = now - f.t;
		if (age > KEEP_MS) continue;
		if (age <= REPLAY_MS || f.t - last >= SPARSE_MS) {
			out.push(f);
			last = f.t;
		}
	}
	return out;
}

async function captureAll() {
	const targets = historyTargets();
	for (let i = 0; i < targets.length; i += 6) await Promise.all(targets.slice(i, i + 6).map(grab));
}

/**
 * Read the pictures saved on disk into the replay, keeping any already in memory, and remove ones too old to
 * keep (and folders of cameras no longer recorded). Run at start, and again a few minutes later to pick up
 * what the copy being replaced saved while this one started.
 */
export async function loadSaved(now = Date.now()) {
	if (!DIR) return;
	const wanted = new Set(historyTargets().map((c) => c.id));
	let dirs: string[] = [];
	try {
		dirs = await readdir(DIR);
	} catch {
		return;
	}
	for (const id of dirs) {
		if (!wanted.has(id)) {
			void rm(path.join(DIR, id), { recursive: true, force: true }).catch(() => {});
			continue;
		}
		let names: string[] = [];
		try {
			names = await readdir(path.join(DIR, id));
		} catch {
			continue;
		}
		const have = new Map((frames.get(id) ?? []).map((f) => [f.t, f]));
		for (const name of names) {
			const m = name.match(FRAME_NAME);
			if (m && !have.has(Number(m[1]))) have.set(Number(m[1]), { t: Number(m[1]), hash: m[2] });
		}
		const all = [...have.values()].sort((a, b) => a.t - b.t);
		const kept = thin(all, now);
		frames.set(id, kept);
		for (const f of all) if (!kept.includes(f)) void unlink(frameFile(id, f)).catch(() => {});
	}
}

/** Start recording. Safe to call more than once. */
export function startHistory() {
	if (started) return;
	started = Date.now();
	void loadSaved();
	const again = setTimeout(() => void loadSaved(), 4 * 60_000);
	const first = setTimeout(() => void captureAll(), Math.min(10_000, EVERY_MS));
	const timer = setInterval(() => void captureAll(), EVERY_MS);
	again.unref?.();
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

export async function getFrame(id: string, t: number): Promise<Buffer | null> {
	const frame = frames.get(id)?.find((f) => f.t === t);
	if (!frame) return null;
	if (frame.jpeg) return frame.jpeg;
	if (!DIR) return null;
	try {
		return await readFile(frameFile(id, frame));
	} catch {
		return null;
	}
}

/** For tests. */
export function _addFrameForTest(id: string, frame: Frame) {
	frames.set(id, [...(frames.get(id) ?? []), frame]);
}
