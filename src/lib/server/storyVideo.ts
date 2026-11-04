import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { setPriority, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { flakeSheets, SWAY_ROOM } from './scene';
import type { Layers } from './shareCard';

// Stories where snow is really falling are short videos: the card's two sheets with the flakes moving between them,
// over our own picture of the news. Instagram fetches the video from us, so each is kept on disk until it has. Made
// by ffmpeg (from the ffmpeg-static package, or FFMPEG_PATH) at the lowest priority, so visitors never wait for it.
// A video that can't be made never stops a story: the still picture goes up instead.

const run = promisify(execFile);
const DIR = path.join(path.dirname(process.env.STATS_FILE || '.stats/stats.json'), 'story-video');
const SECONDS = 6;
/** Instagram wants 23 to 60 frames a second; fewer is less work for the server. */
const FPS = 24;
const TIMEOUT = 5 * 60_000;
const KEEP = 2 * 3600_000;

/** Far and small flakes fall slowly, near ones fast: pixels a second, and how far each sheet sways. */
const FALL = [
	{ speed: 120, sway: 20 },
	{ speed: 240, sway: 34 },
	{ speed: 420, sway: 50 }
];

/**
 * The drawing instructions: background, three sheets of flakes sliding down, then the words and pictures. Inputs are
 * in that order. A sheet is two screens tall, so it slides one screen and starts over.
 */
export function videoFilter(height: number): string {
	const steps = FALL.map(({ speed, sway }, i) => {
		const from = i ? `s${i}` : '0:v';
		const x = `-${SWAY_ROOM}+${sway}*sin(t*0.9+${i})`;
		const y = `mod(t*${speed}\\,${height})-${height}`;
		return `[${from}][${i + 1}:v]overlay=x='${x}':y='${y}'[s${i + 1}]`;
	});
	return [...steps, `[s3][4:v]overlay=format=auto,format=yuv420p[out]`].join(';');
}

/** The way to start ffmpeg. A deploy can lose the file's "may be run" mark, so a copy is made when that happened. */
let finding: Promise<string> | null = null;
function ffmpeg(): Promise<string> {
	finding ??= (async () => {
		const packaged = process.env.FFMPEG_PATH
			? null
			: ((await import('ffmpeg-static')).default as unknown as string | null);
		const first = process.env.FFMPEG_PATH || packaged || 'ffmpeg';
		try {
			await run(first, ['-version'], { timeout: 20000 });
			return first;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EACCES') throw err;
		}
		const copy = path.join(tmpdir(), 'whatsupahead-ffmpeg');
		copyFileSync(first, copy);
		chmodSync(copy, 0o755);
		await run(copy, ['-version'], { timeout: 20000 });
		return copy;
	})();
	finding.catch(() => (finding = null));
	return finding;
}

/** Run ffmpeg at the lowest priority, so the site stays quick while a video is made. */
async function encode(args: string[]) {
	const tool = await ffmpeg();
	await new Promise<void>((resolve, reject) => {
		const child = spawn(tool, ['-y', '-loglevel', 'error', ...args], {
			stdio: ['ignore', 'ignore', 'pipe'],
			timeout: TIMEOUT
		});
		if (child.pid)
			try {
				setPriority(child.pid, 19);
			} catch {
				// it only runs at the usual priority
			}
		let said = '';
		child.stderr.on('data', (d) => (said = `${said}${d}`.slice(-300)));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg stopped: ${said.trim() || code}`))
		);
	});
}

/** The card with snow falling, as an MP4 Instagram accepts for a story: H.264, AAC (silent), 6 seconds. */
export async function makeVideo(layers: Layers, file: string): Promise<void> {
	const work = mkdtempSync(path.join(tmpdir(), 'story-'));
	try {
		const sheets = await flakeSheets(layers.width, layers.height);
		const pictures = [layers.base, ...sheets, layers.top].map((data, i) => {
			const name = path.join(work, `${i}.png`);
			writeFileSync(name, data);
			return name;
		});
		await encode([
			...pictures.flatMap((p) => [
				'-loop',
				'1',
				'-framerate',
				String(FPS),
				'-t',
				String(SECONDS),
				'-i',
				p
			]),
			...['-f', 'lavfi', '-t', String(SECONDS), '-i', 'anullsrc=r=44100:cl=stereo'],
			...['-filter_complex', videoFilter(layers.height), '-map', '[out]', '-map', '5:a'],
			...['-threads', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24'],
			...['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', file]
		]);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

const NAME = /^[0-9a-f]{24}\.mp4$/;

/** Saves a video for Instagram to fetch, and clears old ones. The name to put in its address comes back. */
export async function saveVideo(layers: Layers): Promise<string> {
	mkdirSync(DIR, { recursive: true });
	for (const old of readdirSync(DIR)) {
		const file = path.join(DIR, old);
		if (Date.now() - statSync(file).mtimeMs > KEEP) rmSync(file, { force: true });
	}
	const name = `${randomBytes(12).toString('hex')}.mp4`;
	await makeVideo(layers, path.join(DIR, name));
	return name;
}

/** Where a saved video is, or null for any other name. */
export const videoFile = (name: string) => (NAME.test(name) ? path.join(DIR, name) : null);

let looked: { at: number; problem: string | null } | null = null;

/** For the daily health check: can this server make a video at all? A tiny one, once a day. */
export async function videoProblem(now = Date.now()): Promise<string | null> {
	if (looked && now - looked.at < 20 * 3600_000) return looked.problem;
	let problem: string | null = null;
	try {
		await encode([
			...['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1'],
			...['-c:v', 'libx264', '-f', 'null', '-']
		]);
	} catch (err) {
		problem = `story videos can't be made: ${(err as Error).message.slice(0, 100)}`;
	}
	looked = { at: now, problem };
	return problem;
}
