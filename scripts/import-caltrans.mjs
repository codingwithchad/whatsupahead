// Add California (Caltrans) road cameras as camera data files in data/cameras/us-ca/.
// Usage: node scripts/import-caltrans.mjs [--write]
// No key needed: Caltrans publishes each district's camera list as open data (CWWP2, "no charge for the use of
// this data"; its pages are public domain under the Caltrans Conditions of Use). Only cameras that are in service,
// inside California, and whose picture actually loads are added; ones we already have are skipped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFiles, fileFor, regionAt } from './lib/data.mjs';

const write = process.argv.includes('--write');
const DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Caltrans's server is sometimes slow; try each district's list a few times.
const list = async (d, tries = 3) => {
	const n = String(d).padStart(2, '0');
	try {
		const res = await fetch(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${n}.json`, {
			signal: AbortSignal.timeout(60000)
		});
		if (!res.ok) throw new Error(`Caltrans district ${d} returned ${res.status}`);
		return (await res.json()).data.map((x) => x.cctv);
	} catch (e) {
		if (tries <= 1) throw e;
		return list(d, tries - 1);
	}
};
const inventory = (await Promise.all(DISTRICTS.map(list))).flat();

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, 60)
		.replace(/^-+|-+$/g, '');

// Words kept in capitals when a name is written all in capitals ("FRE-41-AT RTE 99 IC").
const KEEP_CAPS = new Set([
	'NB',
	'SB',
	'EB',
	'WB',
	'IC',
	'OC',
	'US',
	'SR',
	'LAX',
	'SFO',
	'SFOBB',
	'JSO',
	'JWO',
	'UP',
	'RR',
	'HOV'
]);
const SMALL = new Set(['AT', 'TO', 'OF', 'ON', 'AND', 'THE', 'IN']);
const titleCase = (s) =>
	s.replace(/[A-Za-z]+/g, (w, at) =>
		w !== w.toUpperCase() || /\d/.test(w) || KEEP_CAPS.has(w) || w.length === 1
			? w
			: SMALL.has(w) && at > 0
				? w.toLowerCase()
				: w[0] + w.slice(1).toLowerCase()
	);

/**
 * Caltrans names carry district camera codes and suffixes, and some districts write them in capitals:
 * "(C132)I-5 : Just North Of SR-56_T" -> "I-5 – Just North Of SR-56", "TVC71 -- US-101 : AT MCKEE RD" ->
 * "US-101 at Mckee Rd", "FRE-41-AT RTE 99 IC" (route SR-41) -> "SR-41 at Rte 99 IC".
 */
function cleanName(raw, route) {
	let name = raw
		.replace(/^T\w{3,4}\s*--\s*/, '')
		.replace(/^\(C ?\d+ ?\)\s*/i, '')
		.replace(/^\(\d+\)\s*/, '')
		.replace(/^\d+ - /, '')
		.replace(/\s*\(C\d+\)|\s*\(T\)/g, '')
		.replace(/_/g, ' ')
		.replace(/\s*:\s*(\(\d+\)\s*)?/, ' – ')
		.replace(/[\s-]+T$/, '');
	const caps = (t) => {
		const letters = t.replace(/[^A-Za-z]/g, '');
		return letters && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.8;
	};
	// District 6: county, route, then the place ("KER-204-AT 8TH ST").
	const county = name.match(/^[A-Z]{2,3}-\d+[A-Z]?-(AT\s+)?/);
	if (county && route) {
		const rest = name.slice(county[0].length);
		name = `${route} ${county[1] ? 'at' : '–'} ${caps(rest) ? titleCase(rest) : rest}`;
	} else if (caps(name)) name = titleCase(name);
	// "Fawndale", "at Nason St." or "1 mile w/o Rte 78" alone: say which highway.
	const number = route?.match(/\d+/)?.[0];
	if (number && !new RegExp(`(^|\\D)${number}(\\D|$)`).test(name))
		name = `${route.replace(/^([A-Z]+)[- ]?0*(\d+)/, '$1-$2')} – ${name}`;
	name = name
		.replace(/ – at /i, ' at ')
		.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, n, s) => n + s.toLowerCase());
	return name.replace(/\s+/g, ' ').trim();
}

const files = dataFiles('cameras').map((file) => JSON.parse(readFileSync(file, 'utf8')));
const haveUrls = new Set(files.map((cam) => (cam.feed_url ?? '').toLowerCase()));
const ids = new Set(files.map((cam) => cam.id));

const candidates = inventory
	.filter((c) => c.inService === 'true')
	.map((c) => {
		const l = c.location;
		const name = cleanName(l.locationName ?? '', l.route);
		const place = (l.nearbyPlace ?? '').trim();
		return {
			lat: Number(l.latitude),
			lon: Number(l.longitude),
			url: String(c.imageData?.static?.currentImageURL ?? '').replace(/^http:/i, 'https:'),
			// "Bogard" alone says little; "Bogard (Susanville)" says where.
			name:
				place && !name.toLowerCase().includes(place.toLowerCase()) ? `${name} (${place})` : name,
			route: (l.route ?? '').replace(/^([A-Z]+)-0*(\d+)$/, '$1 $2'),
			district: l.district,
			minutes: Number(c.imageData?.static?.currentImageUpdateFrequency) || 0
		};
	})
	.filter((c) => c.url && c.name && regionAt(c.lat, c.lon)?.abbr === 'CA')
	.filter((c) => !haveUrls.has(c.url.toLowerCase()));

async function isJpeg(url) {
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
		const bytes = new Uint8Array(await r.arrayBuffer());
		return r.ok && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.length > 2000;
	} catch {
		return false;
	}
}

let added = 0;
let dead = 0;
const seen = new Set();
for (let i = 0; i < candidates.length; i += 10) {
	const batch = candidates.slice(i, i + 10);
	const ok = await Promise.all(batch.map((c) => isJpeg(c.url)));
	batch.forEach((c, n) => {
		if (!ok[n]) return void dead++;
		if (seen.has(c.url)) return;
		seen.add(c.url);
		let id = `caltrans-${slug(c.name)}`;
		if (ids.has(id))
			id = `${id}-d${c.district}-${slug(
				c.url
					.split('/')
					.pop()
					.replace(/\.jpg$/, '')
			)}`.slice(0, 90);
		ids.add(id);
		const camera = {
			id,
			name: c.name,
			lat: c.lat,
			lon: c.lon,
			feed_url: c.url,
			feed_type: 'image',
			source: 'Caltrans',
			status: 'approved',
			approved_by: 'codingwithchad',
			page_url: 'https://quickmap.dot.ca.gov/',
			embed_mode: 'direct',
			// Caltrans renews most pictures every few minutes; asking more often only fetches the same one.
			refresh_seconds: Math.max(120, Math.min(600, c.minutes * 60)),
			tags: ['road'],
			attribution_text: 'California Department of Transportation (Caltrans)',
			created_at: new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
			...(c.route ? { route: c.route } : {})
		};
		const file = fileFor('cameras', id, c.lat, c.lon);
		if (existsSync(file)) return;
		added++;
		if (write) writeFileSync(file, JSON.stringify(camera, null, 2) + '\n');
	});
}

console.log(
	`${write ? 'Added' : 'Would add'} ${added} Caltrans cameras (${dead} pictures not loading, ${inventory.length} in Caltrans's lists).`
);
