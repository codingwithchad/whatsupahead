// Add the WSDOT cameras and weather stations along a drive as data files.
// Usage: node --env-file=.env scripts/import-wsdot-route.mjs "<from lat,lon>" "<to lat,lon>" [corridor_miles=0.6] [tag]
//        node --env-file=.env scripts/import-wsdot-route.mjs all     (every working camera and reporting station in the state)
// Only working cameras are added (each picture is downloaded and checked), and ones we already have are skipped.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadAll } from './lib/data.mjs';

const [fromArg, toArg, corridorArg = '0.6', tagArg = ''] = process.argv.slice(2);
const key = process.env.WSDOT_CODE;
const ALL = fromArg === 'all';
if (!fromArg || (!ALL && !toArg) || !key) {
	console.error(
		'Usage: node --env-file=.env scripts/import-wsdot-route.mjs "lat,lon" "lat,lon" [corridor_miles] [tag]  (needs WSDOT_CODE)'
	);
	process.exit(1);
}
const corridor = Number(corridorArg);
const parse = (s) => s.split(',').map(Number);
const [fLat, fLon] = ALL ? [0, 0] : parse(fromArg);
const [tLat, tLon] = ALL ? [0, 0] : parse(toArg);

const rad = Math.PI / 180;
const miles = (a, b, c, d) => {
	const x =
		Math.sin(((c - a) * rad) / 2) ** 2 +
		Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
	return 3958.8 * 2 * Math.asin(Math.sqrt(x));
};

const osrm = ALL
	? null
	: await (
			await fetch(
				`https://router.project-osrm.org/route/v1/driving/${fLon},${fLat};${tLon},${tLat}?overview=full&geometries=geojson`
			)
		).json();
const route = ALL ? [] : osrm.routes?.[0]?.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
if (!ALL && !route) throw new Error('no route');
const offRoute = (lat, lon) => {
	if (ALL) return 0;
	let best = Infinity;
	const cos = Math.cos(lat * rad);
	for (let i = 0; i < route.length - 1; i++) {
		const [aLat, aLon] = route[i];
		const [bLat, bLon] = route[i + 1];
		const bx = (bLon - aLon) * cos * 69.05,
			by = (bLat - aLat) * 69.05;
		const px = (lon - aLon) * cos * 69.05,
			py = (lat - aLat) * 69.05;
		const l2 = bx * bx + by * by;
		const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / l2));
		best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
	}
	return best;
};

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
const load = (dir) => loadAll(dir.replace(/^data\//, ''));
const haveUrls = new Set(load('data/cameras').map((c) => c.feed_url));
const ids = new Set(load('data/cameras').map((c) => c.id));
mkdirSync('data/cameras/us-wa', { recursive: true });
mkdirSync('data/weather-sources/us-wa', { recursive: true });

const cams = await (
	await fetch(
		`https://wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=${key}`
	)
).json();
const candidates = cams.filter(
	(c) =>
		c.IsActive &&
		!haveUrls.has(c.ImageURL) &&
		// WSDOT's list includes Oregon cameras near Portland that TripCheck publishes; those belong to Oregon.
		!/tripcheck\.com/i.test(c.ImageURL) &&
		offRoute(c.CameraLocation.Latitude, c.CameraLocation.Longitude) <= corridor
);

// WSDOT's list includes cameras other people own (a telecom, a city, a lodge) and names the owner. Credit the
// owner, not WSDOT, and link to their page. Some owner fields hold WSDOT's own text, not an owner.
const OWNER_NAMES = {
	'Whidbeytel.com': 'Whidbey Telecom',
	'Lewiscounty.com Tiger Mountain Technologies': 'Lewiscounty.com / Tiger Mountain Technologies'
};
function credit(c) {
	const owner = (c.CameraOwner ?? '').replace(/\s+/g, ' ').trim();
	if (!owner || /^WSDOT\b|tripcheck|sign up/i.test(owner))
		return { attribution_text: 'Camera courtesy of WSDOT' };
	return {
		attribution_text: `${OWNER_NAMES[owner] ?? owner}, via WSDOT`,
		...(c.OwnerURL ? { page_url: c.OwnerURL.replace(/^http:/, 'https:') } : {})
	};
}

async function isJpeg(url) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
		const bytes = new Uint8Array(await res.arrayBuffer());
		return res.ok && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.length > 2000;
	} catch {
		return false;
	}
}

