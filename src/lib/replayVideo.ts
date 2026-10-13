import { localClock } from './format';
import { snowBetween } from './mountain';

// A short video from a camera's replay, made in the browser (nothing to install or pay for on the server):
// the pictures one after another in a 4:5 frame for Instagram and Facebook, with the time on each, the new
// snow at the nearest gauge as it adds up, the owner's credit and our address, so it travels with the video.

export const VIDEO_W = 720;
export const VIDEO_H = 900;

export interface VideoInput {
	name: string;
	place: string | null;
	credit: string;
	timeZone: string;
	frames: { t: number; image: CanvasImageSource & { width: number; height: number } }[];
	/** The snow gauge at the nearest pass, with its hourly depth readings. */
	snow: { station: string; hourly: { t: number; in: number }[] } | null;
}

/** The first format this browser can record that Instagram takes (MP4), or WebM, or null if it can't record. */
export function videoType(): string | null {
	if (typeof MediaRecorder === 'undefined') return null;
	for (const type of [
		'video/mp4;codecs=avc1.42E01E',
		'video/mp4;codecs=avc1',
		'video/mp4',
		'video/webm;codecs=vp9',
		'video/webm'
	])
		if (MediaRecorder.isTypeSupported(type)) return type;
	return null;
}

/** "+4 in of new snow since 6:10 AM", or null when the gauge shows less than an inch (or has no readings). */
export function snowLine(
	snow: VideoInput['snow'],
	from: number,
	to: number,
	timeZone: string
): string | null {
	if (!snow) return null;
	const inches = snowBetween(snow.hourly, from, to);
	return inches !== null && inches >= 1
		? `+${inches} in of new snow since ${localClock(from, timeZone)}`
		: null;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Draw one moment of the video: the picture at `i`, with everything printed around it. */
export function drawFrame(ctx: CanvasRenderingContext2D, v: VideoInput, i: number) {
	const first = v.frames[0].t;
	const frame = v.frames[i];
	const sky = ctx.createLinearGradient(0, 0, 0, VIDEO_H);
	sky.addColorStop(0, '#0b2540');
	sky.addColorStop(1, '#082b3f');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);

	// The camera's name (two lines at most) and where it is.
	ctx.fillStyle = '#ffffff';
	ctx.font = `bold 38px ${FONT}`;
	ctx.textBaseline = 'alphabetic';
	const lines = wrap(ctx, v.name, VIDEO_W - 56).slice(0, 2);
	lines.forEach((l, n) => ctx.fillText(l, 28, 60 + n * 44));
	ctx.fillStyle = '#a9cbdb';
	ctx.font = `26px ${FONT}`;
	const day = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
		timeZone: v.timeZone
	}).format(new Date(frame.t));
	ctx.fillText([v.place, day].filter(Boolean).join(' · '), 28, 60 + lines.length * 44 + 4);

	// The picture, as large as fits a 4:3 box, never stretched.
	const box = { x: 0, y: 160, w: VIDEO_W, h: 540 };
	ctx.fillStyle = '#04192a';
	ctx.fillRect(box.x, box.y, box.w, box.h);
	const scale = Math.min(box.w / frame.image.width, box.h / frame.image.height);
	const w = frame.image.width * scale;
	const h = frame.image.height * scale;
	ctx.drawImage(frame.image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);

	// The time of this picture, and the snow that has fallen since the first one.
	ctx.fillStyle = '#ffffff';
	ctx.font = `bold 54px ${FONT}`;
	ctx.fillText(localClock(frame.t, v.timeZone), 28, 772);
	const snow = snowLine(v.snow, first, frame.t, v.timeZone);
	if (snow) {
		ctx.fillStyle = '#ff9a2e';
		ctx.font = `bold 28px ${FONT}`;
		ctx.textAlign = 'right';
		ctx.fillText(snow.replace(/ since .*/, ''), VIDEO_W - 28, 750);
		ctx.font = `22px ${FONT}`;
		ctx.fillStyle = '#a9cbdb';
		ctx.fillText(
			`since ${localClock(first, v.timeZone)} at the ${v.snow!.station} gauge`,
			VIDEO_W - 28,
			778
		);
		ctx.textAlign = 'left';
	}

	// How far through the stretch of time we are.
	const last = v.frames.at(-1)!.t;
	const done = last > first ? (frame.t - first) / (last - first) : 1;
	ctx.fillStyle = 'rgba(255,255,255,0.2)';
	ctx.fillRect(28, 800, VIDEO_W - 56, 6);
	ctx.fillStyle = '#ff9a2e';
	ctx.fillRect(28, 800, (VIDEO_W - 56) * done, 6);

	// Whose pictures they are, and where to see more.
	ctx.font = `20px ${FONT}`;
	ctx.fillStyle = '#a9cbdb';
	ctx.fillText(v.credit, 28, 862);
	ctx.font = `bold 26px ${FONT}`;
	ctx.fillStyle = '#ff9a2e';
	ctx.textAlign = 'right';
	ctx.fillText('whatsupahead.com', VIDEO_W - 28, 864);
	ctx.textAlign = 'left';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
	const out: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/)) {
		const next = line ? `${line} ${word}` : word;
		if (ctx.measureText(next).width > width && line) {
			out.push(line);
			line = word;
		} else line = next;
	}
	if (line) out.push(line);
	return out;
}

/** How long each picture shows: about six seconds in all, then the last one holds. */
export function frameTimes(count: number): { each: number; hold: number } {
	return { each: Math.min(600, Math.max(180, Math.round(6000 / Math.max(1, count)))), hold: 1800 };
}

/** Record the video. Calls `progress` with 0 to 1 as it goes; resolves with the file. */
export async function recordVideo(
	v: VideoInput,
	type: string,
	progress: (done: number) => void = () => {}
): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = VIDEO_W;
	canvas.height = VIDEO_H;
	const ctx = canvas.getContext('2d')!;
	drawFrame(ctx, v, 0);
	const stream = canvas.captureStream(30);
	const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
	const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
	recorder.start(250);

	const { each, hold } = frameTimes(v.frames.length);
	const total = each * v.frames.length + hold;
	const start = performance.now();
	await new Promise<void>((resolve) => {
		// Redraw on every screen frame, so the recording gets a steady stream of frames even while a picture holds.
		const tick = () => {
			const elapsed = performance.now() - start;
			const i = Math.min(v.frames.length - 1, Math.floor(elapsed / each));
			drawFrame(ctx, v, i);
			progress(Math.min(1, elapsed / total));
			if (elapsed >= total) resolve();
			else requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	recorder.stop();
	await stopped;
	stream.getTracks().forEach((t) => t.stop());
	return new Blob(chunks, { type: type.split(';')[0] });
}
