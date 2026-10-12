import opentype from 'opentype.js';
import sharp from 'sharp';
import regular from './fonts/inter-latin-400.woff?inline';
import bold from './fonts/inter-latin-700.woff?inline';
import mark from '../markPaths.txt?raw';
import { DEFAULT_TIME_ZONE } from '../regions';

// The pictures shown when someone shares a link (Facebook, messages): 1200 by 630, a camera picture (or a few,
// or a map of the drive) on the left and the name, what it is, the picture credit and our address on the right.
// Text is drawn as shapes from a font that ships with the app (Inter, SIL Open Font License, fonts/OFL.txt), so
// the cards look the same on any server, with or without fonts installed.

export const WIDTH = 1200;
export const HEIGHT = 630;

type Weight = 'regular' | 'bold';
let faces: Record<Weight, opentype.Font> | null = null;
function face(weight: Weight): opentype.Font {
	if (!faces) {
		const parse = (dataUrl: string) => {
			const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
			return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
		};
		faces = { regular: parse(regular), bold: parse(bold) };
	}
	return faces[weight];
}

/** Glyph by glyph (Inter's ligature tables are more than the font library handles), with kerning. */
function layout(text: string, size: number, weight: Weight) {
	const font = face(weight);
	const scale = size / font.unitsPerEm;
	const glyphs: { glyph: opentype.Glyph; x: number }[] = [];
	let x = 0;
	let prev: opentype.Glyph | null = null;
	for (const ch of text) {
		const glyph = font.charToGlyph(ch);
		if (prev) x += font.getKerningValue(prev, glyph) * scale;
		glyphs.push({ glyph, x });
		x += (glyph.advanceWidth ?? 0) * scale;
		prev = glyph;
	}
	return { glyphs, width: x };
}

export const textWidth = (text: string, size: number, weight: Weight = 'regular') =>
	layout(text, size, weight).width;

/** Shorten with "…" until it fits. */
export function fit(text: string, size: number, maxWidth: number, weight: Weight = 'regular') {
	if (textWidth(text, size, weight) <= maxWidth) return text;
	let s = text;
	while (s.length > 1 && textWidth(`${s.trimEnd()}…`, size, weight) > maxWidth) s = s.slice(0, -1);
	return `${s.trimEnd()}…`;
}

/** Break into lines at spaces; the last line is shortened with "…" if there is more. */
export function wrap(
	text: string,
	size: number,
	maxWidth: number,
	maxLines: number,
	weight: Weight = 'regular'
): string[] {
	const lines: string[] = [];
	let line = '';
	// Only ordinary spaces: "9:26 AM" (a narrow no-break space) stays on one line.
	const words = text.split(/ +/).filter(Boolean);
	for (const [i, word] of words.entries()) {
		const next = line ? `${line} ${word}` : word;
		if (!line || textWidth(next, size, weight) <= maxWidth) {
			line = next;
			continue;
		}
		if (lines.length === maxLines - 1) {
			lines.push(fit(`${line} ${words.slice(i).join(' ')}`, size, maxWidth, weight));
			return lines;
		}
		lines.push(line);
		line = word;
	}
	if (line) lines.push(fit(line, size, maxWidth, weight));
	return lines;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One line of text as an SVG path; `anchor` like SVG's text-anchor. */
function text(
	s: string,
	x: number,
	y: number,
	size: number,
	fill: string,
	weight: Weight = 'regular',
	anchor: 'start' | 'middle' | 'end' = 'start'
): string {
	const { glyphs, width } = layout(s, size, weight);
	const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
	const d = glyphs
		.map(({ glyph, x: gx }) => glyph.getPath(left + gx, y, size).toPathData(1))
		.join('');
	return d ? `<path d="${esc(d)}" fill="${fill}"/>` : '';
}

// ---- Layout -----------------------------------------------------------------------------------------------

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}
/** Where the pictures (or map) go, and the text column. */
const LEFT: Box = { x: 48, y: 48, w: 672, h: 534 };
const PANEL = { x: 768, w: 384 };
const GAP = 12;
const RADIUS = 18;

