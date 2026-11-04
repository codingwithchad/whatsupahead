import sharp from 'sharp';

// Drawn mountains for a post with no camera picture to show (none near, or too dark to see). Each place gets its own
// ridges, worked out from its name, so two posts don't look alike and the same place always looks the same. It says
// so on the picture: it is a drawing, not what the road looks like now. Falling snow is three sheets of flakes, kept
// apart so a video can move each at its own speed.

const BASE_W = 1080;
/** How high the tallest peak reaches in the drawing, before it is moved to where the words end. */
const PEAK = 800;
const SNOW_DEEP = 1300;

const random = (seed: number) => () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 2 ** 32;
};
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

type Point = [number, number];
const line = (pts: Point[]) => pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');

/** A ridge line: a peak somewhere along it, then each stretch split and nudged until it looks like rock. */
function ridge(r: () => number, left: number, right: number, peak: number, rough: number): Point[] {
	let pts: Point[] = [
		[0, left],
		[BASE_W * (0.25 + r() * 0.5), peak],
		[BASE_W, right]
	];
	for (let depth = 0; depth < 6; depth++) {
		const next: Point[] = [];
		for (let i = 0; i < pts.length - 1; i++) {
			const [a, b] = [pts[i], pts[i + 1]];
			next.push(a, [
				(a[0] + b[0]) / 2 + (r() - 0.5) * rough * 0.4,
				(a[1] + b[1]) / 2 + (r() - 0.5) * rough
			]);
		}
		next.push(pts[pts.length - 1]);
		pts = next;
		rough *= 0.56;
	}
	return pts;
}

/** Flatten a ridge just enough that nothing rises past `limit`, so the words above stay on clear sky. */
function under(pts: Point[], limit: number, base: number): Point[] {
	const top = Math.min(...pts.map((p) => p[1]));
	if (top >= limit) return pts;
	const k = (base - limit) / (base - top);
	return pts.map(([x, y]) => [x, base - (base - y) * k]);
}

/** Snow down from a ridge line: deeper on the high parts, its lower edge in slow waves, not spikes. */
function snowcap(pts: Point[], r: () => number, base: number, reach: number): string {
	const a = r() * 6;
	const b = r() * 6;
	const edge = pts.map(([x, y]): Point => {
		const wave = 0.72 + 0.2 * Math.sin(x / 61 + a) + 0.1 * Math.sin(x / 23 + b);
		return [x, y + 26 + Math.max(0, base - y) * reach * wave];
	});
	return `M${line(pts)} L${line(edge.reverse())} Z`;
}

function pine(x: number, y: number, h: number, dark: string, snow: string): string {
	let out = '';
	for (let i = 0; i < 4; i++) {
		const top = y - h + (i * h) / 5.2;
		const tall = h * 0.42;
		const w = h * (0.14 + i * 0.075);
		const at = (dx: number, dy: number) =>
			`${(x + dx * w).toFixed(1)} ${(top + dy * tall).toFixed(1)}`;
		out += `<path d="M${at(0, 0)} L${at(1, 1)} L${at(-1, 1)} Z" fill="${dark}"/>`;
		out += `<path d="M${at(0, 0)} L${at(0.62, 0.62)} L${at(0.2, 0.5)} L${at(0, 0.66)} L${at(-0.3, 0.5)} L${at(-0.62, 0.62)} Z" fill="${snow}"/>`;
	}
	return out;
}

/**
 * The drawing as SVG, for a `width` by `height` picture: the sky, then the mountains with their top at `peakY`, so
 * they start where the words end. Below them a road in our orange, and pines.
 */
