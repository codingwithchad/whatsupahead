import { parseLatLon } from '../geo';
import type { Place } from '../types';
import { cached } from './cache';
import { allow, visitorAllowed } from './rateLimit';
import { queryVariants, similarity } from '../queryVariants';
import { lookupTown } from './gazetteer';
import { COVERAGE } from '../regions';
import { photonSearch, type Suggestion } from './photon';
import { azureMapsKey, azureSearch } from './azureMaps';

const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';
const BIG_AREAS = new Set(['county', 'state', 'region', 'country', 'state_district', 'province']);
const DAY = 24 * 60 * 60 * 1000;

// Nominatim allows at most one request per second, so uncached lookups wait in line.
// If too many are already waiting, give up at once (the caller falls back to the backup service).
const MAX_WAITING = 10;
let lastLookup = Promise.resolve();
let waiting = 0;
function inLine<T>(job: () => Promise<T>): Promise<T> {
	if (waiting >= MAX_WAITING) return Promise.reject(new Error('lookup queue full'));
	waiting++;
	const run = lastLookup.then(job, job).finally(() => waiting--);
	lastLookup = run.then(
		() => new Promise<void>((r) => setTimeout(r, 1100)),
		() => new Promise<void>((r) => setTimeout(r, 1100))
	);
	return run;
}

/** Azure Maps when it is set up and within its daily allowance, otherwise Photon. */
async function placeSearch(q: string, limit: number): Promise<Suggestion[]> {
	if (azureMapsKey()) {
		try {
			return await azureSearch(q, limit);
		} catch (err) {
			console.warn(`[geocode] azure maps: ${(err as Error).message}; using photon`);
		}
	}
	return photonSearch(q, limit);
}

/** Turn "98115", "Westport, WA", "Stevens Pass" or "47.7,-121.1" into a point. */
export async function geocode(query: string): Promise<Place | null> {
	const q = query.trim().slice(0, 200);
	if (!q) return null;
	const direct = parseLatLon(q);
	if (direct) return { ...direct, label: `${direct.lat.toFixed(3)}, ${direct.lon.toFixed(3)}` };

	// Towns and ZIP codes in the covered regions come from the offline list: instant, no outside service needed.
	const local = lookupTown(q);
	if (local) return local;

	return cached(`geo:${q.toLowerCase().replace(/\s+/g, ' ')}`, DAY, async () => {
		// Each new place can take several searches; a person types a few, a script typing random ones is stopped.
		if (!visitorAllowed('geocode', 20)) throw new Error('too many new place lookups');
		// Main search (Azure Maps or Photon): forgives typos and prefers the Northwest. People write names differently from the map
		// (split or joined words, "mall"), so try other spellings and keep the result that looks most like what was typed.
		try {
			let best: { score: number; place: Place } | null = null;
			for (const variant of queryVariants(q)) {
				for (const hit of await placeSearch(variant, 3)) {
					const score = similarity(q, hit.label);
					if (!best || score > best.score) {
						best = {
							score,
							place: {
								lat: hit.lat,
								lon: hit.lon,
								label: [hit.label, hit.sub.split(',')[0]].filter(Boolean).join(', ')
							}
						};
					}
				}
				if (best && best.score >= 0.85) break;
			}
			if (best && best.score >= 0.3) return best.place;
		} catch (err) {
			console.warn(`[geocode] photon failed (${(err as Error).message}); trying the backup`);
		}
		try {
			return await inLine(() => nominatim(q));
		} catch (err) {
			console.warn(`[geocode] primary failed (${(err as Error).message}); trying backup`);
			return openMeteo(q);
		}
	});
}

async function nominatim(q: string): Promise<Place | null> {
	const url = new URL('https://nominatim.openstreetmap.org/search');
	url.search = new URLSearchParams({
		q,
		format: 'jsonv2',
		limit: '5',
		// Prefer the regions the app covers (so "Bellevue Square" is not the one in London), without excluding
		// anywhere else in the US.
		viewbox: [COVERAGE[0], COVERAGE[3], COVERAGE[2], COVERAGE[1]].join(','),
		bounded: '0',
		countrycodes: 'us'
	}).toString();
	const res = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`geocoder ${res.status}`);
	const hits = (await res.json()) as {
		lat: string;
		lon: string;
		display_name: string;
		addresstype?: string;
	}[];
	if (!hits.length) return null;
	// Prefer an actual town or street over a county or other big area that merely shares the name.
	const best = hits.find((h) => !BIG_AREAS.has(h.addresstype ?? '')) ?? hits[0];
	const label = best.display_name.split(',').slice(0, 2).join(',').trim();
	return { lat: Number(best.lat), lon: Number(best.lon), label };
}

const STATES: Record<string, string> = {
	AL: 'Alabama',
	AK: 'Alaska',
	AZ: 'Arizona',
	AR: 'Arkansas',
	CA: 'California',
	CO: 'Colorado',
	CT: 'Connecticut',
	DE: 'Delaware',
	FL: 'Florida',
	GA: 'Georgia',
	HI: 'Hawaii',
	ID: 'Idaho',
	IL: 'Illinois',
	IN: 'Indiana',
	IA: 'Iowa',
	KS: 'Kansas',
	KY: 'Kentucky',
	LA: 'Louisiana',
	ME: 'Maine',
	MD: 'Maryland',
	MA: 'Massachusetts',
	MI: 'Michigan',
	MN: 'Minnesota',
	MS: 'Mississippi',
	MO: 'Missouri',
	MT: 'Montana',
	NE: 'Nebraska',
	NV: 'Nevada',
	NH: 'New Hampshire',
	NJ: 'New Jersey',
	NM: 'New Mexico',
	NY: 'New York',
	NC: 'North Carolina',
	ND: 'North Dakota',
	OH: 'Ohio',
	OK: 'Oklahoma',
	OR: 'Oregon',
	PA: 'Pennsylvania',
	RI: 'Rhode Island',
	SC: 'South Carolina',
	SD: 'South Dakota',
	TN: 'Tennessee',
	TX: 'Texas',
	UT: 'Utah',
	VT: 'Vermont',
	VA: 'Virginia',
	WA: 'Washington',
	WV: 'West Virginia',
	WI: 'Wisconsin',
	WY: 'Wyoming',
	DC: 'District of Columbia'
};

/** Backup place search (towns and zip codes only) for when the main one is down or busy. */
async function openMeteo(q: string): Promise<Place | null> {
	const [name, ...rest] = q.split(',').map((s) => s.trim());
	const hint = rest.join(' ').trim();
	if (!allow('upstream:open-meteo', 60)) throw new Error('backup place search busy');
	const wanted = (STATES[hint.toUpperCase()] ?? hint).toLowerCase();
	const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
	url.search = new URLSearchParams({
		name,
		count: '10',
		language: 'en',
		format: 'json'
	}).toString();
	const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`backup geocoder ${res.status}`);
	const results =
		(
			(await res.json()) as {
				results?: {
					name: string;
					admin1?: string;
					country_code?: string;
					latitude: number;
					longitude: number;
					population?: number;
				}[];
			}
		).results ?? [];
	if (!results.length) return null;
	const score = (r: (typeof results)[number]) =>
		(wanted && r.admin1?.toLowerCase() === wanted ? 1e9 : 0) +
		(r.country_code === 'US' ? 1e6 : 0) +
		(r.population ?? 0);
	const best = [...results].sort((a, b) => score(b) - score(a))[0];
	return {
		lat: best.latitude,
		lon: best.longitude,
		label: [best.name, best.admin1].filter(Boolean).join(', ')
	};
}
