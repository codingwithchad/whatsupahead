// Build the offline list of towns and ZIP codes for every US region in data/regions.json, from the US Census
// Bureau Gazetteer files (public domain). Writes data/gazetteer/<region folder>.json.
// Run: node scripts/build-gazetteer.mjs [year]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const year = process.argv[2] ?? '2025';
const base = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_`;
const dir = mkdtempSync(join(tmpdir(), 'gaz-'));

async function table(kind) {
	const res = await fetch(`${base}${kind}_national.zip`);
	if (!res.ok) throw new Error(`${kind}: ${res.status}`);
	const zip = join(dir, `${kind}.zip`);
	writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
	const text = execFileSync('unzip', ['-p', zip], { maxBuffer: 1 << 28 }).toString('utf8');
	const [head, ...rows] = text.split('\n').filter(Boolean);
	// The Census changed the separator from a tab to a pipe in newer years; accept either.
	const sep = head.includes('|') ? '|' : '\t';
	const cols = head.split(sep).map((c) => c.trim());
	return rows.map((r) => Object.fromEntries(r.split(sep).map((v, i) => [cols[i], v.trim()])));
}

const KINDS = ['city', 'town', 'village', 'CDP', 'municipality'];
// Official names that nobody searches for: the Census lists Boise as "Boise City".
const EVERYDAY = { 'ID:Boise City': 'Boise' };
const round = (n) => Math.round(Number(n) * 1e4) / 1e4;

mkdirSync('data/gazetteer', { recursive: true });
const { regions } = JSON.parse(readFileSync('data/regions.json', 'utf8'));
const placeRows = await table('place');
const zipRows = await table('zcta');

for (const region of regions.filter((r) => r.country === 'US')) {
	const places = placeRows
		.filter((r) => r.USPS === region.abbr)
		.map((r) => {
			const m = r.NAME.match(new RegExp(`^(.*) (${KINDS.join('|')})$`));
			const name = m ? m[1] : r.NAME;
			return {
				name: EVERYDAY[`${region.abbr}:${name}`] ?? name,
				type: m ? m[2] : '',
				lat: round(r.INTPTLAT),
				lon: round(r.INTPTLONG)
			};
		});

	const zipPattern = new RegExp(region.zip);
	const zips = zipRows
		.filter((r) => zipPattern.test(r.GEOID))
		.map((r) => ({ zip: r.GEOID, lat: round(r.INTPTLAT), lon: round(r.INTPTLONG) }));

	// Give each ZIP the name of the nearest city or town (not a tiny unincorporated area) so results say where it is.
	const towns = places.filter((p) => p.type === 'city' || p.type === 'town');
	const near = (z) =>
		towns.reduce(
			(best, p) => {
				const d = (p.lat - z.lat) ** 2 + ((p.lon - z.lon) * 0.68) ** 2;
				return d < best.d ? { d, p } : best;
			},
			{ d: Infinity }
		).p.name;
	const out = {
		source: `US Census Bureau Gazetteer ${year} (public domain)`,
		region: region.code,
		abbr: region.abbr,
		places: places.map((p) => [p.name, p.lat, p.lon, p.type]),
		zips: zips.map((z) => [z.zip, z.lat, z.lon, near(z)])
	};
	writeFileSync(`data/gazetteer/${region.folder}.json`, JSON.stringify(out) + '\n');
	console.log(`${region.name}: ${places.length} places, ${zips.length} ZIP codes`);
}
