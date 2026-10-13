// Add the Windy.com webcams around a point as camera data files (in the right region folder).
// Usage: node --env-file=.env scripts/import-windy.mjs <lat> <lon> <radius_km> [tag,tag] [--write]
// Without --write it only lists what it would add. Skips cameras we already have (same Windy id, or any camera
// within about 100 m, such as a WSDOT camera Windy also shows) and anything outside data/regions.json.
// Windy's terms: pictures are shown no larger than Windy provides and always link back to Windy (the app does this
// for every camera with "provider": "windy").
import { existsSync, writeFileSync } from 'node:fs';
import { fileFor, loadAll, regionAt } from './lib/data.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const [lat, lon, radius = '25', tagArg = ''] = args.filter((a) => a !== '--write');
const key = process.env.WINDY_API_KEY;
if (!lat || !lon || !key) {
	console.error(
		'Usage: node --env-file=.env scripts/import-windy.mjs <lat> <lon> <radius_km> [tags] [--write]  (needs WINDY_API_KEY)'
	);
	process.exit(1);
}

const slug = (s) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, 60)
		.replace(/^-+|-+$/g, '');
const km = (a, b) => {
	const r = Math.PI / 180;
	const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
	const y = (b.lat - a.lat) * r;
	return Math.sqrt(x * x + y * y) * 6371;
};

const existing = loadAll('cameras');
const haveRefs = new Set(existing.filter((c) => c.provider === 'windy').map((c) => c.provider_ref));
const ids = new Set(existing.map((c) => c.id));

// Windy answers 50 at a time; page through everything in the circle.
const webcams = [];
for (let offset = 0; offset < 1000; offset += 50) {
	const res = await fetch(
		`https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lon},${Math.min(Number(radius), 250)}&limit=50&offset=${offset}&include=location,urls`,
		{ headers: { 'x-windy-api-key': key } }
	);
	if (!res.ok) throw new Error(`Windy returned ${res.status}`);
	const page = (await res.json()).webcams ?? [];
	webcams.push(...page);
	if (page.length < 50) break;
}

let added = 0;
const skipped = { have: 0, near: 0, outside: 0, inactive: 0, agency: 0, fire: 0 };
for (const w of webcams) {
	const ref = String(w.webcamId);
	const at = { lat: w.location.latitude, lon: w.location.longitude };
	if (w.status !== 'active') {
		skipped.inactive++;
		continue;
	}
	if (haveRefs.has(ref)) {
		skipped.have++;
		continue;
	}
	if (!regionAt(at.lat, at.lon)) {
		skipped.outside++;
		continue;
	}
	// State DOT cameras come straight from the agencies (import-wsdot-route.mjs, import-tripcheck.mjs), never
	// through Windy: bigger pictures, the right credit, and the agencies' own terms.
	if (
		/tripcheck\.com|wsdot|dot\.ca\.gov|caltrans|511\.idaho\.gov|nvroads\.com|az511\.gov/i.test(
			w.urls?.provider ?? ''
		)
	) {
		skipped.agency++;
		continue;
	}
	// Fire-lookout cameras (ALERTWildfire, ALERTCalifornia, AlertWest) need the owner's say first (docs/sources.md).
	if (/alertwildfire|alertcalifornia|alertwest/i.test(`${w.urls?.provider ?? ''} ${w.title}`)) {
		skipped.fire++;
		continue;
	}
	if (existing.some((c) => km(c, at) < 0.1)) {
		skipped.near++;
		continue;
	}
	const providerUrl = w.urls?.provider ?? '';
	const road = /tripcheck\.com|wsdot/i.test(providerUrl);
	const owner = /tripcheck\.com/i.test(providerUrl)
		? 'ODOT TripCheck'
		: (providerUrl.match(/^https?:\/\/(?:www\.)?([^/]+)/)?.[1] ?? 'Windy.com');
	// Windy titles read "Town: view" or "Town › Direction: view"; keep them readable.
	const name = w.title.replace(/\s*›\s*/g, ' – ').trim();
	let id = slug(name) || `windy-${ref}`;
	if (ids.has(id)) id = `${id}-${ref}`;
	ids.add(id);
	const camera = {
		id,
		name,
		lat: at.lat,
		lon: at.lon,
		feed_type: 'image',
		source: `${owner} via Windy.com`,
		status: 'approved',
		approved_by: 'codingwithchad',
		provider: 'windy',
		provider_ref: ref,
		embed_mode: 'direct',
		refresh_seconds: 300,
		page_url: `https://windy.com/webcams/${ref}`,
		tags: [
			...(road ? ['road'] : []),
			...tagArg
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		],
		attribution_text: `${owner} via Windy.com`,
		created_at: new Date().toISOString().slice(0, 10) + 'T00:00:00Z'
	};
	const file = fileFor('cameras', id, at.lat, at.lon);
	if (existsSync(file)) continue;
	existing.push(camera);
	added++;
	if (write) writeFileSync(file, JSON.stringify(camera, null, 2) + '\n');
	else console.log(`would add ${file}  (${owner})`);
}
console.log(
	`${write ? 'Added' : 'Would add'} ${added} of ${webcams.length} Windy cameras. Skipped: ${skipped.have} already added, ${skipped.near} next to a camera we have, ${skipped.outside} outside our regions, ${skipped.inactive} inactive, ${skipped.agency} state DOT cameras (imported from the agency instead), ${skipped.fire} fire-lookout cameras.`
);
