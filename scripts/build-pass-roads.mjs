// Save the line of each pass's highway, so its page can list cameras in the order you'd pass them.
// Usage: node scripts/build-pass-roads.mjs [--write]
// For each pass: the cameras on the pass's highway within 50 miles (or 25 or 12, if the longer line wanders), the farthest one on each side of the summit,
// and the free OSRM route from one to the other, stored as an encoded line (`road`).
// Passes with fewer than three cameras on their highway get none and keep nearest-first order.
import { readFileSync, writeFileSync } from 'node:fs';
import { dataFiles, loadAll } from './lib/data.mjs';

const WRITE = process.argv.includes('--write');
const MILES = 50;
const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';
const tidy = (s) =>
	(s ?? '')
		.toUpperCase()
		.replace(/^(SR|SH|ID|NV|CA|OR|WA|HWY)\b/, 'SR')
		.replace(/\W/g, '');
const rad = Math.PI / 180;
const xy = (p, o) => [(p.lon - o.lon) * Math.cos(o.lat * rad) * 69.05, (p.lat - o.lat) * 69.05];
const miles = (a, b) => Math.hypot(...xy(a, b));

const cameras = loadAll('cameras').filter((c) => c.availability !== 'seasonal');
for (const file of dataFiles('passes')) {
	const pass = JSON.parse(readFileSync(file, 'utf8'));
	let found = null;
	// The widest stretch whose line works; a long one can wander onto another highway, so try shorter ones.
	for (const reach of [50, 25, 12]) {
		found = await lineFor(pass, reach);
		if (typeof found !== 'string') break;
		console.log(`${pass.id} (${reach} mi): ${found}`);
	}
	if (!found || typeof found === 'string') {
		if (WRITE && pass.road) {
			delete pass.road;
			writeFileSync(file, JSON.stringify(pass, null, 2) + '\n');
		}
		continue;
	}
	console.log(`${pass.id}: ${found.note}`);
	if (WRITE) {
		pass.road = found.encoded;
		writeFileSync(file, JSON.stringify(pass, null, 2) + '\n');
	}
}

/** The highway's line over the pass, reaching `reach` miles out, or why there isn't one. */
async function lineFor(pass, reach) {
	const road = tidy(pass.route);
	const on = cameras.filter((c) => tidy(c.route) === road && miles(c, pass) <= reach);
	if (on.length < 3) return reach === 50 ? null : `${on.length} cameras on ${pass.route}`;
	const far = (list) => list.sort((a, b) => miles(b, pass) - miles(a, pass))[0];
	const a = far([...on]);
	const [ax, ay] = xy(a, pass);
	// The farthest camera on the other side of the summit, if there is one.
	const b = far(
		on.filter((c) => {
			const [x, y] = xy(c, pass);
			return x * ax + y * ay < 0;
		})
	);
	// Straight from one end to the other: routing through the summit's point can loop off at an exit and back.
	const stops = [a, b ?? pass].map((p) => `${p.lon},${p.lat}`).join(';');
	const res = await fetch(
		`https://router.project-osrm.org/route/v1/driving/${stops}?overview=full&geometries=geojson`,
		{ headers: { 'User-Agent': USER_AGENT } }
	);
	const route = (await res.json()).routes?.[0];
	await new Promise((r) => setTimeout(r, 1100));
	if (!route) return 'no route';
	const driven = route.distance / 1609.34;
	if (driven < 5) return null;
	const line = simplify(route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })));
	const miss = offLine(pass, line).off;
	if (miss > 2) return `the line misses the summit by ${miss.toFixed(1)} mi`;
	// A camera far more road miles from the summit than straight miles means the line wanders off and back.
	const summit = offLine(pass, line).along;
	const wanders = on.filter(
		(c) => Math.abs(offLine(c, line).along - summit) > 2.2 * miles(c, pass) + 1.5
	);
	if (wanders.length) return `the line wanders (${wanders[0].name})`;
	const off = Math.max(...on.map((c) => offLine(c, line).off));
	if (off > 1) return `a camera on ${pass.route} is ${off.toFixed(0)} mi off the line`;
	const encoded = encode(line);
	return {
		encoded,
		note: `${on.length} cameras within ${reach} mi, ${driven.toFixed(0)} mi of road, farthest camera ${off.toFixed(1)} mi off it, ${encoded.length} characters`
	};
}

/** Fewer points, none of the line moving more than about 30 m (Douglas-Peucker). */
function simplify(points, tolerance = 0.02) {
	if (points.length < 3) return points;
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const stack = [[0, points.length - 1]];
	while (stack.length) {
		const [i, j] = stack.pop();
		let worst = 0,
			at = -1;
		for (let k = i + 1; k < j; k++) {
			const d = offSegment(points[k], points[i], points[j]);
			if (d > worst) [worst, at] = [d, k];
		}
		if (worst > tolerance) {
			keep[at] = 1;
			stack.push([i, at], [at, j]);
		}
	}
	return points.filter((_, k) => keep[k]);
}

function offSegment(p, a, b, withT = false) {
	const [bx, by] = xy(b, a);
	const [px, py] = xy(p, a);
	const len2 = bx * bx + by * by;
	const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
	const off = Math.hypot(px - t * bx, py - t * by);
	return withT ? [off, t] : off;
}

/** How far a point is from the line, and how far along the line its nearest point is (miles). */
function offLine(p, line) {
	let best = { off: Infinity, along: 0 };
	let along = 0;
	for (let k = 1; k < line.length; k++) {
		const seg = miles(line[k], line[k - 1]);
		const [off, t] = offSegment(p, line[k - 1], line[k], true);
		if (off < best.off) best = { off, along: along + t * seg };
		along += seg;
	}
	return best;
}

/** Google's encoded polyline, five decimals. */
function encode(points) {
	let out = '',
		lat = 0,
		lon = 0;
	const num = (v) => {
		v = v < 0 ? ~(v << 1) : v << 1;
		while (v >= 0x20) {
			out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
			v >>= 5;
		}
		out += String.fromCharCode(v + 63);
	};
	for (const p of points) {
		const [y, x] = [Math.round(p.lat * 1e5), Math.round(p.lon * 1e5)];
		num(y - lat);
		num(x - lon);
		[lat, lon] = [y, x];
	}
	return out;
}