/** Boxes for 1 to 4 pictures inside `area`. */
export function grid(n: number, area: Box): Box[] {
	const half = (len: number) => (len - GAP) / 2;
	const { x, y, w, h } = area;
	if (n <= 1) return [area];
	if (n === 2)
		return [
			{ x, y, w, h: half(h) },
			{ x, y: y + half(h) + GAP, w, h: half(h) }
		];
	const top =
		n === 3
			? [{ x, y, w, h: half(h) }]
			: [
					{ x, y, w: half(w), h: half(h) },
					{ x: x + half(w) + GAP, y, w: half(w), h: half(h) }
				];
	return [
		...top,
		{ x, y: y + half(h) + GAP, w: half(w), h: half(h) },
		{ x: x + half(w) + GAP, y: y + half(h) + GAP, w: half(w), h: half(h) }
	];
}

/** A single picture keeps its shape: as big as fits in the area, centred. */
function fitted(width: number, height: number, area: Box): Box {
	const scale = Math.min(area.w / width, area.h / height);
	const w = Math.round(width * scale);
	const h = Math.round(height * scale);
	return {
		x: Math.round(area.x + (area.w - w) / 2),
		y: Math.round(area.y + (area.h - h) / 2),
		w,
		h
	};
}

const rounded = (b: Box) =>
	Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}"><rect width="${b.w}" height="${b.h}" rx="${RADIUS}"/></svg>`
	);

/** A picture cut to its box with rounded corners. */
async function tile(input: Buffer, b: Box, fit: 'cover' | 'fill') {
	const box = { w: Math.round(b.w), h: Math.round(b.h) };
	const input2 = await sharp(input)
		.rotate()
		.resize(box.w, box.h, { fit, kernel: 'lanczos3' })
		.composite([{ input: rounded({ ...b, ...box }), blend: 'dest-in' }])
		.png()
		.toBuffer();
	return { input: input2, left: Math.round(b.x), top: Math.round(b.y) };
}

const BRAND_SKY = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2540"/><stop offset=".62" stop-color="#16607a"/><stop offset="1" stop-color="#f59e4b"/></linearGradient></defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
<path d="M0 630 V420 L120 330 L190 390 L310 290 L430 400 L520 350 L640 460 L760 340 L880 430 L1010 360 L1200 450 V630Z" fill="#0d3a52" opacity=".9"/>
<path d="M0 630 V500 L150 430 L270 490 L420 410 L560 500 L700 450 L880 520 L1040 440 L1200 500 V630Z" fill="#082b3f"/>`;

/** Background: the first picture, blurred and darkened, or the app's dusk mountains (and for maps). */
async function background(first: Buffer | undefined): Promise<Buffer> {
	if (first)
		// Small, then blurred and stretched back up: soft colour, no detail.
		return sharp(
			await sharp(first).rotate().resize(300, 158, { fit: 'cover' }).blur(6).png().toBuffer()
		)
			.resize(WIDTH, HEIGHT)
			.modulate({ brightness: 0.42, saturation: 0.8 })
			.png()
			.toBuffer();
	return sharp(
		Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${BRAND_SKY}</svg>`
		)
	)
		.png()
		.toBuffer();
}

// ---- The drive, drawn ---------------------------------------------------------------------------------------

export interface MapSpec {
	route: [number, number][];
	from: string;
	to: string;
	/** Passes on the way, drawn as small peaks. */
	marks: { lat: number; lon: number; label: string }[];
}