let added = 0,
	dead = 0;
for (let i = 0; i < candidates.length; i += 8) {
	const batch = candidates.slice(i, i + 8);
	const ok = await Promise.all(batch.map((c) => isJpeg(c.ImageURL)));
	batch.forEach((c, n) => {
		if (!ok[n]) return void dead++;
		const L = c.CameraLocation;
		const title = c.Title.trim();
		const m = title.match(
			/^(US|SR|I)[ -]?(\d+)\s*(?:[NSEW]B)?\s*(?:at|@)\s*MP\s*([\d.]+)\s*:?\s*(.*)$/i
		);
		let id = m
			? `wsdot-${m[1].toLowerCase()}${m[2]}-mp${m[3].replace('.', '-')}${m[4] ? '-' + slug(m[4]) : ''}`
			: `wsdot-${slug(title)}`;
		if (ids.has(id)) id += `-${c.CameraID}`;
		ids.add(id);
		const cam = {
			id,
			name: title,
			lat: L.Latitude,
			lon: L.Longitude,
			feed_url: c.ImageURL,
			feed_type: 'image',
			source: 'WSDOT',
			status: 'approved',
			approved_by: 'codingwithchad',
			page_url: 'https://wsdot.com/travel/real-time/map/',
			embed_mode: 'direct',
			refresh_seconds: 120,
			tags: ['road', ...(tagArg ? [tagArg] : [])],
			attribution_text: 'Camera courtesy of WSDOT',
			created_at: new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
			...credit(c)
		};
		if (m) {
			cam.route = `${m[1].toUpperCase()} ${m[2]}`;
			cam.milepost = Number(m[3]);
		}
		writeFileSync(`data/cameras/us-wa/${id}.json`, JSON.stringify(cam, null, 2) + '\n');
		added++;
	});
}

// Roadside weather stations along the route that are reporting now.
const haveStations = new Set(
	load('data/weather-sources')
		.filter((w) => w.provider === 'wsdot-weather')
		.map((w) => w.provider_ref)
);
const stations = await (
	await fetch(
		`https://wsdot.wa.gov/Traffic/api/WeatherInformation/WeatherInformationREST.svc/GetCurrentWeatherInformationAsJson?AccessCode=${key}`
	)
).json();
let stationsAdded = 0;
for (const s of stations) {
	if (
		haveStations.has(String(s.StationID)) ||
		s.TemperatureInFahrenheit == null ||
		offRoute(s.Latitude, s.Longitude) > corridor
	)
		continue;
	const id = `wsdot-station-${slug(s.StationName).slice(0, 48)}-${s.StationID}`;
	writeFileSync(
		`data/weather-sources/us-wa/${id}.json`,
		JSON.stringify(
			{
				id,
				name: s.StationName,
				lat: s.Latitude,
				lon: s.Longitude,
				kind: 'station',
				provider: 'wsdot-weather',
				provider_ref: String(s.StationID),
				source: 'WSDOT',
				page_url: 'https://wsdot.com/travel/real-time/map/',
				requires_key: 'WSDOT_CODE',
				status: 'approved',
				approved_by: 'codingwithchad',
				tags: tagArg ? [tagArg] : [],
				attribution_text: 'Washington State Department of Transportation',
				created_at: new Date().toISOString().slice(0, 10) + 'T00:00:00Z'
			},
			null,
			2
		) + '\n'
	);
	stationsAdded++;
}
console.log(
	`route ${route.length} points | cameras added ${added}, skipped as not working ${dead} | weather stations added ${stationsAdded}`
);