export function sceneSvg(name: string, width: number, height: number, peakY: number): string {
	const r = random(hash(name));
	const far = under(ridge(r, 1120, 1080, 900, 300), PEAK, 1140);
	const mid = under(ridge(r, 1210, 1290, 1040, 300), PEAK + 130, 1300);
	const near = ridge(r, 1400, 1340, 1270, 150);
	const bottom = 1920 + height;
	const fill = (pts: Point[], colour: string) =>
		`<path d="M${line(pts)} L${BASE_W} ${bottom} L0 ${bottom} Z" fill="${colour}"/>`;
	const road = `M${BASE_W * 0.68} 1920 C ${BASE_W * 0.2} 1800, ${BASE_W * 0.98} 1690, ${BASE_W * 0.52} 1590 S ${BASE_W * 0.3} 1490, ${BASE_W * 0.55} 1440`;
	const spots: [number, number, number][] = Array.from({ length: 34 }, () => [
		r() * BASE_W,
		1420 + r() * 440,
		90 + r() * 200
	]);
	const trees = spots
		.sort((a, b) => a[1] - b[1])
		// The middle stays clear for the road.
		.filter(([x, y]) => !(x > BASE_W * 0.3 && x < BASE_W * 0.74 && y < 1760))
		.map(([x, y, h]) =>
			y > 1650 ? pine(x, y, h, '#072033', '#cfe6f0') : pine(x, y, h, '#0e3a50', '#e6f3f8')
		)
		.join('');
	const horizon = peakY + 420;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${horizon}"><stop offset="0" stop-color="#071d33"/><stop offset=".58" stop-color="#14506e"/><stop offset=".86" stop-color="#6fa9bd"/><stop offset="1" stop-color="#f3c9a0"/></linearGradient>
<linearGradient id="ground" gradientUnits="userSpaceOnUse" x1="0" y1="1270" x2="0" y2="1920"><stop offset="0" stop-color="#eaf5fa"/><stop offset="1" stop-color="#a9cbdb"/></linearGradient>
</defs>
<rect width="${width}" height="${height}" fill="url(#sky)"/>
<g transform="translate(${(width - BASE_W) / 2} ${peakY - PEAK})">
${fill(far, '#3f7a94')}<path d="${snowcap(far, r, 1140, 0.8)}" fill="#dcecf3"/>
${fill(mid, '#205a74')}<path d="${snowcap(mid, r, SNOW_DEEP, 0.85)}" fill="#f4fafc"/>
${fill(near, 'url(#ground)')}
<path d="${road}" fill="none" stroke="#5f7f90" stroke-width="44" stroke-linecap="round"/>
<path d="${road}" fill="none" stroke="#ff9a2e" stroke-width="10" stroke-dasharray="44 34"/>
${trees}
</g></svg>`;
}

/** Room at each side, so a sheet can sway without showing its edge. */
export const SWAY_ROOM = 60;

const SHEETS = [
	{ seed: 3, flakes: 220, min: 1.6, max: 3.2, blur: 1, opacity: 0.75 },
	{ seed: 5, flakes: 90, min: 3.5, max: 6, blur: 1.2, opacity: 0.85 },
	{ seed: 9, flakes: 26, min: 7, max: 11, blur: 2.5, opacity: 0.8 }
];

const sheets = new Map<string, Promise<Buffer[]>>();

/**
 * Three sheets of flakes, small and far to big and near, each `width` plus room to sway and twice `height` tall: its
 * top half repeats below, so a video can slide a sheet down one `height` without a gap.
 */
export function flakeSheets(width: number, height: number): Promise<Buffer[]> {
	const key = `${width}x${height}`;
	let made = sheets.get(key);
	if (!made) {
		const W = width + 2 * SWAY_ROOM;
		made = Promise.all(
			SHEETS.map(({ seed, flakes, min, max, blur, opacity }) => {
				const r = random(seed);
				let dots = '';
				for (let i = 0; i < flakes; i++) {
					const x = r() * W;
					const y = r() * height;
					const size = min + r() * (max - min);
					const alpha = opacity * (0.6 + r() * 0.4);
					// Each flake twice, a sheet apart; one near an edge a third time, so it doesn't cut off there.
					for (const dy of [0, height, y < 40 ? 2 * height : -height])
						dots += `<circle cx="${x.toFixed(1)}" cy="${(y + dy).toFixed(1)}" r="${size.toFixed(1)}" fill="#fff" fill-opacity="${alpha.toFixed(2)}"/>`;
				}
				return sharp(
					Buffer.from(
						`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${2 * height}">${dots}</svg>`
					)
				)
					.blur(blur)
					.png()
					.toBuffer();
			})
		);
		sheets.set(key, made);
	}
	return made;
}

/** The flakes held still, for a picture rather than a video. */
export async function stillFlakes(width: number, height: number): Promise<Buffer[]> {
	const made = await flakeSheets(width, height);
	return Promise.all(
		made.map((sheet) =>
			sharp(sheet).extract({ left: SWAY_ROOM, top: 0, width, height }).png().toBuffer()
		)
	);
}