/** The route as a line on a plain panel, with the start, the end and the passes named. */
function drawMap(m: MapSpec, b: Box): string {
	const pad = 54;
	const lats = m.route.map((p) => p[0]);
	const lons = m.route.map((p) => p[1]);
	const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
	const k = Math.cos((midLat * Math.PI) / 180);
	const minX = Math.min(...lons) * k;
	const maxX = Math.max(...lons) * k;
	const minY = Math.min(...lats);
	const maxY = Math.max(...lats);
	const scale = Math.min(
		(b.w - 2 * pad) / Math.max(maxX - minX, 1e-6),
		(b.h - 2 * pad) / Math.max(maxY - minY, 1e-6)
	);
	const ox = b.x + (b.w - (maxX - minX) * scale) / 2;
	const oy = b.y + (b.h - (maxY - minY) * scale) / 2;
	const xy = (lat: number, lon: number): [number, number] => [
		ox + (lon * k - minX) * scale,
		oy + (maxY - lat) * scale
	];
	// About 300 points is plenty for a line this size.
	const step = Math.max(1, Math.floor(m.route.length / 300));
	const pts = m.route.filter((_, i) => i % step === 0 || i === m.route.length - 1);
	const line = pts
		.map(([lat, lon]) =>
			xy(lat, lon)
				.map((v) => v.toFixed(1))
				.join(',')
		)
		.join(' ');
	const [sx, sy] = xy(...m.route[0]);
	const [ex, ey] = xy(...m.route[m.route.length - 1]);
	// What is already drawn: the ends' dots, then each label as it is placed.
	const taken = [
		{ x0: sx - 14, y0: sy - 14, x1: sx + 14, y1: sy + 14 },
		{ x0: ex - 17, y0: ey - 17, x1: ex + 17, y1: ey + 17 }
	];
	// A label goes beside its point, on the side away from the road, and never leaves the panel.
	type Spot = { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
	const label = (
		s: string,
		x: number,
		y: number,
		size: number,
		weight: Weight,
		fill: string,
		away?: [number, number],
		optional = false
	) => {
		const w = textWidth(s, size, weight);
		const left: Spot = { x: x - 20, y: y + size * 0.35, anchor: 'end' };
		const right: Spot = { x: x + 20, y: y + size * 0.35, anchor: 'start' };
		const above: Spot = { x, y: y - 22, anchor: 'middle' };
		const below: Spot = { x, y: y + size + 20, anchor: 'middle' };
		let order: Spot[];
		if (away) {
			const [dx, dy] = away;
			const side = dx > 0 ? left : right;
			const upDown = dy > 0 ? above : below;
			order = Math.abs(dx) >= Math.abs(dy) ? [side, upDown] : [upDown, side];
		} else order = x < b.x + b.w / 2 ? [right, left] : [left, right];
		const area = (o: Spot) => {
			const x0 = o.anchor === 'start' ? o.x : o.anchor === 'end' ? o.x - w : o.x - w / 2;
			return { x0, y0: o.y - size, x1: x0 + w, y1: o.y + 4 };
		};
		const free = (o: Spot) => {
			const a = area(o);
			return (
				a.y0 >= b.y + 8 &&
				a.y1 <= b.y + b.h - 4 &&
				a.x0 >= b.x + 12 &&
				a.x1 <= b.x + b.w - 12 &&
				!taken.some((t) => a.x0 < t.x1 && a.x1 > t.x0 && a.y0 < t.y1 && a.y1 > t.y0)
			);
		};
		const found = order.find(free);
		// A pass's name is left off rather than drawn over the start or the end.
		if (!found && optional) return '';
		const at = found ?? { ...order[0], anchor: 'middle' as const };
		// Centred labels slide sideways to stay inside; anything still too long is shortened.
		if (at.anchor === 'middle')
			at.x = Math.min(Math.max(at.x, b.x + 12 + w / 2), b.x + b.w - 12 - w / 2);
		at.y = Math.min(Math.max(at.y, b.y + size + 8), b.y + b.h - 10);
		taken.push(area(at));
		const t = fit(s, size, b.w - 24, weight);
		const halo = text(t, at.x, at.y, size, '#082b3f', weight, at.anchor).replace(
			'/>',
			' stroke="#082b3f" stroke-width="6" stroke-linejoin="round"/>'
		);
		return halo + text(t, at.x, at.y, size, fill, weight, at.anchor);
	};
	// Which way the road leaves each end, so the end's label sits on the other side.
	const projected = pts.map(([lat, lon]) => xy(lat, lon));
	const heading = (from: [number, number], list: [number, number][]): [number, number] => {
		const p =
			list.find(([x, y]) => Math.hypot(x - from[0], y - from[1]) > 40) ?? list[list.length - 1];
		return [p[0] - from[0], p[1] - from[1]];
	};
	const startAway = heading([sx, sy], projected);
	const endAway = heading([ex, ey], [...projected].reverse());
	const ends =
		label(m.from, sx, sy, 24, 'bold', '#ffffff', startAway) +
		label(m.to, ex, ey, 24, 'bold', '#ffffff', endAway);
	const peaks = m.marks
		.map(({ lat, lon, label: name }) => {
			const [x, y] = xy(lat, lon);
			return `<path d="M${x - 11} ${y + 8} L${x} ${y - 12} L${x + 11} ${y + 8} Z" fill="#ffffff" stroke="#082b3f" stroke-width="2.5"/>${label(name, x, y, 21, 'regular', '#e6f3f8', undefined, true)}`;
		})
		.join('');
	return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${RADIUS}" fill="#082b3f" fill-opacity=".82" stroke="#ffffff" stroke-opacity=".25"/>
<polyline points="${line}" fill="none" stroke="#04192a" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
<polyline points="${line}" fill="none" stroke="#ff9a2e" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="${sx}" cy="${sy}" r="11" fill="#ffffff" stroke="#04192a" stroke-width="4"/>
<circle cx="${ex}" cy="${ey}" r="14" fill="#ff9a2e" stroke="#ffffff" stroke-width="5"/>
${peaks}${ends}`;
}

// ---- The card -----------------------------------------------------------------------------------------------

export interface CardPicture {
	image: Buffer;
	/** A name printed on the picture, for cards with several. */
	caption?: string;
}

export interface Card {
	title: string;
	/** A line or two under the title: what it is, distance, counts. */
	lines: string[];
	/** "Picture: WSDOT" or "Pictures: WSDOT, Caltrans"; left out when there are no pictures. */
	credit?: string;
	pictures: CardPicture[];
	map?: MapSpec;
	/** Our address, printed at the bottom ("whatsupahead.com"). */
	site: string;
	now?: number;
}

const when = (ms: number) =>
	new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: DEFAULT_TIME_ZONE
	}).format(new Date(ms));

/** Draw a share card as a JPEG. Pictures that can't be read are left out. */
export async function renderCard(card: Card): Promise<Buffer> {
	const pictures: (CardPicture & { width: number; height: number })[] = [];
	for (const p of card.pictures.slice(0, 4)) {
		try {
			const meta = await sharp(p.image).metadata();
			if (meta.width && meta.height)
				pictures.push({ ...p, width: meta.width, height: meta.height });
		} catch {
			// a picture that isn't one is simply not shown
		}
	}

	// The left side: a map with up to two pictures under it, or up to four pictures, or the mark alone.
	let picBoxes: Box[] = [];
	let mapBox: Box | null = null;
	if (card.map) {
		pictures.splice(2);
		if (pictures.length) {
			mapBox = { ...LEFT, h: 300 };
			const row = { x: LEFT.x, y: LEFT.y + 300 + GAP, w: LEFT.w, h: LEFT.h - 300 - GAP };
			picBoxes =
				pictures.length === 1
					? [row]
					: [
							{ ...row, w: (row.w - GAP) / 2 },
							{ ...row, x: row.x + (row.w + GAP) / 2, w: (row.w - GAP) / 2 }
						];
		} else mapBox = LEFT;
	} else if (pictures.length === 1) {
		picBoxes = [fitted(pictures[0].width, pictures[0].height, LEFT)];
	} else picBoxes = grid(pictures.length, LEFT);

	const composites = await Promise.all(pictures.map((p, i) => tile(p.image, picBoxes[i], 'cover')));

	// Text column.
	const svg: string[] = [];
	const px = PANEL.x;
	svg.push(`<g transform="translate(${px} 50) scale(0.95)">${mark}</g>`);
	svg.push(text("What's Up Ahead", px + 74, 96, 27, '#ffffff', 'bold'));
	let y = 190;
	const titleSize = card.title.length > 40 ? 40 : 48;
	for (const l of wrap(card.title, titleSize, PANEL.w, 3, 'bold')) {
		svg.push(text(l, px, y, titleSize, '#ffffff', 'bold'));
		y += titleSize * 1.16;
	}
	y += 14;
	for (const line of card.lines) {
		for (const l of wrap(line, 26, PANEL.w, 2)) {
			if (y > 470) break;
			svg.push(text(l, px, y, 26, '#d7ecf5'));
			y += 35;
		}
		y += 6;
	}
	// The credit and when the pictures were taken, just above our address.
	if (pictures.length) {
		const credit = [
			...wrap(card.credit ?? '', 20, PANEL.w, 2),
			when(card.now ?? Date.now())
		].filter(Boolean);
		credit.forEach((l, i) =>
			svg.push(text(l, px, 532 - (credit.length - 1 - i) * 27, 20, '#a9cbdb'))
		);
	}
	svg.push(text(card.site, px, 580, 28, '#ff9a2e', 'bold'));

	// Pictures: a thin frame, and a caption strip when they carry a name.
	for (const [i, p] of pictures.entries()) {
		const b = picBoxes[i];
		svg.push(
			`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${RADIUS}" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="2"/>`
		);
		if (p.caption) {
			const size = b.w < 400 ? 20 : 24;
			svg.push(
				`<rect x="${b.x + 10}" y="${b.y + b.h - size - 30}" width="${Math.min(textWidth(fit(p.caption, size, b.w - 44, 'bold'), size, 'bold') + 24, b.w - 20)}" height="${size + 20}" rx="10" fill="#04192a" fill-opacity=".72"/>`,
				text(
					fit(p.caption, size, b.w - 44, 'bold'),
					b.x + 22,
					b.y + b.h - 26,
					size,
					'#ffffff',
					'bold'
				)
			);
		}
	}
	if (mapBox && card.map) svg.push(drawMap(card.map, mapBox));
	if (!pictures.length && !card.map)
		// Nothing we may show: the mark, large, where the picture would be.
		svg.push(
			`<g transform="translate(${LEFT.x + LEFT.w / 2 - 160} ${LEFT.y + LEFT.h / 2 - 190}) scale(5)">${mark}</g>`
		);

	const overlay = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
<defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#04192a" stop-opacity="0"/><stop offset="1" stop-color="#04192a" stop-opacity=".55"/></linearGradient></defs>
<rect x="${PANEL.x - 40}" width="${WIDTH - PANEL.x + 40}" height="${HEIGHT}" fill="url(#shade)"/>
${svg.join('\n')}</svg>`
	);

	return sharp(await background(card.map ? undefined : pictures[0]?.image))
		.composite([...composites, { input: overlay, left: 0, top: 0 }])
		.jpeg({ quality: 84, mozjpeg: true })
		.toBuffer();
}

/** Download a camera picture for a card: a few seconds at most, and only real pictures. */
export async function fetchPicture(url: string): Promise<Buffer | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? 'image/')) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		return buf.length > 1000 ? buf : null;
	} catch {
		return null;
	}
}

// ---- Before and after ---------------------------------------------------------------------------------------

export interface PairCard {
	title: string;
	/** "3 h apart · Picture: WSDOT · Mon, Oct 12". */
	line: string;
	before: { image: Buffer; label: string };
	after: { image: Buffer; label: string };
	site: string;
}

/** Two pictures side by side, labelled with their times, and the camera's name under them. */
export async function renderPair(card: PairCard): Promise<Buffer> {
	const w = 552;
	const h = 414;
	const boxes: Box[] = [
		{ x: 40, y: 36, w, h },
		{ x: WIDTH - 40 - w, y: 36, w, h }
	];
	const shots = [card.before, card.after];
	const composites = await Promise.all(shots.map((s, i) => tile(s.image, boxes[i], 'cover')));
	const svg: string[] = [];
	shots.forEach((s, i) => {
		const b = boxes[i];
		const pill = fit(s.label, 26, b.w - 60, 'bold');
		const pw = textWidth(pill, 26, 'bold') + 32;
		svg.push(
			`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${RADIUS}" fill="none" stroke="#ffffff" stroke-opacity=".4" stroke-width="2"/>`,
			`<rect x="${b.x + 14}" y="${b.y + b.h - 62}" width="${pw}" height="48" rx="12" fill="${i ? '#ff9a2e' : '#04192a'}" fill-opacity="${i ? 1 : 0.78}"/>`,
			text(pill, b.x + 30, b.y + b.h - 29, 26, i ? '#04192a' : '#ffffff', 'bold')
		);
	});
	svg.push(`<g transform="translate(40 478) scale(1.05)">${mark}</g>`);
	const right = WIDTH - 40;
	svg.push(text(fit(card.title, 38, right - 122, 'bold'), 122, 520, 38, '#ffffff', 'bold'));
	const room = right - 122 - textWidth(card.site, 28, 'bold') - 30;
	svg.push(text(fit(card.line, 22, room), 122, 562, 22, '#d7ecf5'));
	svg.push(text(card.site, WIDTH - 40, 562, 28, '#ff9a2e', 'bold', 'end'));
	const overlay = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${svg.join('\n')}</svg>`
	);
	return sharp(await background(card.after.image))
		.composite([...composites, { input: overlay, left: 0, top: 0 }])
		.jpeg({ quality: 84, mozjpeg: true })
		.toBuffer();
}
