// Add road cameras from a state's 511 site (Idaho 511, Nevada 511, UDOT Traffic: the same system) as camera data files.
// Usage: node scripts/import-511.mjs <idaho|nevada|utah> [--write]   (run through ops/vault-run.mjs for the key)
// Needs the state's developer key (ID_511_DOT_API_KEY from https://511.idaho.gov/developers/doc,
// NV_511_DOT_API_KEY from https://www.nvroads.com/developers/doc, UT_511_DOT_API_KEY from
// https://www.udottraffic.utah.gov/developers/doc). Each allows ten API calls a minute; this makes one. Only the agency's own cameras (and, in Idaho, the Ada County Highway District's) are added: the lists also
// carry other states' and private cameras, which have their own terms. Only views marked enabled whose picture
// actually loads as a JPEG are added (Nevada sends a PNG notice for a camera that is down); ones we have are skipped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFiles, fileFor, regionAt } from './lib/data.mjs';

const STATES = {
	idaho: {
		abbr: 'ID',
		base: 'https://511.idaho.gov',
		keyVar: 'ID_511_DOT_API_KEY',
		page: 'https://511.idaho.gov/',
		// Who runs each kind of camera in the list, and how we credit them.
		owners: {
			ITDNET: { source: 'ITD', credit: 'Idaho Transportation Department (Idaho 511)' },
			RWIS: { source: 'ITD', credit: 'Idaho Transportation Department (Idaho 511)' },
			Idaho511: { source: 'ITD', credit: 'Idaho Transportation Department (Idaho 511)' },
			ACHD: { source: 'ACHD', credit: 'Ada County Highway District via Idaho 511' }
		}
	},
	nevada: {
		abbr: 'NV',
		base: 'https://www.nvroads.com',
		keyVar: 'NV_511_DOT_API_KEY',
		page: 'https://www.nvroads.com/',
		// NDOT's camera system; "USER" cameras have no named owner and are left out.
		owners: {
			Cameleon: { source: 'NDOT', credit: 'Nevada Department of Transportation (Nevada 511)' }
		}
	},
	utah: {
		abbr: 'UT',
		base: 'https://www.udottraffic.utah.gov',
		keyVar: 'UT_511_DOT_API_KEY',
		page: 'https://www.udottraffic.utah.gov/',
		owners: {
			ADX: { source: 'UDOT', credit: 'Utah Department of Transportation (UDOT Traffic)' }
		},
		// UDOT also runs about 450 city intersection cameras with no highway named; those are left out.
		highwaysOnly: true
	}
};

const state = STATES[process.argv[2]];
if (!state) {
	console.error('Usage: node scripts/import-511.mjs <idaho|nevada|utah> [--write]');
	process.exit(1);
}
const OWNERS = state.owners;
const write = process.argv.includes('--write');
const key = process.env[state.keyVar];
if (!key) {
	console.error(
		`Needs ${state.keyVar} (run through ops/vault-run.mjs, or set it in the environment).`
	);
	process.exit(1);
}

const res = await fetch(
	`${state.base}/api/v2/get/cameras?format=json&key=${encodeURIComponent(key)}`
);
if (!res.ok) throw new Error(`${state.base} returned ${res.status}`);
const list = await res.json();

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, 60)
		.replace(/^-+|-+$/g, '');
// "I-84" to "I 84", "SH-55 Eagle" to "SH 55", "SR431" to "SR 431"; local streets have no route.
const route = (roadway) => {
	const m = String(roadway ?? '').match(/^(I|US|SH|SR)-?\s?(\d+)/i);
	return m ? `${m[1].toUpperCase()} ${m[2]}` : undefined;
};

const files = dataFiles('cameras').map((file) => JSON.parse(readFileSync(file, 'utf8')));
const haveUrls = new Set(files.map((cam) => (cam.feed_url ?? '').toLowerCase()));
const ids = new Set(files.map((cam) => cam.id));

const candidates = list
	.filter((c) => OWNERS[c.Source] && regionAt(c.Latitude, c.Longitude)?.abbr === state.abbr)
	.filter((c) => !state.highwaysOnly || route(c.Roadway))
	.flatMap((c) => {
		const views = (c.Views ?? []).filter((v) => v.Status === 'Enabled' && v.Url);
		// A weather station's camera can have a view in each direction, with no description: number them.
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
			page_url: state.page,
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
	`${write ? 'Added' : 'Would add'} ${added} cameras (${dead} pictures not loading, ${list.length} cameras in the list).`
);
