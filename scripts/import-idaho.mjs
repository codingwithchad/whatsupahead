// Add Idaho road cameras from Idaho 511 (the Idaho Transportation Department) as data files in data/cameras/us-id/.
// Usage: node --env-file=.env scripts/import-idaho.mjs [--write]
// Needs ID_511_DOT_API_KEY (a developer key from https://511.idaho.gov/developers/doc). Idaho 511 allows ten
// API calls a minute; this makes one. Only ITD's own cameras and the Ada County Highway District's (Boise) are
// added: Idaho 511 also lists cameras from neighbouring states and private owners, which have their own terms.
// Only views that Idaho 511 marks enabled and whose picture actually loads are added; ones we have are skipped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFiles, fileFor, regionAt } from './lib/data.mjs';

const write = process.argv.includes('--write');
const key = process.env.ID_511_DOT_API_KEY;
if (!key) {
	console.error('Needs ID_511_DOT_API_KEY in .env (an Idaho 511 developer key).');
	process.exit(1);
}

const res = await fetch(
	`https://511.idaho.gov/api/v2/get/cameras?format=json&key=${encodeURIComponent(key)}`
);
if (!res.ok) throw new Error(`Idaho 511 returned ${res.status}`);
const list = await res.json();

// Who runs each kind of camera in Idaho 511's list, and how we credit them.
const OWNERS = {
	ITDNET: { source: 'ITD', credit: 'Idaho Transportation Department (Idaho 511)' },
	RWIS: { source: 'ITD', credit: 'Idaho Transportation Department (Idaho 511)' },
	Idaho511: { source: 'ITD', credit: 'Idaho Transportation Department (Idaho 511)' },
	ACHD: { source: 'ACHD', credit: 'Ada County Highway District via Idaho 511' }
};

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, 60)
		.replace(/^-+|-+$/g, '');
// "I-84" to "I 84", "SH-55 Eagle" to "SH 55", "US-20" to "US 20"; local streets have no route.
const route = (roadway) => {
	const m = String(roadway ?? '').match(/^(I|US|SH)-?\s?(\d+)/i);
	return m ? `${m[1].toUpperCase()} ${m[2]}` : undefined;
};

const files = dataFiles('cameras').map((file) => JSON.parse(readFileSync(file, 'utf8')));
const haveUrls = new Set(files.map((cam) => (cam.feed_url ?? '').toLowerCase()));
const ids = new Set(files.map((cam) => cam.id));

const candidates = list
	.filter((c) => OWNERS[c.Source] && regionAt(c.Latitude, c.Longitude)?.abbr === 'ID')
	.flatMap((c) => {
		const views = (c.Views ?? []).filter((v) => v.Status === 'Enabled' && v.Url);
		// A weather station's camera has a view in each direction, with no description: number them.
		return views.map((v, i) => ({
			...OWNERS[c.Source],
			name:
				views.length > 1
					? `${String(c.Location).trim()}, view ${i + 1}`
					: String(c.Location).trim(),
			lat: c.Latitude,
			lon: c.Longitude,
			url: String(v.Url).replace(/^http:/i, 'https:'),
			route: route(c.Roadway),
			view: v.Id
		}));
	})
	.filter((c) => c.name && !haveUrls.has(c.url.toLowerCase()));

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
for (let i = 0; i < candidates.length; i += 10) {
	const batch = candidates.slice(i, i + 10);
	const ok = await Promise.all(batch.map((c) => isJpeg(c.url)));
	batch.forEach((c, n) => {
		if (!ok[n]) return void dead++;
		let id = `${c.source.toLowerCase()}-${slug(c.name)}`;
		if (ids.has(id)) id = `${id}-${c.view}`;
		ids.add(id);
		const camera = {
			id,
			name: c.name,
			lat: c.lat,
			lon: c.lon,
			feed_url: c.url,
			feed_type: 'image',
			source: c.source,
			status: 'approved',
			approved_by: 'codingwithchad',
			page_url: 'https://511.idaho.gov/',
			embed_mode: 'direct',
			refresh_seconds: 300,
			tags: ['road'],
			attribution_text: c.credit,
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
	`${write ? 'Added' : 'Would add'} ${added} Idaho cameras (${dead} pictures not loading, ${list.length} cameras in Idaho 511's list).`
);
