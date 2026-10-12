import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REGIONS } from '../regions';
import type { Place } from '../types';

// The offline list of towns and ZIP codes for every region the app covers (data/gazetteer/<region>.json,
// built from the US Census by scripts/build-gazetteer.mjs). Answers most searches instantly, without going online.

type Town = { name: string; lat: number; lon: number; type: string; abbr: string };
type Zip = { zip: string; lat: number; lon: number; near: string; abbr: string };

interface Index {
	towns: Map<string, Town[]>;
	zips: Map<string, Zip>;
}

let index: Index | null = null;

// Cities and towns win over unincorporated areas that share a name; then the order of data/regions.json.
const ORDER = new Map(REGIONS.map((r, i) => [r.abbr, i]));
const rank = (t: Town) =>
	(t.type === 'city' || t.type === 'town' ? 0 : 100) + (ORDER.get(t.abbr) ?? 50);

function load(): Index {
	if (index) return index;
	const dir = path.join(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'), 'gazetteer');
	const towns = new Map<string, Town[]>();
	const zips = new Map<string, Zip>();
	let files: string[] = [];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith('.json'));
	} catch (err) {
		console.warn(`[gazetteer] not loaded: ${(err as Error).message}`);
	}
	for (const file of files) {
		try {
			const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as {
				abbr: string;
				places: [string, number, number, string][];
				zips: [string, number, number, string][];
			};
			for (const [name, lat, lon, type] of raw.places) {
				const key = normalize(name);
				towns.set(key, [...(towns.get(key) ?? []), { name, lat, lon, type, abbr: raw.abbr }]);
			}
			for (const [zip, lat, lon, near] of raw.zips)
				zips.set(zip, { zip, lat, lon, near, abbr: raw.abbr });
		} catch (err) {
			console.warn(`[gazetteer] ${file}: ${(err as Error).message}`);
		}
	}
	for (const list of towns.values()) list.sort((a, b) => rank(a) - rank(b));
	return (index = { towns, zips });
}

const normalize = (s: string) =>
	s
		.toLowerCase()
		.replace(/\./g, '')
		.replace(/^(city|town) of /, '')
		.replace(/\s+/g, ' ')
		.trim();

/** "Snohomish, WA" / "Salem Oregon" -> name and state abbreviation; null state when none was written. */
function splitState(q: string): { name: string; abbr: string | null } {
	const m = q.match(/^(.*?)[,\s]+([a-z .]{2,})$/i);
	if (m) {
		const said = m[2].trim().toLowerCase();
		const region = REGIONS.find(
			(r) => r.abbr.toLowerCase() === said || r.name.toLowerCase() === said
		);
		if (region) return { name: m[1], abbr: region.abbr };
		// Looks like "Boise, Idaho": a state we do not cover, unless the comma was part of the name itself.
		if (q.includes(',')) return { name: m[1], abbr: '??' };
	}
	return { name: q, abbr: null };
}

/**
 * Look up a town or ZIP code in the covered regions without going online. Returns null when the text is not
 * one of those (so the caller can try an online search), including places in states we do not cover.
 */
export function lookupTown(query: string): Place | null {
	const q = query.trim();
	const idx = load();

	const zip = q.match(/^(\d{5})(?:-\d{4})?$/);
	if (zip) {
		const z = idx.zips.get(zip[1]);
		return z ? { lat: z.lat, lon: z.lon, label: `${z.zip}, ${z.near}, ${z.abbr}` } : null;
	}

	const { name, abbr } = splitState(q.replace(/,$/, ''));
	const list = idx.towns.get(normalize(name)) ?? idx.towns.get(normalize(q));
	const town = list?.find((t) => !abbr || t.abbr === abbr);
	return town ? { lat: town.lat, lon: town.lon, label: `${town.name}, ${town.abbr}` } : null;
}

/** Towns whose names start with what has been typed so far, for the as-you-type list (instant, no outside service). */
export function suggestTowns(
	prefix: string,
	limit = 3
): { label: string; sub: string; lat: number; lon: number }[] {
	const key = normalize(prefix);
	if (key.length < 2) return [];
	return [...load().towns.entries()]
		.filter(([name]) => name.startsWith(key))
		.flatMap(([, list]) => list)
		.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
		.slice(0, limit)
		.map((t) => ({ label: t.name, sub: t.abbr, lat: t.lat, lon: t.lon }));
}

/** The nearest city or town within `maxMiles`, for naming a point on a drive ("Near Ellensburg"). */
export function nearestTown(p: { lat: number; lon: number }, maxMiles = 12): string | null {
	const k = Math.cos((p.lat * Math.PI) / 180);
	let best: { d: number; name: string } | null = null;
	for (const list of load().towns.values())
		for (const t of list) {
			if (t.type !== 'city' && t.type !== 'town') continue;
			const d = Math.hypot((t.lat - p.lat) * 69, (t.lon - p.lon) * 69 * k);
			if (d <= maxMiles && (!best || d < best.d)) best = { d, name: t.name };
		}
	return best?.name ?? null;
}
